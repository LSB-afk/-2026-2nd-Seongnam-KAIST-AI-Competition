import { describe, expect, it, vi } from "vitest";
import { runAgent } from "../src/lib/agent";
import { createFixtureStory } from "../src/lib/fixture";
import { verifyContent } from "../src/lib/verifier";
import type {
  AgentDeps,
  Artifact,
  Run,
  Scenario,
  SourceResult,
} from "../src/lib/types";

function makeRun(scenario: Scenario = "normal"): Run {
  return {
    id: "test-run",
    brief: {
      place: "판교박물관",
      audience: "청소년",
      goal: "박물관 소개",
      cardCount: 4,
      includeFuture: true,
    },
    mode: "fixture",
    strategy: "agent",
    scenario,
    status: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 0,
    reviewVersion: null,
    sources: [],
    evidence: [],
    cards: [],
    claims: [],
    issues: [],
    revisions: [],
    events: [],
    artifacts: [],
    usage: {
      toolCalls: 0,
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      costKind: "fixture",
    },
    limits: {
      maxToolCalls: 12,
      maxRevisions: 3,
      maxDurationMs: 180000,
      maxModelCalls: 24,
      maxCostUsd: 1,
    },
    approval: null,
    stopReason: null,
  };
}
const sourceData: SourceResult = {
  sources: [
    {
      id: "source-faq",
      url: "https://www.seongnam.go.kr/faq",
      title: "박물관 FAQ",
      publisher: "성남시",
      retrievedAt: "2026-09-10",
      status: "ok",
      snapshot:
        "판교박물관은 2013년 4월 2일에 개관했습니다. 백제·고구려 시대 석실분과 판교 전역에서 출토된 유물 일부를 전시합니다.",
      hash: "hash",
      license: "text",
    },
    {
      id: "source-history",
      url: "https://www.seongnam.go.kr/history",
      title: "역사",
      publisher: "성남시",
      retrievedAt: "2026-09-10",
      status: "ok",
      snapshot: "2003년부터 2008년까지 발굴조사가 진행되었습니다.",
      hash: "hash2",
      license: "text",
    },
  ],
  evidence: [
    {
      id: "evidence-opening",
      sourceId: "source-faq",
      quote: "판교박물관은 2013년 4월 2일에 개관했습니다.",
      locator: "FAQ",
    },
    {
      id: "evidence-exhibit",
      sourceId: "source-faq",
      quote:
        "백제·고구려 시대 석실분과 판교 전역에서 출토된 유물 일부를 전시합니다.",
      locator: "FAQ",
    },
    {
      id: "evidence-excavation",
      sourceId: "source-history",
      quote: "2003년부터 2008년까지 발굴조사가 진행되었습니다.",
      locator: "역사",
    },
  ],
};
function deps(signal = new AbortController().signal): AgentDeps {
  return {
    search: vi.fn(async (run) =>
      run.scenario === "unavailable"
        ? { sources: [], evidence: [] }
        : structuredClone(sourceData),
    ),
    render: vi.fn(
      async (run) =>
        [
          ...Array.from({ length: 4 }, (_, i) => ({
            name: `card-${i + 1}.png`,
            kind: "png",
          })),
          { name: "bundle.zip", kind: "zip" },
          { name: "script.txt", kind: "text" },
          { name: "review.json", kind: "json" },
        ].map((item) => ({
          ...item,
          path: item.name,
          sha256: "test-sha",
          version: run.version,
          reviewVersion: run.version,
        })) as Artifact[],
    ),
    persist: vi.fn(),
    signal,
  };
}

