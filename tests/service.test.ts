import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunStore } from "../src/lib/store";
import { RunService } from "../src/lib/service";
import { newRun } from "../src/lib/run";
import { handle } from "../src/lib/http";
import { runAgent } from "../src/lib/agent";
import { fixtureSources } from "../src/lib/sources";
import { createFixtureStory } from "../src/lib/fixture";
import { attachDefaultImages } from "../src/lib/images";
import type { Run, AgentDeps, Artifact } from "../src/lib/types";

const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);
function setup(
  runner: (r: Run, d: AgentDeps) => Promise<Run> = async (r) => r,
  overrides: Partial<ConstructorParameters<typeof RunService>[1]> = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "timestory-service-"));
  dirs.push(dir);
  const store = new RunStore(join(dir, "runs.sqlite"));
  const service = new RunService(store, {
    runner,
    search: async () => ({ sources: [], evidence: [] }),
    render: async () => [],
    checkArtifacts: async () => true,
    ...overrides,
  });
  return { store, service };
}
const fixtureDeps = {
  search: async (run: Run) => fixtureSources(run.brief.placeId),
  render: async (run: Run): Promise<Artifact[]> =>
    ["png", "png", "png", "png", "zip", "text", "json"].map((kind, i) => ({
      kind: kind as Artifact["kind"], name: `${i}.${kind}`, path: `/srv/outputs/${run.id}/${i}.${kind}`, sha256: "mock-checksum", version: run.version, reviewVersion: run.version,
    })),
};
async function refused(action: () => unknown) {
  const response = await handle(action);
  return { status: response.status, error: ((await response.json()) as { error?: string }).error };
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
  it("accepts registered places and canonicalizes legacy names before request deduplication",async()=>{
    const {store,service}=setup();
    const brief={place:"율동공원",audience:"가족",goal:"주말 산책 장소 소개",cardCount:4,includeFuture:true};
    const run=service.create({...input,brief});
    expect(run.brief.placeId).toBe("yuldong-park");
    const same=service.create({...input,brief:{...brief,placeId:"yuldong-park"}});expect(same.id).toBe(run.id);
    expect(()=>service.create({...input,requestId:"wrong-id-1",brief:{...brief,placeId:"pangyo-museum"}})).toThrow();
    expect(()=>service.create({...input,requestId:"unknown-1",brief:{...brief,place:"가상 관광지"}})).toThrow();await service.idle(run.id);store.close();
  });
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
  it("words the approval event so its particle never depends on the version number", async () => {
    const { store, service } = setup();
    const run = readyRun();
    run.version = 5;
    run.reviewVersion = 5;
    store.insert(run, "r");
    const approved = await service.approve(run.id, { version: 5, reviewer: "김성남" });
    expect(approved.events.at(-1)?.message).toBe("김성남 담당자가 버전 5 결과를 승인했습니다.");
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
    await service.cancel(run.id);
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
    await service.cancel(r.id);
    resume();
    await service.idle(r.id);
    store.close();
  });
});

it("editing a repaired card preserves its claim ID without reopening historical issues", () => {
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
  expect(edited.claims.some((c) => c.id === "claim1")).toBe(true);
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
  await service.cancel(initial.id);
  finish();
  await service.idle(initial.id);
  const stored = store.get(initial.id)!;
  expect(stored.status).toBe("cancelled");
  expect(stored.usage.modelCalls).toBe(1);
  expect(stored.usage.costUsd).toBe(0.02);
  expect(stored.usage.inputTokens).toBe(1500);
  store.close();
});

it('protects human-edited content without consuming automatic revisions or changing an existing claim ID', () => {
  const {store,service}=setup(); const run=readyRun();run.automaticRevisions=1;
  store.insert(run,'protected');
  const edited=service.edit(run.id,{version:1,cardId:'c1',title:'직접 편집',body:'담당자가 확인할 문구'});
  expect(edited.protectedCardIds).toEqual(['c1']);
  expect(edited.automaticRevisions).toBe(1);
  expect(edited.claims[0].id).toBe('claim1');
  expect(edited.revisions.at(-1)?.origin).toBe('human');
  store.close();
});

it('keeps late model-call audit settlement after cancellation', async () => {
  let entered!:()=>void,finish!:()=>void;
  const reached=new Promise<void>(r=>entered=r), wait=new Promise<void>(r=>finish=r);
  const {store,service}=setup(async (run,deps)=>{
    run.modelCallLog=[{id:'call-1',at:run.createdAt,model:'test',promptVersion:'v2',status:'reserved',reservedCostUsd:0.02,costUsd:0.02}];
    deps.persist(run);entered();await wait;
    run.modelCallLog[0].status='succeeded';run.modelCallLog[0].costUsd=0.01;
    deps.persist(run);return run;
  });
  const run=service.create({...input,requestId:'late-audit'});await reached;await service.cancel(run.id);finish();await service.idle(run.id);
  expect(store.get(run.id)?.modelCallLog?.[0].status).toBe('succeeded');
  expect(store.get(run.id)?.status).toBe('cancelled');store.close();
});

