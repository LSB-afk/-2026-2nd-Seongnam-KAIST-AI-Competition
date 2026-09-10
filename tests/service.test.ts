import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunStore } from "../src/lib/store";
import { RunService } from "../src/lib/service";
import { newRun } from "../src/lib/run";
import type { Run, AgentDeps } from "../src/lib/types";

const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);
function setup(
  runner: (r: Run, d: AgentDeps) => Promise<Run> = async (r) => r,
) {
  const dir = mkdtempSync(join(tmpdir(), "timestory-service-"));
  dirs.push(dir);
  const store = new RunStore(join(dir, "runs.sqlite"));
  const service = new RunService(store, {
    runner,
    search: async () => ({ sources: [], evidence: [] }),
    render: async () => [],
    checkArtifacts: async () => true,
  });
  return { store, service };
}
const input = {
  mode: "fixture" as const,
  scenario: "causal" as const,
  requestId: "01234567-89ab-cdef",
};
function readyRun() {
  const r = newRun({ mode: "fixture" });
  r.status = "ready_for_approval";
  r.version = 1;
  r.reviewVersion = 1;
  r.cards = [
    {
      id: "c1",
      title: "제목",
      body: "설명",
      script: "설명",
      claimIds: ["claim1"],
      imagination: false,
    },
  ];
  r.claims = [
    {
      id: "claim1",
      cardId: "c1",
      text: "설명",
      kind: "fact",
      evidenceIds: ["e1"],
      support: "supported",
    },
  ];
  return r;
}

describe("review and run lifecycle", () => {
  it("returns the same run for repeated submissions instead of starting two jobs", async () => {
    const { store, service } = setup();
    const a = service.create(input);
    const b = service.create(input);
    expect(a.id).toBe(b.id);
    expect(store.list()).toHaveLength(1);
    await service.idle(a.id);
    store.close();
  });
  it("rejects same request key reused for different intent", async () => {
    const { store, service } = setup();
    const a = service.create(input);
    expect(() => service.create({ ...input, scenario: "normal" })).toThrow(
      /다른/,
    );
    await service.idle(a.id);
    store.close();
  });
  it("manual edits increment version and invalidate approval, review, and old artifacts", () => {
    const { store, service } = setup();
    const run = readyRun();
    run.status = "approved";
    run.approval = { version: 1, at: run.createdAt, reviewer: "담당자" };
    store.insert(run, "r");
    const edited = service.edit(run.id, {
      version: 1,
      cardId: "c1",
      title: "새 제목",
      body: "확인할 새 설명",
    });
    expect(edited.version).toBe(2);
    expect(edited.reviewVersion).toBeNull();
    expect(edited.approval).toBeNull();
    expect(edited.status).toBe("needs_review");
    expect(edited.artifacts).toEqual([]);
    expect(edited.claims[0].text).toBe("확인할 새 설명");
    expect(edited.claims[0].support).toBe("insufficient");
    expect(edited.revisions.at(-1)?.cards[0].body).toBe("확인할 새 설명");
    store.close();
  });
  it("rejects stale version approvals and unresolved review issues", async () => {
    const { store, service } = setup();
    const run = readyRun();
    store.insert(run, "r");
    await expect(
      service.approve(run.id, { version: 0, reviewer: "담당자" }),
    ).rejects.toThrow(/버전/);
    run.issues = [
      {
        id: "i",
        targetId: "c1",
        type: "evidence",
        severity: "error",
        message: "부족",
        evidenceIds: [],
        recommendation: "확인",
        resolved: false,
      },
    ];
    store.save(run);
    await expect(
      service.approve(run.id, { version: 1, reviewer: "담당자" }),
    ).rejects.toThrow(/검수/);
    store.close();
  });
  it("records an explicit approval for the current reviewed version", async () => {
    const { store, service } = setup();
    const run = readyRun();
    store.insert(run, "r");
    const approved = await service.approve(run.id, {
      version: 1,
      reviewer: "문화홍보 담당자",
    });
    expect(approved.status).toBe("approved");
    expect(approved.approval?.version).toBe(1);
    expect(approved.approval?.reviewer).toBe("문화홍보 담당자");
    store.close();
  });
  it("cancellation cannot be overwritten by a late tool result", async () => {
    let resume!: () => void;
    const hold = new Promise<void>((r) => (resume = r));
    const { store, service } = setup(async (run, deps) => {
      await hold;
      run.status = "ready_for_approval";
      deps.persist(run);
      return run;
    });
    const run = service.create(input);
    service.cancel(run.id);
    resume();
    await service.idle(run.id);
    expect(store.get(run.id)?.status).toBe("cancelled");
    store.close();
  });
  it("rejects retry while a job is active", async () => {
    let resume!: () => void;
    const hold = new Promise<void>((r) => (resume = r));
    const { store, service } = setup(async (run) => {
      await hold;
      return run;
    });
    const r = service.create(input);
    expect(() => service.retry(r.id, { version: r.version })).toThrow(/실행/);
    service.cancel(r.id);
    resume();
    await service.idle(r.id);
    store.close();
  });
});

it("editing a repaired card does not reopen historical issues against deleted claim IDs", () => {
  const { store, service } = setup();
  const run = readyRun();
  run.issues = [
    {
      id: "historical",
      targetId: "claim1",
      type: "evidence_mismatch",
      severity: "error",
      message: "old repaired issue",
      evidenceIds: [],
      recommendation: "fixed",
      resolved: true,
    },
  ];
  store.insert(run, "old");
  const edited = service.edit(run.id, {
    version: 1,
    cardId: "c1",
    title: "수정된 제목",
    body: "새 설명",
  });
  expect(edited.claims.some((c) => c.id === "claim1")).toBe(false);
  expect(edited.issues[0].resolved).toBe(true);
  store.close();
});

it("preserves reserved and reconciled usage even after cancellation", async () => {
  let entered!: () => void;
  let finish!: () => void;
  const reached = new Promise<void>((r) => (entered = r));
  const wait = new Promise<void>((r) => (finish = r));
  const { store, service } = setup(async (run, deps) => {
    run.usage.modelCalls = 1;
    run.usage.costUsd = 0.03;
    deps.persist(run);
    entered();
    await wait;
    run.usage.costUsd = 0.02;
    run.usage.inputTokens = 1500;
    deps.persist(run);
    return run;
  });
  const initial = service.create(input);
  await reached;
  service.cancel(initial.id);
  finish();
  await service.idle(initial.id);
  const stored = store.get(initial.id)!;
  expect(stored.status).toBe("cancelled");
  expect(stored.usage.modelCalls).toBe(1);
  expect(stored.usage.costUsd).toBe(0.02);
  expect(stored.usage.inputTokens).toBe(1500);
  store.close();
});
