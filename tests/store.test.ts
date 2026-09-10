import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunStore } from "../src/lib/store";
import { newRun } from "../src/lib/run";

const dirs: string[] = [];
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "timestory-store-"));
  dirs.push(dir);
  return new RunStore(join(dir, "runs.sqlite"));
}
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);

describe("persistent run state", () => {
  it("deduplicates one submitted request and retains complete evidence and events", () => {
    const store = setup();
    const run = newRun({ mode: "fixture", scenario: "normal" });
    store.insert(run, "request-1");
    expect(store.findRequest("request-1")?.id).toBe(run.id);
    run.events.push({
      id: "e1",
      at: run.createdAt,
      action: "started",
      message: "시작",
      version: 1,
    });
    store.save(run);
    expect(store.get(run.id)?.events[0].message).toBe("시작");
    expect(() =>
      store.insert(newRun({ mode: "fixture" }), "request-1"),
    ).toThrow();
    expect(store.list()).toHaveLength(1);
    store.close();
  });
  it("marks interrupted jobs for human review without disturbing completed jobs", () => {
    const store = setup();
    const active = newRun({ mode: "fixture" });
    active.status = "running";
    const complete = newRun({ mode: "fixture" });
    complete.status = "approved";
    store.insert(active, "a");
    store.insert(complete, "b");
    store.recoverInterrupted();
    expect(store.get(active.id)?.status).toBe("needs_review");
    expect(store.get(active.id)?.stopReason).toContain("중단");
    expect(store.get(complete.id)?.status).toBe("approved");
    store.close();
  });
});

it("conservatively recovers active duration so restart cannot reset the execution budget", () => {
  const store = setup();
  const run = newRun({ mode: "fixture" });
  run.status = "running";
  run.startedAt = new Date(Date.now() - 5000).toISOString();
  run.usage.elapsedMs = 100;
  store.insert(run, "interrupted");
  store.recoverInterrupted();
  const recovered = store.get(run.id)!;
  expect(recovered.usage.elapsedMs).toBeGreaterThanOrEqual(5000);
  expect(recovered.usage.elapsedMs).toBeLessThanOrEqual(
    run.limits.maxDurationMs,
  );
  store.close();
});
