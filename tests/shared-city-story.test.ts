import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SharedCityStoryStore, sharedStoryRequestSchema } from "../src/lib/shared-city-story";
import { DEFAULT_BRIEF, newRun } from "../src/lib/run";
import { getPlace } from "../src/lib/places";
import { RunStore } from "../src/lib/store";
import { runAgent } from "../src/lib/agent";
import { searchSources } from "../src/lib/sources";
import type { Artifact, Run } from "../src/lib/types";

const routeState = vi.hoisted(() => ({
  run: undefined as Run | undefined,
  store: undefined as SharedCityStoryStore | undefined,
  readRun: vi.fn(),
}));
vi.mock("../src/lib/server", () => ({
  getService: () => ({ store: { get: (id: string) => { routeState.readRun(id); return routeState.run; } } }),
}));
vi.mock("../src/lib/shared-city-story", async importOriginal => ({
  ...await importOriginal<typeof import("../src/lib/shared-city-story")>(),
  getSharedCityStoryStore: () => routeState.store,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("../src/components/shared-city-story-viewer", () => ({ default: () => null }));
import { POST } from "../src/app/api/stories/route";
import { GET } from "../src/app/api/stories/[id]/route";
import StoryPage from "../src/app/stories/[id]/page";

const dirs: string[] = [];
const stores = new Set<SharedCityStoryStore>();
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "shared-city-story-"));
  dirs.push(dir);
  const path = join(dir, "stories.sqlite");
  const store = new SharedCityStoryStore(path);
  stores.add(store);
  return { store, path };
}
afterEach(() => {
  for (const store of stores) store.close();
  stores.clear();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  routeState.run = undefined;
  routeState.store = undefined;
  routeState.readRun.mockClear();
});

function approvedRun(): Run {
  const run = newRun({ mode: "fixture", brief: {
    ...DEFAULT_BRIEF, place: "율동공원", placeId: "yuldong-park", goal: "PRIVATE_GOAL",
    story: {
      title: "호수에서 박물관까지",
      stops: [
        { id: "park", placeId: "yuldong-park", note: "PRIVATE_NOTE", photoChoice: "place", camera: { position: [1, 2, 3], target: [0, 0, 0], zoom: 2 } },
        { id: "museum", placeId: "pangyo-museum", photoChoice: "place" },
      ],
      cardStopIds: ["park", "museum", "park", "museum"],
    },
  } });
  run.version = 3;
  run.reviewVersion = 3;
  run.status = "approved";
  run.approval = { version: 3, at: run.updatedAt, reviewer: "PRIVATE_REVIEWER" };
  for (const stop of run.brief.story!.stops) {
    const place = getPlace(stop.placeId)!;
    const quote = place.officialQuotes[0];
    run.sources.push({ id: `source-${stop.id}`, placeId: place.id, url: quote.sourceUrl, title: `${place.name} 공식 안내`, publisher: "성남시", retrievedAt: run.updatedAt, status: "ok", snapshot: `${quote.text}\nPRIVATE_SNAPSHOT`, hash: "PRIVATE_HASH", license: "인용" });
    run.evidence.push({ id: `evidence-${stop.id}`, sourceId: `source-${stop.id}`, quote: quote.text, locator: "PRIVATE_LOCATOR", start: 0, end: quote.text.length });
  }
  run.cards = run.brief.story!.cardStopIds.map((stopId, index) => {
    const stop = run.brief.story!.stops.find(item => item.id === stopId)!;
    const imagination = index === 3;
    const text = imagination ? "상상: 공원과 박물관의 기억이 미래로 이어집니다." : run.evidence.find(item => item.id === `evidence-${stopId}`)!.quote;
    const id = `card-${index + 1}`;
    run.claims.push({ id: `claim-${index + 1}`, cardId: id, text, kind: imagination ? "imagination" : "fact", evidenceIds: imagination ? [] : [`evidence-${stopId}`], support: imagination ? "not_applicable" : "supported" });
    return { id, placeId: stop.placeId, stopId, title: getPlace(stop.placeId)!.name, body: text, script: text, claimIds: [`claim-${index + 1}`], imagination };
  });
  const photo = getPlace("pangyo-museum")!.photo!;
  run.cards[1].image = { ...photo, id: "photo-pangyo-museum", placeId: "pangyo-museum", kind: "photo", sha256: "a".repeat(64), mime: "image/jpeg", createdAt: run.updatedAt, crop: { x: 0.5, y: 0.5, zoom: 1 }, prompt: { place: "PRIVATE_PROMPT", subject: "private", composition: "private", lighting: "private", palette: "private", materials: "private", referenceImage: null, textSpace: "private", imagination: false } };
  return run;
}

