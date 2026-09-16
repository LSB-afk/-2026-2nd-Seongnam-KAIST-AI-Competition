import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunStore } from "../src/lib/store";
import { RunService } from "../src/lib/service";
import { DEFAULT_BRIEF, newRun } from "../src/lib/run";
import { runAgent } from "../src/lib/agent";
import { createFixtureStory } from "../src/lib/fixture";
import { fixtureSources } from "../src/lib/sources";
import { PLACES } from "../src/lib/places";
import { assertReadingStyleUpdate } from "../src/lib/reading-style";
import { composeLive } from "../src/lib/provider";
import type { AgentDeps, Artifact, Run } from "../src/lib/types";

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function setup(runner: (run: Run, deps: AgentDeps) => Promise<Run> = runAgent) {
  const dir = mkdtempSync(join(tmpdir(), "reading-style-"));
  const store = new RunStore(join(dir, "runs.sqlite"));
  cleanups.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const render = async (run: Run): Promise<Artifact[]> => ["png", "png", "png", "png", "zip", "text", "json"].map((kind, i) => ({
    kind: kind as Artifact["kind"], name: `${i}.${kind}`, path: `/mock/${i}`, sha256: "mock-checksum", version: run.version, reviewVersion: run.version,
  }));
  const service = new RunService(store, { runner, render, search: async run => fixtureSources(run.brief.placeId), checkArtifacts: async () => true });
  return { store, service };
}
async function ready(service: RunService, store: RunStore) {
  const run = service.create({ mode: "fixture", requestId: "reading-standard-1" });
  await service.idle(run.id);
  return store.get(run.id)!;
}

