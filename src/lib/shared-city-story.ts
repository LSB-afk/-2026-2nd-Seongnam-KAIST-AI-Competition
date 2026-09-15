import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { cityStoryBriefSchema, storyCameraSchema } from "./city-story";
import { getPlace } from "./places";
import { AppError } from "./service";
import { evidenceIsValid } from "./verifier";
import type { CardImage, Run } from "./types";

export const sharedStoryIdSchema = z.uuid();
const versionSchema = z.number().int().nonnegative();
export const sharedStoryRequestSchema = z.object({
  runId: sharedStoryIdSchema,
  version: versionSchema,
}).strict();

const publicUrlSchema = z.url().max(2048).refine(value => {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
});
const publicIdSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const imageCropSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  zoom: z.number().finite().min(1).max(3),
}).strict();
const publicImageSchema = z.object({
  src: z.string().regex(/^\/(?:places\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}\.(?:jpe?g|png|webp)|api\/images\/[a-zA-Z0-9_-]{1,80})$/),
  kind: z.enum(["photo", "upload", "ai"]),
  // Older public snapshots did not record crop and used the centered default.
  crop: imageCropSchema.default(() => ({ x: 0.5, y: 0.5, zoom: 1 })),
  sourceUrl: publicUrlSchema.optional(),
  author: z.string().min(1).max(500).optional(),
  license: z.string().min(1).max(500).optional(),
});
// Parsing strips all unlisted fields, including on reads from an older database.
const sharedCityStorySchema = z.object({
  id: sharedStoryIdSchema,
  createdAt: z.iso.datetime(),
  version: versionSchema,
  title: z.string().min(1).max(80),
  audience: z.string().min(1).max(40),
  mode: z.enum(["fixture", "live"]),
  stops: z.array(z.object({
    id: publicIdSchema,
    placeId: publicIdSchema,
    camera: storyCameraSchema.optional(),
  })).min(2).max(3),
  cards: z.array(z.object({
    id: publicIdSchema,
    title: z.string().min(1).max(80),
    body: z.string().min(1).max(500),
    imagination: z.boolean(),
    placeId: publicIdSchema,
    stopId: publicIdSchema,
    image: publicImageSchema.optional(),
    citations: z.array(z.object({
      title: z.string().min(1).max(1000),
      url: publicUrlSchema,
      quote: z.string().min(1).max(8000),
      publisher: z.string().min(1).max(500),
    })).max(40),
  })).length(4),
});
export type SharedCityStory = z.infer<typeof sharedCityStorySchema>;

function invalidStory(): never {
  throw new AppError("이야기의 장소·카드·출처를 다시 검수하고 승인한 뒤 공유하세요.", 409);
}

function publicImage(image: CardImage | undefined, placeId: string): SharedCityStory["cards"][number]["image"] {
  if (!image) return undefined;
  if (image.placeId !== placeId) invalidStory();
  if (image.kind === "photo") {
    if (image.src !== getPlace(placeId)?.photo?.src) invalidStory();
  } else if (!/^[a-zA-Z0-9_-]{1,80}$/.test(image.id) || image.src !== `/api/images/${image.id}`) {
    invalidStory();
  }
  const sourceUrl = publicUrlSchema.safeParse(image.sourceUrl);
  const crop = imageCropSchema.safeParse(image.crop);
  if (!crop.success) invalidStory();
  const result = publicImageSchema.safeParse({
    src: image.src, kind: image.kind, crop: crop.data,
    ...(sourceUrl.success ? { sourceUrl: sourceUrl.data } : {}),
    author: image.author, license: image.license,
  });
  if (!result.success) invalidStory();
  return result.data;
}