describe("approved public snapshots", () => {
  it("publishes only projected public fields and card-specific validated citations", () => {
    const { store } = setup();
    const run = approvedRun();
    // Unrelated evidence must not become a card's citation.
    run.evidence.push({ id: "unrelated", sourceId: "source-park", quote: "PRIVATE_SNAPSHOT", locator: "private" });
    const story = store.publish(run, run.version);
    expect(story).toMatchObject({ version: 3, title: run.brief.story!.title, audience: run.brief.audience, mode: "fixture" });
    expect(story).not.toHaveProperty("runId");
    expect(JSON.stringify(story)).not.toContain(run.id);
    expect(story.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(story.stops[0]).toEqual({ id: "park", placeId: "yuldong-park", camera: { position: [1, 2, 3], target: [0, 0, 0], zoom: 2 } });
    expect(story.cards[0].citations).toEqual([{ title: run.sources[0].title, url: run.sources[0].url, quote: run.evidence[0].quote, publisher: "성남시" }]);
    expect(story.cards[1].citations[0].title).toContain("판교박물관");
    expect(story.cards[3].citations).toEqual([]);
    expect(story.cards[1].image).toEqual({ src: run.cards[1].image!.src, kind: "photo", crop: run.cards[1].image!.crop, sourceUrl: run.cards[1].image!.sourceUrl, author: run.cards[1].image!.author, license: run.cards[1].image!.license });
    expect(JSON.stringify(story)).not.toContain("PRIVATE_");
    expect(Object.keys(story).sort()).toEqual(["id", "createdAt", "version", "title", "audience", "mode", "stops", "cards"].sort());
    expect(Object.keys(story.cards[0]).sort()).toEqual(["id", "title", "body", "imagination", "placeId", "stopId", "citations"].sort());
  });

  it("keeps snapshots unchanged across source-run edits, returned-object edits, retries and restart", () => {
    const { store, path } = setup();
    const run = approvedRun();
    const initial = store.publish(run, run.version);
    const expected = structuredClone(initial);
    initial.cards[0].body = "edited response";
    run.cards[0].body = "edited source";
    run.brief.story!.stops[0].camera!.position[0] = 999;
    expect(store.publish(run, run.version)).toEqual(expected);
    run.version++;
    run.reviewVersion = run.version;
    run.approval!.version = run.version;
    const next = store.publish(run, run.version);
    expect(next.id).not.toBe(expected.id);
    store.close(); stores.delete(store);
    const reopened = new SharedCityStoryStore(path); stores.add(reopened);
    expect(reopened.get(expected.id)).toEqual(expected);
    expect(reopened.get(next.id)).toEqual(next);
    expect(reopened.get(randomUUID())).toBeUndefined();
  });

  it("uses a separate table alongside RunStore without changing its records", () => {
    const { store, path } = setup();
    const runs = new RunStore(path);
    try {
      const run = approvedRun(); runs.insert(run, "shared-snapshot-test");
      const story = store.publish(runs.get(run.id), run.version);
      expect(runs.get(run.id)).toEqual(run);
      expect(store.get(story.id)).toEqual(story);
      expect(story).not.toHaveProperty("runId");
      const db = new DatabaseSync(path);
      try {
        expect(db.prepare("SELECT run_id FROM shared_city_stories WHERE id = ?").get(story.id)).toMatchObject({ run_id: run.id });
        const payload = db.prepare("SELECT payload FROM shared_city_stories WHERE id = ?").get(story.id) as { payload: string };
        expect(payload.payload).not.toContain(run.id);
      } finally { db.close(); }
    } finally { runs.close(); }
  });

  it("strips the private run ID and extra fields from previously stored snapshots", () => {
    const { store, path } = setup();
    const run = approvedRun();
    const story = store.publish(run, run.version);
    const legacyId = randomUUID();
    const legacy = { ...story, id: legacyId, runId: run.id, note: "PRIVATE_NOTE", cards: story.cards.map(card => ({ ...card, image: card.image ? { ...card.image, crop: undefined } : undefined, script: "PRIVATE_SCRIPT" })) };
    const db = new DatabaseSync(path);
    try {
      db.prepare("INSERT INTO shared_city_stories (id, run_id, version, created_at, payload) VALUES (?, ?, ?, ?, ?)")
        .run(legacyId, randomUUID(), story.version, story.createdAt, JSON.stringify(legacy));
    } finally { db.close(); }
    const published = store.get(legacyId);
    expect(published).toEqual({ ...story, id: legacyId });
    expect(published).not.toHaveProperty("runId");
    expect(JSON.stringify(published)).not.toContain(run.id);
    expect(JSON.stringify(published)).not.toContain("PRIVATE_");
  });

  it("retains the approved crop independently of later source and response mutations", () => {
    const { store } = setup();
    const run = approvedRun();
    run.cards[1].image!.crop = { x: 0.2, y: 0.85, zoom: 2.6 };
    const story = store.publish(run, run.version);
    expect(story.cards[1].image?.crop).toEqual({ x: 0.2, y: 0.85, zoom: 2.6 });
    run.cards[1].image!.crop.x = 0.9;
    story.cards[1].image!.crop.y = 0.1;
    expect(store.get(story.id)?.cards[1].image?.crop).toEqual({ x: 0.2, y: 0.85, zoom: 2.6 });
  });

  it.each([
    { x: -0.01, y: 0.5, zoom: 1 },
    { x: 1.01, y: 0.5, zoom: 1 },
    { x: 0.5, y: -0.01, zoom: 1 },
    { x: 0.5, y: 1.01, zoom: 1 },
    { x: 0.5, y: 0.5, zoom: 0.9 },
    { x: 0.5, y: 0.5, zoom: 3.1 },
    { x: Number.NaN, y: 0.5, zoom: 1 },
    { x: 0.5, y: Number.POSITIVE_INFINITY, zoom: 1 },
  ])("rejects invalid approved crop %j", crop => {
    const { store } = setup();
    const run = approvedRun();
    run.cards[1].image!.crop = crop;
    expect(() => store.publish(run, run.version)).toThrow(expect.objectContaining({ status: 409 }));
  });

  it("keeps an explicitly approved same-place image after a stop started text-only", () => {
    const { store } = setup();
    const run = approvedRun();
    run.brief.story!.stops[1].photoChoice = "none";
    expect(store.publish(run, run.version).cards[1].image?.src).toBe(run.cards[1].image!.src);
  });

  it("accepts the real reviewed multi-stop fixture pipeline after approval", async () => {
    const { store } = setup();
    const run = await runAgent(newRun({ mode: "fixture", brief: approvedRun().brief }), {
      search: searchSources,
      render: async current => [
        ...[1, 2, 3, 4].map(index => ({ name: `card-${index}.png`, kind: "png" })),
        { name: "bundle.zip", kind: "zip" }, { name: "script.txt", kind: "text" }, { name: "review.json", kind: "json" },
      ].map(item => ({ ...item, path: item.name, sha256: "test-render", version: current.version, reviewVersion: current.version })) as Artifact[],
      persist: () => {}, signal: new AbortController().signal,
    });
    expect(run.status).toBe("ready_for_approval");
    run.status = "approved";
    run.approval = { version: run.version, at: run.updatedAt, reviewer: "PRIVATE_REVIEWER" };
    const story = store.publish(run, run.version);
    expect(story.cards.slice(0, 3).every(card => card.citations.length > 0)).toBe(true);
    expect(story.cards.map(card => card.placeId)).toEqual(["yuldong-park", "pangyo-museum", "yuldong-park", "pangyo-museum"]);
    expect(JSON.stringify(story)).not.toContain("PRIVATE_");
  });

  it("rejects missing runs and does not return an existing snapshot for a stale request", () => {
    const { store } = setup();
    expect(() => store.publish(undefined, 3)).toThrow(expect.objectContaining({ status: 404 }));
    const run = approvedRun(); const story = store.publish(run, 3);
    run.version = 4;
    expect(() => store.publish(run, 3)).toThrow(expect.objectContaining({ status: 409 }));
    expect(store.get(story.id)).toBeDefined();
  });

  it.each([
    ["unapproved", (run: Run) => { run.status = "ready_for_approval"; }],
    ["missing approval", (run: Run) => { run.approval = null; }],
    ["stale approval", (run: Run) => { run.approval!.version = 2; }],
    ["stale review", (run: Run) => { run.reviewVersion = 2; }],
    ["missing story", (run: Run) => { delete run.brief.story; }],
    ["open issue", (run: Run) => { run.issues.push({ id: "issue", targetId: "card-1", type: "source", severity: "error", message: "private", evidenceIds: [], recommendation: "private", resolved: false }); }],
    ["missing card", (run: Run) => { run.cards.pop(); }],
    ["wrong card order", (run: Run) => { run.cards.reverse(); }],
    ["wrong place", (run: Run) => { run.cards[0].placeId = "pangyo-museum"; }],
    ["wrong stop", (run: Run) => { run.cards[0].stopId = "museum"; }],
    ["cross-card claim", (run: Run) => { run.cards[0].claimIds = ["claim-2"]; }],
    ["missing claim", (run: Run) => { run.cards[0].claimIds = ["missing"]; }],
    ["unsupported fact", (run: Run) => { run.claims[0].support = "insufficient"; }],
    ["missing citation", (run: Run) => { run.claims[0].evidenceIds = []; }],
    ["cross-place citation", (run: Run) => { run.claims[0].evidenceIds = ["evidence-museum"]; }],
    ["missing source place", (run: Run) => { delete run.sources[0].placeId; }],
    ["invalid quote", (run: Run) => { run.evidence[0].quote = "unverified"; }],
    ["unavailable source", (run: Run) => { run.sources[0].status = "unavailable"; }],
    ["unregistered source", (run: Run) => { run.sources[0].url = "https://example.com/private"; }],
    ["duplicate evidence ID", (run: Run) => { run.evidence.push({ ...run.evidence[0] }); }],
    ["cross-place image", (run: Run) => { run.cards[1].image!.placeId = "yuldong-park"; }],
    ["arbitrary image path", (run: Run) => { run.cards[1].image!.src = "/api/runs/private"; }],
    ["invalid camera", (run: Run) => { run.brief.story!.stops[0].camera!.zoom = Number.POSITIVE_INFINITY; }],
  ])("rejects %s before saving", (_label, mutate) => {
    const { store } = setup(); const run = approvedRun();
    mutate(run);
    expect(() => store.publish(run, 3)).toThrow(expect.objectContaining({ status: 409 }));
  });
});

describe("share request and route boundaries", () => {
  it.each([
    { runId: "../../private", version: 3 },
    { runId: randomUUID(), version: "3" },
    { runId: randomUUID(), version: -1 },
    { runId: randomUUID(), version: 1.5 },
    { runId: randomUUID(), version: Number.MAX_SAFE_INTEGER + 1 },
    { runId: randomUUID(), version: 3, note: "private" },
  ])("rejects invalid input %j", input => {
    expect(sharedStoryRequestSchema.safeParse(input).success).toBe(false);
  });

  it("POST and GET return the same immutable projection and no-store response", async () => {
    routeState.store = setup().store; routeState.run = approvedRun();
    const response = await POST(new Request("http://localhost:3000/api/stories", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: routeState.run.id, version: 3 }) }));
    expect(response.status).toBe(200);
    const story = await response.json();
    expect(story).not.toHaveProperty("runId");
    expect(JSON.stringify(story)).not.toContain(routeState.run.id);
    routeState.run = undefined;
    const fetched = await GET(new Request(`http://localhost:3000/api/stories/${story.id}`), { params: Promise.resolve({ id: story.id }) });
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get("cache-control")).toBe("no-store");
    expect(await fetched.json()).toEqual(story);
    expect(routeState.readRun).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(story)).not.toContain("PRIVATE_");
  });

  it("rejects unknown keys, malformed JSON, cross-origin POST, stale versions and missing runs", async () => {
    routeState.store = setup().store; routeState.run = approvedRun();
    const post = (body: string, origin?: string) => POST(new Request("http://localhost:3000/api/stories", { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body }));
    expect((await post(JSON.stringify({ runId: routeState.run.id, version: 3, private: true }))).status).toBe(400);
    expect((await post("{")).status).toBe(400);
    expect((await post(JSON.stringify({ runId: routeState.run.id, version: 3 }), "https://example.com")).status).toBe(403);
    expect(routeState.readRun).not.toHaveBeenCalled();
    expect((await post(JSON.stringify({ runId: routeState.run.id, version: 2 }))).status).toBe(409);
    routeState.run = undefined;
    expect((await post(JSON.stringify({ runId: randomUUID(), version: 3 }))).status).toBe(404);
  });

  it("opens the shared page only for a stored snapshot and sends other links to the not-found page", async () => {
    routeState.store = setup().store;
    const story = routeState.store.publish(approvedRun(), 3);
    const open = (id: string) => StoryPage({ params: Promise.resolve({ id }) });
    expect((await open(story.id)).props).toEqual({ id: story.id });
    for (const id of [randomUUID(), "does-not-exist", "11111111-1111-1111-1111-111111111111"]) await expect(open(id)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("GET accepts UUIDs only and returns 404 for missing snapshots", async () => {
    routeState.store = setup().store;
    for (const [id, expectedStatus] of [["../../runs/private", 400], [randomUUID(), 404]] as const) {
      const response = await GET(new Request("http://localhost:3000/api/stories/test"), { params: Promise.resolve({ id }) });
      expect(response.status).toBe(expectedStatus);
    }
    expect(routeState.readRun).not.toHaveBeenCalled();
  });
});