describe("reading style", () => {
  it.each([[undefined, "만나면"], ["place_intro", "문화공간을 상상해 봐요"], ["visit_guide", "탐험하면"], ["youth_story", "떠나면"]] as const)("simplifies prepared imagination wording for purpose %s without changing sourced noun facts", (purpose, simplerPhrase) => {
    const place = PLACES.find(place => place.id === "seohyeon-culture-house")!;
    const brief = { ...DEFAULT_BRIEF, placeId: place.id, place: place.name, purpose };
    const standard = newRun({ mode: "fixture", brief });
    Object.assign(standard, createFixtureStory(standard));
    standard.readingStyleChange = { expectedVersion: standard.version, targetCardIds: standard.cards.map(card => card.id), status: "requested" };
    const easy = createFixtureStory(standard);
    expect(easy.cards.slice(0, 3)).toEqual(standard.cards.slice(0, 3));
    expect(easy.claims.filter(claim => claim.kind === "fact")).toEqual(standard.claims.filter(claim => claim.kind === "fact"));
    expect(easy.cards[3].body).not.toBe(standard.cards[3].body);
    expect(easy.cards[3].body).toContain("상상 장면:");
    expect(easy.cards[3].body).toContain(simplerPhrase);
    expect(easy.cards[3].body).toContain(place.name);
    expect(easy.cards[3].body.length).toBeLessThan(standard.cards[3].body.length);
    expect(easy.cards[3].imagination).toBe(true);
    expect(easy.claims[3]).toMatchObject({ id: standard.claims[3].id, kind: "imagination", evidenceIds: [] });
    expect(() => assertReadingStyleUpdate(standard, easy)).not.toThrow();
  });

  it("changes initial easy fixture wording while preserving dates and the partial-exhibit qualification", () => {
    const standard = newRun({ mode: "fixture" });
    const easy = newRun({ mode: "fixture", brief: { ...DEFAULT_BRIEF, readingStyle: "easy" } });
    const first = createFixtureStory(standard), next = createFixtureStory(easy);
    expect(next.cards[1].body).not.toBe(first.cards[1].body);
    expect(next.cards[1].body).toContain("일부");
    expect(next.cards[1].body).toContain("돌로 방을 만든 무덤");
    expect(next.cards[0].body).toContain("2013년 4월 2일");
    expect(next.cards[2].body).toContain("2003년부터 2008년까지");
    expect(next.cards[3].body).toContain("상상 장면");
  });

  it("defaults old submissions to standard and rejects request-ID reuse for a different reading style", async () => {
    const { store, service } = setup();
    const run = await ready(service, store);
    expect(run.brief.readingStyle).toBe("standard");
    expect(service.create({ mode: "fixture", requestId: "reading-standard-1", brief: { ...DEFAULT_BRIEF, readingStyle: "standard" } }).id).toBe(run.id);
    expect(() => service.create({ mode: "fixture", requestId: "reading-standard-1", brief: { ...DEFAULT_BRIEF, readingStyle: "easy" } })).toThrow(/다른/);
  });

  it("simplifies a new version, preserves a manually protected card and photo, and requires fresh approval", async () => {
    const { store, service } = setup();
    const original = await ready(service, store);
    const edited = service.edit(original.id, { version: original.version, cardId: "card-1", title: "담당자가 정한 제목", body: original.cards[0].body });
    edited.cards[1].image = { id: "selected-photo", placeId: "pangyo-museum", kind: "photo", src: "/places/pangyo-museum.jpg", sha256: "photo-hash", width: 1920, height: 1281, mime: "image/jpeg", sourceUrl: "https://example.com/photo", author: "기관", license: "출처 표시", licenseUrl: "https://example.com/license", createdAt: edited.createdAt, crop: { x: .3, y: .4, zoom: 1.2 } };
    store.save(edited);
    service.retry(edited.id, { version: edited.version });
    await service.idle(edited.id);
    const reviewed = store.get(edited.id)!;
    await service.approve(edited.id, { version: reviewed.version, reviewer: "담당자" });
    const queued = service.simplify(edited.id, { version: reviewed.version });
    expect(queued.approval).toBeNull();
    expect(queued.reviewVersion).toBeNull();
    expect(queued.artifacts).toEqual([]);
    await service.idle(edited.id);
    const result = store.get(edited.id)!;
    expect(result.status, result.stopReason ?? "").toBe("ready_for_approval");
    expect(result.version).toBe(reviewed.version + 1);
    expect(result.brief.readingStyle).toBe("easy");
    expect(result.cards[0]).toEqual(reviewed.cards[0]);
    expect(result.cards[1].image).toEqual(edited.cards[1].image);
    expect(result.cards[1].body).toContain("돌로 방을 만든 무덤");
    expect(result.reviewVersion).toBe(result.version);
    expect(result.approval).toBeNull();
    expect(result.artifacts.every(artifact => artifact.version === result.version)).toBe(true);
    expect(result.revisions.some(revision => revision.version === reviewed.version)).toBe(true);
    expect(result.usage.modelCalls).toBe(0);
  });

  it("rejects stale, busy and exhausted requests before changing existing content or approvals", async () => {
    const { store, service } = setup();
    const run = await ready(service, store);
    expect(() => service.simplify(run.id, { version: run.version - 1 })).toThrow(/버전/);
    run.usage.toolCalls = run.limits.maxToolCalls;
    store.save(run);
    expect(() => service.simplify(run.id, { version: run.version })).toThrow(/남은 도구 호출/);
    expect(store.get(run.id)).toEqual(run);
    run.usage.toolCalls = 0;
    run.status = "running";
    store.save(run);
    expect(() => service.simplify(run.id, { version: run.version })).toThrow(/실행/);
  });

  it.each(PLACES)("gives $name a verified easy fixture with visible wording changes", async place => {
    const { service, store } = setup();
    const brief = { ...DEFAULT_BRIEF, placeId: place.id, place: place.name };
    const standard = createFixtureStory(newRun({ mode: "fixture", brief }));
    const run = service.create({ mode: "fixture", requestId: `easy-${place.id}`, brief: { ...brief, readingStyle: "easy" } });
    await service.idle(run.id);
    const result = store.get(run.id)!;
    expect(result.status, result.stopReason ?? "").toBe("ready_for_approval");
    expect(result.cards.map(card => card.body)).not.toEqual(standard.cards.map(card => card.body));
    if (place.id === "yuldong-park") expect(result.cards[0].body).toContain("공원이에요. 호수와");
  });

  it.each([
    ["date", (text: string) => text.replace("2003", "2004"), "claim-excavation"],
    ["qualification", (text: string) => text.replace("일부", "모두"), "claim-exhibit"],
    ["period", (text: string) => text.replace("2003년부터 2008년까지", "2003년, 2008년"), "claim-excavation"],
    ["date unit", (text: string) => text.replace("2003년", "2003월"), "claim-excavation"],
  ])("rejects a live rewrite that changes the %s before applying any card", (_name, rewrite, claimId) => {
    const run = newRun({ mode: "fixture" });
    Object.assign(run, createFixtureStory(run));
    run.readingStyleChange = { expectedVersion: 1, targetCardIds: run.cards.map(card => card.id), status: "requested" };
    const story = structuredClone({ cards: run.cards, claims: run.claims });
    const claim = story.claims.find(claim => claim.id === claimId)!;
    claim.text = rewrite(claim.text);
    expect(() => assertReadingStyleUpdate(run, story)).toThrow(/보존/);
    expect(run.claims.find(claim => claim.id === "claim-exhibit")!.text).toContain("일부");
  });

  it("keeps the prior wording on cancellation even if a late compose response arrives", async () => {
    let finish!: () => void;
    const hold = new Promise<void>(resolve => { finish = resolve; });
    const { store, service } = setup(async (run, deps) => {
      if (!run.readingStyleChange) return runAgent(run, deps);
      await hold;
      run.cards[1].body = "늦게 도착한 문구";
      run.brief.readingStyle = "easy";
      run.version++;
      run.status = "ready_for_approval";
      deps.persist(run);
      return run;
    });
    const original = await ready(service, store);
    service.simplify(original.id, { version: original.version });
    await service.cancel(original.id);
    finish();
    await service.idle(original.id);
    const result = store.get(original.id)!;
    expect(result.status).toBe("cancelled");
    expect(result.cards).toEqual(original.cards);
    expect(result.brief.readingStyle).toBe("standard");
    expect(result.version).toBe(original.version);
  });

  it("provides the requested style and protected targets to the real provider boundary", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("ANTHROPIC_MODEL", "test-model");
    vi.stubEnv("ANTHROPIC_INPUT_USD_PER_MILLION", "3");
    vi.stubEnv("ANTHROPIC_OUTPUT_USD_PER_MILLION", "15");
    vi.stubEnv("MAX_COST_USD", "1");
    const run = newRun({ mode: "live" });
    run.limits.maxCostUsd = 1;
    Object.assign(run, createFixtureStory(run));
    run.protectedCardIds = ["card-1"];
    run.readingStyleChange = { expectedVersion: run.version, targetCardIds: ["card-2", "card-3", "card-4"], status: "requested" };
    let context: Record<string, unknown> = {};
    vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
      const payload = JSON.parse(String(init.body));
      context = JSON.parse(payload.messages[0].content);
      return Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ cards: run.cards, claims: run.claims }) }], usage: { input_tokens: 20, output_tokens: 20 } });
    });
    await composeLive(run, new AbortController().signal);
    expect(context.brief).toMatchObject({ readingStyle: "easy", place: "판교박물관" });
    expect(context.protectedCardIds).toEqual(["card-1"]);
    expect(context.readingStyleChange).toMatchObject({ targetCardIds: ["card-2", "card-3", "card-4"] });
    expect(run.brief.readingStyle).toBe("standard");
  });

  it("preserves the original submission's idempotency after a style conversion", async () => {
    const { service, store } = setup();
    const run = await ready(service, store);
    service.simplify(run.id, { version: run.version });
    await service.idle(run.id);
    expect(service.create({ mode: "fixture", requestId: "reading-standard-1" }).id).toBe(run.id);
    expect(() => service.create({ mode: "fixture", requestId: "reading-standard-1", brief: { ...DEFAULT_BRIEF, readingStyle: "easy" } })).toThrow(/다른/);
  });

  it("allows a manual correction to end a failed conversion request before retrying review", async () => {
    const { service, store } = setup();
    const run = await ready(service, store);
    run.status = "needs_review";
    run.readingStyleChange = { expectedVersion: run.version, targetCardIds: ["card-2"], status: "requested" };
    store.save(run);
    const edited = service.edit(run.id, { version: run.version, cardId: "card-2", title: "확인한 전시", body: run.cards[1].body });
    service.retry(run.id, { version: edited.version });
    await service.idle(run.id);
    expect(store.get(run.id)?.status).toBe("ready_for_approval");
  });

  it("rejects a faulty provider rewrite through the agent without creating a new version", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("ANTHROPIC_MODEL", "test-model");
    vi.stubEnv("ANTHROPIC_INPUT_USD_PER_MILLION", "3");
    vi.stubEnv("ANTHROPIC_OUTPUT_USD_PER_MILLION", "15");
    vi.stubEnv("MAX_COST_USD", "1");
    const run = newRun({ mode: "live" });
    Object.assign(run, fixtureSources(), createFixtureStory(run));
    run.version = 1;
    run.limits.maxCostUsd = 1;
    run.readingStyleChange = { expectedVersion: 1, targetCardIds: ["card-2"], status: "requested" };
    const before = structuredClone(run.cards);
    const incoming = structuredClone({ cards: run.cards, claims: run.claims });
    incoming.claims[1].text = incoming.claims[1].text.replace("일부", "전부");
    incoming.cards[1].body = incoming.claims[1].text;
    incoming.cards[1].script = incoming.claims[1].text;
    vi.stubGlobal("fetch", async () => Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(incoming) }], usage: { input_tokens: 20, output_tokens: 20 } }));
    const result = await runAgent(run, { persist: () => {}, search: async () => fixtureSources(), render: async () => [], signal: new AbortController().signal });
    expect(result.status).toBe("needs_review");
    expect(result.stopReason).toMatch(/보존/);
    expect(result.cards).toEqual(before);
    expect(result.version).toBe(1);
    expect(result.brief.readingStyle).toBe("standard");
    expect(result.usage.modelCalls).toBe(1);
  });
});
