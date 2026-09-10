import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callModel, decideLive, getLiveConfig } from "../src/lib/provider";
import type { Run } from "../src/lib/types";

function run(): Run {
  return {
    usage: {
      toolCalls: 0,
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      costKind: "estimated",
    },
    limits: {
      maxCostUsd: 1,
      maxModelCalls: 24,
      maxDurationMs: 180000,
      maxToolCalls: 12,
      maxRevisions: 3,
    },
  } as Run;
}
function configure() {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-secret");
  vi.stubEnv("ANTHROPIC_MODEL", "test-model");
  vi.stubEnv("ANTHROPIC_INPUT_USD_PER_MILLION", "3");
  vi.stubEnv("ANTHROPIC_OUTPUT_USD_PER_MILLION", "15");
  vi.stubEnv("MAX_COST_USD", "1");
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("live model boundary", () => {
  it("requires explicit rates and cost configuration", () => {
    configure();
    vi.stubEnv("ANTHROPIC_INPUT_USD_PER_MILLION", "");
    expect(getLiveConfig().configured).toBe(false);
    expect(getLiveConfig().reason).toBeTruthy();
  });
  it("validates structured output and accounts for actual usage", async () => {
    configure();
    vi.stubEnv("ANTHROPIC_WORKSPACE_ID", "workspace-test");
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        stop_reason: "end_turn",
        content: [{ type: "text", text: '{"answer":"ok"}' }],
        usage: { input_tokens: 100, output_tokens: 10 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const state = run();
    const result = await callModel(
      state,
      new AbortController().signal,
      z.object({ answer: z.string().min(1) }).strict(),
      "Answer briefly.",
      "Question",
      100,
    );
    expect(result.answer).toBe("ok");
    expect(state.usage.modelCalls).toBe(1);
    expect(state.usage.costUsd).toBeCloseTo(0.00045);
    const payload = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(payload.output_config.format.type).toBe("json_schema");
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      "anthropic-workspace-id": "workspace-test",
    });
    expect(JSON.stringify(payload.output_config.format.schema)).not.toContain(
      "minLength",
    );
    expect(payload.output_config.format.schema.additionalProperties).toBe(
      false,
    );
  });
  it("rejects a call before network use when the reserved budget does not fit", async () => {
    configure();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const state = run();
    state.limits.maxCostUsd = 0.000001;
    await expect(
      callModel(
        state,
        new AbortController().signal,
        z.object({ answer: z.string() }),
        "System",
        "Input",
        1000,
      ),
    ).rejects.toThrow(/비용|budget/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["refusal", "max_tokens"])(
    "rejects %s rather than accepting a partial response",
    async (stopReason) => {
      configure();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({
            stop_reason: stopReason,
            content: [{ type: "text", text: '{"answer":"ok"}' }],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        ),
      );
      await expect(
        callModel(
          run(),
          new AbortController().signal,
          z.object({ answer: z.string() }),
          "S",
          "U",
          100,
        ),
      ).rejects.toThrow(/refusal|max_tokens/);
    },
  );
  it("counts malformed model output and does not silently retry", async () => {
    configure();
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        stop_reason: "end_turn",
        content: [{ type: "text", text: '{"answer":4}' }],
        usage: { input_tokens: 50, output_tokens: 5 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const state = run();
    await expect(
      callModel(
        state,
        new AbortController().signal,
        z.object({ answer: z.string() }),
        "S",
        "U",
        100,
      ),
    ).rejects.toThrow();
    expect(state.usage.modelCalls).toBe(1);
    expect(state.usage.inputTokens).toBe(50);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("persists the reservation before a pending network call and reconciles after response", async () => {
    configure();
    const pending = Promise.withResolvers<Response>();
    const snapshots: Run["usage"][] = [];
    const state = run();
    const persist = () => snapshots.push(structuredClone(state.usage));
    const fetchMock = vi.fn<typeof fetch>(() => {
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].modelCalls).toBe(1);
      expect(snapshots[0].costUsd).toBeGreaterThan(0);
      return pending.promise;
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = callModel(
      state,
      new AbortController().signal,
      z.object({ answer: z.string() }),
      "S",
      "U",
      100,
      persist,
    );
    expect(snapshots).toHaveLength(1);
    pending.resolve(
      Response.json({
        stop_reason: "end_turn",
        content: [{ type: "text", text: '{"answer":"ok"}' }],
        usage: { input_tokens: 100, output_tokens: 10 },
      }),
    );
    await expect(result).resolves.toEqual({ answer: "ok" });
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1].inputTokens).toBe(100);
    expect(snapshots[1].outputTokens).toBe(10);
    expect(snapshots[1].costUsd).toBeCloseTo(0.00045);
  });
  it("persists reconciled usage before refusing invalid model output", async () => {
    configure();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          stop_reason: "refusal",
          content: [],
          usage: { input_tokens: 100, output_tokens: 10 },
        }),
      ),
    );
    const state = run();
    const snapshots: Run["usage"][] = [];
    await expect(
      callModel(
        state,
        new AbortController().signal,
        z.object({ answer: z.string() }),
        "S",
        "U",
        100,
        () => snapshots.push(structuredClone(state.usage)),
      ),
    ).rejects.toThrow("refusal");
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1].costUsd).toBeCloseTo(0.00045);
  });

  it("maps unresolved historical claim targets to current cards in live context without resolving them", async () => {
    configure();
    const state = run();
    Object.assign(state, {
      brief: {},
      version: 3,
      reviewVersion: null,
      evidence: [],
      sources: [],
      cards: [{ id: "card-1" }],
      claims: [{ id: "current-claim", cardId: "card-1" }],
      issues: [
        {
          id: "old-issue",
          targetId: "manual-v2",
          message: "원문 불일치",
          evidenceIds: [],
          resolved: false,
        },
      ],
      revisions: [{ claims: [{ id: "manual-v2", cardId: "card-1" }] }],
      events: [],
      artifacts: [],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (_url, init) => {
        const context = JSON.parse(
          JSON.parse(init!.body as string).messages[0].content,
        );
        expect(context.issues[0].targetId).toBe("card-1");
        expect(context.issues[0].message).toContain("manual-v2");
        expect(context.issues[0].resolved).toBe(false);
        return Response.json({
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                action: "verify_content",
                targetIds: ["card-1"],
                evidenceIds: [],
                reasonSummary: "수정 결과 검사",
                uncertainty: "",
                blockedReason: "",
              }),
            },
          ],
          usage: { input_tokens: 100, output_tokens: 10 },
        });
      }),
    );
    await expect(
      decideLive(state, new AbortController().signal),
    ).resolves.toMatchObject({
      action: "verify_content",
      targetIds: ["card-1"],
    });
    expect(state.issues[0].targetId).toBe("manual-v2");
    expect(state.issues[0].resolved).toBe(false);
  });
});