/** This projection never includes the private run ID, brief, reviewer, scripts or source snapshots. */
function projectApprovedStory(run: Run, version: number): SharedCityStory {
  const brief = cityStoryBriefSchema.safeParse(run.brief.story);
  if (!brief.success || run.cards.length !== 4) invalidStory();
  for (const items of [run.cards, run.claims, run.sources, run.evidence]) {
    if (items.some(item => !item.id) || new Set(items.map(item => item.id)).size !== items.length) invalidStory();
  }
  const claims = new Map(run.claims.map(claim => [claim.id, claim]));
  const evidence = new Map(run.evidence.map(item => [item.id, item]));
  const sources = new Map(run.sources.map(source => [source.id, source]));
  const cards = run.cards.map((card, index) => {
    const stop = brief.data.stops.find(item => item.id === brief.data.cardStopIds[index]);
    if (!stop || card.id !== `card-${index + 1}` || card.stopId !== stop.id || card.placeId !== stop.placeId
      || card.imagination !== (index === 3) || !card.claimIds.length
      || new Set(card.claimIds).size !== card.claimIds.length) invalidStory();
    const cardClaims = card.claimIds.map(id => {
      const claim = claims.get(id);
      if (!claim || claim.cardId !== card.id) invalidStory();
      return claim;
    });
    if (index < 3 && !cardClaims.some(claim => claim.kind === "fact")) invalidStory();
    const citations: SharedCityStory["cards"][number]["citations"] = [];
    const seen = new Set<string>();
    for (const claim of cardClaims) {
      if (claim.kind === "fact" && (claim.support !== "supported" || !claim.evidenceIds.length)) invalidStory();
      for (const evidenceId of claim.evidenceIds) {
        const cited = evidence.get(evidenceId);
        const source = cited && sources.get(cited.sourceId);
        if (!cited || !source || source.placeId !== stop.placeId) invalidStory();
        let valid = false;
        try { valid = evidenceIsValid(run, evidenceId, stop.placeId); } catch { /* A malformed source cannot be published. */ }
        if (!valid) invalidStory();
        // Imagination may have contextual evidence, but it is not a factual citation.
        if (claim.kind !== "fact") continue;
        const key = JSON.stringify([source.url, cited.quote]);
        if (!seen.has(key)) {
          seen.add(key);
          citations.push({ title: source.title, url: source.url, quote: cited.quote, publisher: source.publisher });
        }
      }
    }
    const image = publicImage(card.image, stop.placeId);
    return {
      id: card.id, title: card.title, body: card.body, imagination: card.imagination,
      placeId: stop.placeId, stopId: stop.id, ...(image ? { image } : {}), citations,
    };
  });
  const result = sharedCityStorySchema.safeParse({
    id: randomUUID(), createdAt: new Date().toISOString(), version,
    title: brief.data.title, audience: run.brief.audience, mode: run.mode,
    stops: brief.data.stops.map(stop => ({ id: stop.id, placeId: stop.placeId, ...(stop.camera ? { camera: stop.camera } : {}) })),
    cards,
  });
  if (!result.success || Buffer.byteLength(JSON.stringify(result.data), "utf8") > 256 * 1024) invalidStory();
  return result.data;
}

/** Insert-only snapshots share a database file with runs, but never update the runs table. */
export class SharedCityStoryStore {
  private db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS shared_city_stories (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        UNIQUE(run_id, version)
      );
    `);
  }

  private decode(row: unknown): SharedCityStory | undefined {
    if (!row) return undefined;
    return sharedCityStorySchema.parse(JSON.parse((row as { payload: string }).payload));
  }

  get(id: string): SharedCityStory | undefined {
    const validId = sharedStoryIdSchema.parse(id);
    return this.decode(this.db.prepare("SELECT payload FROM shared_city_stories WHERE id = ?").get(validId));
  }

  publish(run: Run | undefined, version: number): SharedCityStory {
    versionSchema.parse(version);
    if (!run) throw new AppError("제작 기록을 찾을 수 없습니다.", 404);
    const runId = sharedStoryIdSchema.parse(run.id);
    if (run.version !== version || run.status !== "approved" || run.approval?.version !== version
      || run.reviewVersion !== version || run.issues.some(issue => !issue.resolved) || run.imageJob?.status === "running") {
      throw new AppError("현재 버전의 검수와 승인을 마친 이야기만 공유할 수 있습니다.", 409);
    }
    const story = projectApprovedStory(run, version);
    this.db.prepare(`INSERT INTO shared_city_stories (id, run_id, version, created_at, payload)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(run_id, version) DO NOTHING`)
      .run(story.id, runId, story.version, story.createdAt, JSON.stringify(story));
    // A retry or another process may have inserted first. Return that original snapshot.
    return this.decode(this.db.prepare("SELECT payload FROM shared_city_stories WHERE run_id = ? AND version = ?").get(run.id, version))!;
  }

  close(): void { this.db.close(); }
}

const globals = globalThis as typeof globalThis & { timestorySharedCityStoryStore?: SharedCityStoryStore };
export function getSharedCityStoryStore(): SharedCityStoryStore {
  return globals.timestorySharedCityStoryStore ??= new SharedCityStoryStore(resolve(process.env.TIMESTORY_DB_PATH ?? "data/timestory.sqlite"));
}