it("refuses an edit that would leave an approved result without budget to re-review it", async () => {
  const { store, service } = setup(runAgent, fixtureDeps);
  const created = service.create({ ...input, scenario: "normal", requestId: "budget-repro-1" });
  await service.idle(created.id);
  for (let round = 1; round <= 4; round++) {
    const run = store.get(created.id)!;
    const edited = service.edit(run.id, { version: run.version, cardId: "card-1", title: `담당자 제목 ${round}`, body: run.cards[0].body });
    service.retry(run.id, { version: edited.version });
    await service.idle(run.id);
    expect(store.get(run.id)?.status).toBe("ready_for_approval");
  }
  const approved = await service.approve(created.id, { version: 5, reviewer: "담당자" });
  expect(approved.usage.toolCalls).toBe(approved.limits.maxToolCalls);
  expect(await refused(() => service.edit(created.id, { version: 5, cardId: "card-1", title: "한 번 더", body: approved.cards[0].body })))
    .toMatchObject({ status: 409, error: expect.stringContaining("현재 결과를 그대로 유지") });
  expect(store.get(created.id)).toEqual(approved);
  expect(approved.artifacts).toHaveLength(7);
  store.close();
});

it("keeps a full re-review in reserve before accepting edits, retries and easy rewrites", async () => {
  const { store, service } = setup();
  const run = newRun({ mode: "fixture" });
  Object.assign(run, fixtureSources(), createFixtureStory(run), { version: 1, reviewVersion: 1, status: "needs_review" });
  run.usage.toolCalls = 11;
  store.insert(run, "budget-thresholds");
  const edit = { version: 1, cardId: "card-1", title: "담당자 제목", body: run.cards[0].body };
  expect(await refused(() => service.edit(run.id, edit))).toMatchObject({ status: 409, error: expect.stringContaining("1회") });
  expect(await refused(() => service.retry(run.id, { version: 1 }))).toMatchObject({ status: 409, error: expect.stringContaining("1회") });
  run.usage.toolCalls = 10;
  store.save(run);
  expect(await refused(() => service.simplify(run.id, { version: 1 }))).toMatchObject({ status: 409, error: expect.stringContaining("3회") });
  expect(store.get(run.id)).toEqual(run);
  expect(service.edit(run.id, edit)).toMatchObject({ version: 2, status: "needs_review" });
  store.close();
});

it("gives a run that stops before rendering its registered place photos", async () => {
  const { store, service } = setup(runAgent, { ...fixtureDeps, attachDefaultImages });
  const run = service.create({ ...input, scenario: "persistent", requestId: "photos-persistent" });
  await service.idle(run.id);
  const stopped = store.get(run.id)!;
  expect(stopped.status).toBe("needs_review");
  expect(stopped.artifacts).toEqual([]);
  expect(stopped.cards.map((card) => card.image?.placeId)).toEqual(Array(4).fill("pangyo-museum"));
  expect(stopped.revisions.find((revision) => revision.version === stopped.version)?.cards).toEqual(stopped.cards);
  store.close();
});

it("gives a cancelled run its place photos once the job winds down", async () => {
  let entered!: () => void;
  let finish!: () => void;
  const reached = new Promise<void>((r) => (entered = r));
  const wait = new Promise<void>((r) => (finish = r));
  const { store, service } = setup(async (run, deps) => {
    Object.assign(run, createFixtureStory(run), { version: 1 });
    deps.persist(run);
    entered();
    await wait;
    return run;
  }, { attachDefaultImages });
  const run = service.create({ ...input, requestId: "photos-cancelled" });
  await reached;
  expect((await service.cancel(run.id)).cards.map((card) => card.image?.kind)).toEqual(Array(4).fill("photo"));
  finish();
  await service.idle(run.id);
  const cancelled = store.get(run.id)!;
  expect(cancelled.status).toBe("cancelled");
  expect(cancelled.cards.map((card) => card.image?.kind)).toEqual(Array(4).fill("photo"));
  store.close();
});

it("settles a job even when a place photo cannot be read", async () => {
  const { store, service } = setup(async (run) => Object.assign(run, createFixtureStory(run), { version: 1, status: "needs_review" as const }), {
    attachDefaultImages: async () => { throw new Error("사진 파일을 읽지 못했습니다."); },
  });
  const run = service.create({ ...input, requestId: "photos-unreadable" });
  await expect(service.idle(run.id)).resolves.toBeUndefined();
  expect(store.get(run.id)?.status).toBe("needs_review");
  expect(() => service.retry(run.id, { version: 1 })).not.toThrow();
  await service.idle(run.id);
  store.close();
});
