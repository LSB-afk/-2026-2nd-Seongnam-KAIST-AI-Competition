import { afterEach, describe, expect, it, vi } from "vitest";
import { newRun } from "../src/lib/run";
import { RunService } from "../src/lib/service";
import { RunStore } from "../src/lib/store";
import type { ImagePrompt } from "../src/lib/types";

const stores: RunStore[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  stores.splice(0).forEach(store => store.close());
});

const prompt: ImagePrompt = {
  place: "판교박물관", subject: "박물관 외관", composition: "square",
  lighting: "daylight", palette: "natural", materials: "stone",
  referenceImage: null, textSpace: "top", imagination: false,
};

function readyRun() {
  const store = new RunStore(":memory:");
  stores.push(store);
  const run = newRun({ mode: "fixture" });
  run.version = 1;
  run.reviewVersion = 1;
  run.status = "ready_for_approval";
  run.cards = [{ id: "c1", title: "박물관", body: "박물관 소개", script: "박물관 소개", claimIds: [], imagination: false }];
  store.insert(run, "image-race");
  return { store, run };
}

describe("image job concurrency and restart accounting", () => {
  it("rejects approval when image generation starts during artifact verification", async () => {
    const { store, run } = readyRun();
    let finishCheck!: (valid: boolean) => void;
    const checking = new Promise<boolean>(resolve => { finishCheck = resolve; });
    const service = new RunService(store, {
      runner: async current => current,
      search: async () => ({ sources: [], evidence: [] }),
      render: async () => [],
      checkArtifacts: async () => checking,
      image: {
        configured: () => true,
        defaultImage: async () => undefined,
        getAsset: async () => { throw new Error("unused"); },
        buildPrompt: () => prompt,
        generate: async (_run, _prompt, _reference, signal) => new Promise((_resolve, reject) => {
          signal.throwIfAborted();
          signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
        }),
      },
    });
    const approval = service.approve(run.id, { version: 1, reviewer: "담당자" });
    try {
      await service.image(run.id, { version: 1, cardId: "c1", operation: "generate" });
      expect(store.get(run.id)?.imageJob?.status).toBe("running");
      finishCheck(true);
      await expect(approval).rejects.toMatchObject({ status: 409 });
      expect(store.get(run.id)?.approval).toBeNull();
    } finally {
      finishCheck(true);
      if (store.get(run.id)?.imageJob?.status === "running") service.cancelImage(run.id, { version: 1 });
      await service.idle(run.id);
    }
  });

  it("does not charge persisted image-job elapsed time twice on restart", () => {
    const { store, run } = readyRun();
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    run.limits.maxDurationMs = 300_000;
    run.usage.elapsedMs = 40_000;
    run.usage.costUsd = 0.2;
    run.imageJob = {
      id: "interrupted-image", cardId: "c1", expectedVersion: 1,
      status: "running", startedAt: new Date(now - 30_000).toISOString(),
      baseElapsedMs: 10_000, prompt,
    };
    store.save(run);
    store.recoverInterrupted();
    const recovered = store.get(run.id)!;
    expect(recovered.usage.elapsedMs).toBe(40_000);
    expect(recovered.usage.costUsd).toBe(0.2);
    expect(recovered.imageJob?.status).toBe("failed");
    expect(recovered.version).toBe(1);
  });
});
