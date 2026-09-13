import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runAgent } from "../src/lib/agent";
import { checkArtifacts } from "../src/lib/artifacts";
import { defaultPlaceImage, readImage } from "../src/lib/images";
import { PLACES } from "../src/lib/places";
import { renderCards } from "../src/lib/render";
import { newRun } from "../src/lib/run";
import { searchSources } from "../src/lib/sources";
import type { CardImage } from "../src/lib/types";

// This probe must never turn into a paid/live evaluation through configuration.
let blockedFetchAttempts = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  blockedFetchAttempts += 1;
  throw new Error("Fixture place probe forbids network fetch/API calls.");
};

const results = [];
try {
  // Deliberately sequential: one Chromium renderer at a time.
  for (const place of PLACES) {
    const run = newRun({
      mode: "fixture",
      scenario: "normal",
      strategy: "agent",
      brief: {
        placeId: place.id,
        place: place.name,
        audience: "청소년",
        goal: `${place.name}을 소개하는 카드뉴스 4장을 만들고 마지막 장은 미래 문화공간을 상상해 주세요.`,
        cardCount: 4,
        includeFuture: true,
      },
    });
    const started = performance.now();
    const errors: string[] = [];
    const pngs: { name: string; path: string; sha256: string; width: number; height: number }[] = [];
    let artifactHashesValid = false;
    let outputChecks: unknown = null;
    try {
      await runAgent(run, {
        search: searchSources,
        persist: () => {},
        signal: AbortSignal.timeout(run.limits.maxDurationMs),
        render: async (current, signal) => {
          // Match the server adapter, including the persisted revision snapshot.
          if (current.cards.some((card) => !card.image)) {
            const photo = await defaultPlaceImage(current.brief.placeId ?? current.brief.place);
            signal.throwIfAborted();
            assert.ok(photo, `No licensed place photo: ${place.id}`);
            for (const card of current.cards) card.image ??= structuredClone(photo);
            const revision = current.revisions.find((item) => item.version === current.version);
            if (revision) revision.cards = structuredClone(current.cards);
          }
          return renderCards(current, signal);
        },
      });
      assert.equal(run.status, "ready_for_approval", run.stopReason ?? "Run did not finish");
      assert.equal(run.cards.length, 4);
      assert.equal(run.cards[3].imagination, true);
      assert.equal(run.brief.placeId, place.id);
      assert.equal(run.brief.place, place.name);
      assert.equal(run.execution?.apiCalls, 0);
      assert.equal(run.usage.modelCalls, 0);
      assert.equal(run.usage.costUsd, 0);
      artifactHashesValid = await checkArtifacts(run);
      assert.equal(artifactHashesValid, true);
      for (const card of run.cards) {
        assert.equal(card.image?.placeId, place.id);
        assert.equal(card.image?.kind, "photo");
        const bytes = await readImage(card.image!);
        assert.equal(createHash("sha256").update(bytes).digest("hex"), card.image!.sha256);
      }
      for (const artifact of run.artifacts.filter((item) => item.kind === "png")) {
        const bytes = await readFile(artifact.path);
        assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
        assert.equal(bytes.readUInt32BE(16), 1080);
        assert.equal(bytes.readUInt32BE(20), 1080);
        assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256);
        pngs.push({ name: artifact.name, path: artifact.path, sha256: artifact.sha256, width: 1080, height: 1080 });
      }
      assert.equal(pngs.length, 4);
      const directory = resolve("outputs", run.id, `v${run.version}`);
      const sources = JSON.parse(await readFile(resolve(directory, "sources.json"), "utf8"));
      assert.equal(sources.images.length, 4);
      assert.ok(sources.images.every((photo: CardImage) => photo.placeId === place.id && photo.sha256 === run.cards[0].image?.sha256));
      const review = JSON.parse(await readFile(resolve(directory, "review.json"), "utf8"));
      outputChecks = review.outputChecks;
      assert.equal(review.outputChecks.overflow, false);
      assert.equal(review.outputChecks.imagesLoaded, true);
      assert.equal(review.outputChecks.fontsLoaded, true);
      assert.equal(review.version, run.version);
      assert.equal(review.reviewVersion, run.version);
      assert.match(await readFile(resolve(directory, "script.md"), "utf8"), /상상 장면/);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
    const row = {
      id: place.id,
      name: place.name,
      mode: run.mode,
      scenario: run.scenario,
      runId: run.id,
      status: run.status,
      version: run.version,
      reviewVersion: run.reviewVersion,
      cardCount: run.cards.length,
      finalCardImagination: run.cards[3]?.imagination ?? false,
      photoAssets: run.cards.map((card) => ({ cardId: card.id, placeId: card.image?.placeId, src: card.image?.src, sha256: card.image?.sha256, license: card.image?.license })),
      sources: run.sources.map((source) => ({ id: source.id, url: source.url })),
      pngs,
      outputChecks,
      artifactHashesValid,
      apiCalls: run.execution?.apiCalls ?? 0,
      modelCalls: run.usage.modelCalls,
      apiCostUsd: run.usage.costUsd,
      elapsedMs: Math.round(performance.now() - started),
      stopReason: run.stopReason,
      errors,
    };
    results.push(row);
    console.log(`${place.id}: ${errors.length ? "FAIL" : "PASS"} ${run.status} PNG=${pngs.length} API=${row.apiCalls} ${row.elapsedMs}ms${errors.length ? ` ${errors.join("; ")}` : ""}`);
  }
} finally {
  globalThis.fetch = originalFetch;
}

const report = {
  generatedAt: new Date().toISOString(),
  scope: "Eight distinct place fixtures with actual licensed local photos and real Chromium PNG/ZIP rendering. Verifies integration and output integrity; does not measure live AI quality, fresh web retrieval, or human approval.",
  apiCalls: results.reduce((sum, row) => sum + row.apiCalls, 0),
  blockedFetchAttempts,
  expectedPlaces: PLACES.length,
  completedPlaces: results.filter((row) => !row.errors.length).length,
  pngCount: results.reduce((sum, row) => sum + row.pngs.length, 0),
  results,
};
await mkdir("outputs/evaluation", { recursive: true });
await writeFile("outputs/evaluation/place-probe.json", JSON.stringify(report, null, 2) + "\n");
console.log(`Place fixture report: ${resolve("outputs/evaluation/place-probe.json")}`);
if (results.some((row) => row.errors.length) || blockedFetchAttempts || report.apiCalls || results.length !== PLACES.length) process.exitCode = 1;