describe("bounded agent execution", () => {
  it("produces a reviewable package without granting human approval", async () => {
    const result = await runAgent(makeRun(), deps());
    expect(result.status).toBe("ready_for_approval");
    expect(result.approval).toBeNull();
    expect(result.cards).toHaveLength(4);
    expect(result.reviewVersion).toBe(result.version);
    expect(result.issues.filter((issue) => !issue.resolved)).toEqual([]);
    expect(result.usage.costKind).toBe("fixture");
  });
  it.each(["causal", "future", "mismatch"] as const)(
    "detects and repairs %s with a new verified revision",
    async (scenario) => {
      const result = await runAgent(makeRun(scenario), deps());
      expect(result.status).toBe("ready_for_approval");
      expect(result.version).toBeGreaterThan(1);
      expect(result.revisions[0].cards).not.toEqual(result.cards);
      expect(
        result.events.some(
          (event) =>
            event.action === "verify_content" && event.message.includes("문제"),
        ),
      ).toBe(true);
      if (scenario === "causal" || scenario === "mismatch")
        expect(
          result.events.filter((event) => event.action === "search_sources")
            .length,
        ).toBeGreaterThan(1);
      if (scenario === "future")
        expect(
          result.events.filter((event) => event.action === "search_sources"),
        ).toHaveLength(2);
    },
  );
  it("records a fixed baseline correction without extra search", async () => {
    const run = makeRun("causal");
    run.strategy = "baseline";
    const result = await runAgent(run, deps());
    expect(
      result.events.filter((event) => event.action === "search_sources"),
    ).toHaveLength(1);
    expect(result.version).toBe(2);
  });
  it("escalates unavailable sources instead of fabricating evidence", async () => {
    const result = await runAgent(makeRun("unavailable"), deps());
    expect(result.status).toBe("needs_review");
    expect(result.evidence).toEqual([]);
    expect(result.artifacts).toEqual([]);
  });
  it("stops a persistent fault within the revision cap", async () => {
    const result = await runAgent(makeRun("persistent"), deps());
    expect(result.status).toBe("needs_review");
    expect(result.version).toBeLessThanOrEqual(4);
    expect(result.usage.toolCalls).toBeLessThanOrEqual(12);
    expect(result.issues.some((issue) => !issue.resolved)).toBe(true);
  });
  it("enforces the tool cap before another tool starts", async () => {
    const run = makeRun();
    run.limits.maxToolCalls = 1;
    const result = await runAgent(run, deps());
    expect(result.status).toBe("needs_review");
    expect(result.usage.toolCalls).toBe(1);
    expect(result.cards).toHaveLength(0);
  });
  it("honors cancellation before any external call", async () => {
    const abort = new AbortController();
    abort.abort();
    const dependencies = deps(abort.signal);
    const result = await runAgent(makeRun(), dependencies);
    expect(result.status).toBe("cancelled");
    expect(dependencies.search).not.toHaveBeenCalled();
  });
  it("does not certify files from a different content version", async () => {
    const dependencies = deps();
    dependencies.render = async () => [
      {
        name: "stale.png",
        path: "stale.png",
        sha256: "x",
        version: 0,
        reviewVersion: 0,
        kind: "png",
      },
    ];
    const result = await runAgent(makeRun(), dependencies);
    expect(result.status).toBe("needs_review");
    expect(result.stopReason).toMatch(/출력|버전/);
  });
  it("rejects duplicate card IDs and fabricated evidence references", () => {
    const run = makeRun();
    Object.assign(run, sourceData, createFixtureStory(run));
    run.cards[1].id = run.cards[0].id;
    run.claims[0].evidenceIds = ["invented"];
    const issues = verifyContent(run);
    expect(issues.some((issue) => issue.type === "duplicate_id")).toBe(true);
    expect(issues.some((issue) => issue.type === "missing_evidence")).toBe(
      true,
    );
  });
  it("does not permit a new uncatalogued sentence to bypass claim review", () => {
    const run = makeRun();
    Object.assign(run, sourceData, createFixtureStory(run));
    run.cards[0].body += " 내년부터 무료 AI 사업이 확정되었습니다.";
    expect(
      verifyContent(run).some((issue) => issue.type === "unmapped_text"),
    ).toBe(true);
  });
  it("repairs only a missing imagination label without searching again", async () => {
    const run = makeRun();
    Object.assign(run, sourceData, createFixtureStory(run));
    run.version = 1;
    run.cards[3].imagination = false;
    run.revisions.push({
      version: 1,
      createdAt: run.createdAt,
      cards: structuredClone(run.cards),
      claims: structuredClone(run.claims),
      reason: "draft",
    });
    const dependencies = deps();
    const result = await runAgent(run, dependencies);
    expect(result.status).toBe("ready_for_approval");
    expect(dependencies.search).not.toHaveBeenCalled();
    expect(result.events[1].action).toBe("verify_content");
  });
  it("cannot smuggle an extra invented fact inside a known fixture assertion", () => {
    const run = makeRun();
    Object.assign(run, sourceData, createFixtureStory(run));
    run.claims[0].text += " 매년 천만 명이 방문해요.";
    run.cards[0].body = run.claims[0].text;
    run.cards[0].script = run.claims[0].text;
    expect(
      verifyContent(run).some((issue) => issue.type === "evidence_mismatch"),
    ).toBe(true);
  });
  it("stops when active duration expires", async () => {
    let clock = 0;
    const run = makeRun();
    run.limits.maxDurationMs = 10;
    const dependencies = deps();
    dependencies.now = () => clock++ * 10;
    const result = await runAgent(run, dependencies);
    expect(result.status).toBe("needs_review");
    expect(result.stopReason).toContain("시간");
  });
  it("checks cancellation again after a tool returns", async () => {
    const controller = new AbortController();
    const dependencies = deps(controller.signal);
    dependencies.search = async () => {
      controller.abort();
      return structuredClone(sourceData);
    };
    const result = await runAgent(makeRun(), dependencies);
    expect(result.status).toBe("cancelled");
    expect(dependencies.render).not.toHaveBeenCalled();
  });

  it("preserves unaffected manually assigned claim IDs during partial correction", () => {
    const run = makeRun();
    Object.assign(run, sourceData, createFixtureStory(run));
    run.version = 1;
    run.claims[0].id = "manual-claim";
    run.cards[0].claimIds = ["manual-claim"];
    run.issues = [
      {
        id: "issue",
        targetId: "card-4",
        type: "imagination_label",
        severity: "error",
        message: "label missing",
        evidenceIds: [],
        recommendation: "add label",
        resolved: false,
      },
    ];
    const result = createFixtureStory(run);
    expect(result.cards[0].claimIds).toEqual(["manual-claim"]);
    expect(result.claims.some((claim) => claim.id === "manual-claim")).toBe(
      true,
    );
  });
  it("recovers a renderer overflow by shortening, reviewing and rerendering", async () => {
    const dependencies = deps();
    const successfulRender = dependencies.render;
    let renders = 0;
    dependencies.render = async (run, signal) => {
      if (renders++ === 0) throw new Error("1장 텍스트 잘림 (overflow): body");
      return successfulRender(run, signal);
    };
    const result = await runAgent(makeRun(), dependencies);
    expect(result.status).toBe("ready_for_approval");
    expect(result.version).toBe(2);
    expect(result.cards[0].body.length).toBeLessThan(
      result.revisions[0].cards[0].body.length,
    );
    expect(
      result.events.filter((event) => event.action === "render_cards"),
    ).toHaveLength(2);
    expect(result.reviewVersion).toBe(2);
  });

  it("persists live decision usage before network access through AgentDeps", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-secret");
    vi.stubEnv("ANTHROPIC_MODEL", "test-model");
    vi.stubEnv("ANTHROPIC_INPUT_USD_PER_MILLION", "3");
    vi.stubEnv("ANTHROPIC_OUTPUT_USD_PER_MILLION", "15");
    vi.stubEnv("MAX_COST_USD", "1");
    const snapshots: Run[] = [];
    const dependencies = deps();
    dependencies.persist = (run) => snapshots.push(structuredClone(run));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const reserved = snapshots.at(-1)!;
        expect(reserved.usage.modelCalls).toBe(1);
        expect(reserved.usage.costUsd).toBeGreaterThan(0);
        return Response.json({
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                action: "escalate",
                targetIds: [],
                evidenceIds: [],
                reasonSummary: "추가 자료 필요",
                uncertainty: "자료 없음",
                blockedReason: "추가 자료 필요",
              }),
            },
          ],
          usage: { input_tokens: 100, output_tokens: 10 },
        });
      }),
    );
    try {
      const run = makeRun();
      run.mode = "live";
      await runAgent(run, dependencies);
      expect(snapshots.at(-1)!.usage.costUsd).toBeCloseTo(0.00045);
      expect(snapshots.at(-1)!.usage.inputTokens).toBe(100);
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it("corrects a wrong manual claim ID and verifies the replacement within cumulative tool limits", async () => {
    const run = await runAgent(makeRun(), deps());
    run.version = 2;
    run.reviewVersion = null;
    run.status = "queued";
    run.artifacts = [];
    run.cards[0].body = "판교박물관은 2015년에 개관했어요.";
    run.cards[0].script = run.cards[0].body;
    run.cards[0].claimIds = ["manual-v2"];
    run.claims[0] = {
      ...run.claims[0],
      id: "manual-v2",
      text: run.cards[0].body,
      support: "insufficient",
    };
    run.revisions.push({
      version: 2,
      createdAt: run.createdAt,
      cards: structuredClone(run.cards),
      claims: structuredClone(run.claims),
      reason: "담당자 수정",
    });
    const result = await runAgent(run, deps());
    expect(result.status).toBe("ready_for_approval");
    expect(result.version).toBe(3);
    expect(result.cards[0].body).toContain("2013");
    expect(result.usage.toolCalls).toBe(9);
    expect(result.issues.some((issue) => !issue.resolved)).toBe(false);
  });
  it("retains an unresolved historical manual issue when budget stops before revalidation", async () => {
    const run = await runAgent(makeRun(), deps());
    run.version = 2;
    run.reviewVersion = null;
    run.status = "queued";
    run.artifacts = [];
    run.limits.maxToolCalls = 7;
    run.cards[0].body = "판교박물관은 2015년에 개관했어요.";
    run.cards[0].script = run.cards[0].body;
    run.cards[0].claimIds = ["manual-v2"];
    run.claims[0] = {
      ...run.claims[0],
      id: "manual-v2",
      text: run.cards[0].body,
      support: "insufficient",
    };
    run.revisions.push({
      version: 2,
      createdAt: run.createdAt,
      cards: structuredClone(run.cards),
      claims: structuredClone(run.claims),
      reason: "담당자 수정",
    });
    const result = await runAgent(run, deps());
    expect(result.status).toBe("needs_review");
    expect(result.stopReason).toContain("도구 호출 상한");
    expect(result.reviewVersion).toBeNull();
    expect(
      result.issues.some(
        (issue) => issue.targetId === "manual-v2" && !issue.resolved,
      ),
    ).toBe(true);
  });
});
