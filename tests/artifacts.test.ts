import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { newRun } from "../src/lib/run";
import { checkArtifacts, artifactBytes } from "../src/lib/artifacts";
const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);
function setup() {
  const run = newRun({ mode: "fixture" });
  run.version = 1;
  run.reviewVersion = 1;
  run.status = "ready_for_approval";
  const dir = resolve("outputs", run.id, "v1");
  dirs.push(resolve("outputs", run.id));
  mkdirSync(dir, { recursive: true });
  for (const name of [
    "card-1.png",
    "card-2.png",
    "card-3.png",
    "card-4.png",
    "script.md",
    "sources.json",
    "review.json",
    "timestory.zip",
  ]) {
    const data = Buffer.from(name);
    writeFileSync(resolve(dir, name), data);
    run.artifacts.push({
      name,
      path: resolve(dir, name),
      sha256: createHash("sha256").update(data).digest("hex"),
      version: 1,
      reviewVersion: 1,
      kind: name.endsWith(".png")
        ? "png"
        : name.endsWith(".zip")
          ? "zip"
          : name.endsWith(".md")
            ? "text"
            : "json",
    });
  }
  return run;
}
it("blocks approval and download if an output has been modified on disk", async () => {
  const run = setup();
  expect(await checkArtifacts(run)).toBe(true);
  writeFileSync(run.artifacts[0].path, "changed");
  expect(await checkArtifacts(run)).toBe(false);
  await expect(artifactBytes(run, "card-1.png")).rejects.toThrow(/변경/);
});
it("blocks old version and files outside the run output directory", async () => {
  const run = setup();
  run.version = 2;
  expect(await checkArtifacts(run)).toBe(false);
  await expect(artifactBytes(run, "script.md")).rejects.toThrow();
  run.version = 1;
  run.artifacts[0].path = "/etc/passwd";
  await expect(artifactBytes(run, "card-1.png")).rejects.toThrow();
});
it("blocks output delivery while review is not complete", async () => {
  const run = setup();
  run.status = "needs_review";
  await expect(artifactBytes(run, "timestory.zip")).rejects.toThrow(/검수/);
});

it("rechecks the current review after asynchronous file reads before delivering bytes", async () => {
  const { downloadCurrentArtifact } = await import("../src/lib/artifacts");
  const original = setup();
  let current = structuredClone(original);
  let release!: () => void;
  const pause = new Promise<void>((r) => (release = r));
  const pending = downloadCurrentArtifact(
    original.id,
    "card-1.png",
    () => current,
    async () => {
      await pause;
      return Buffer.from("old bytes");
    },
  );
  current = {
    ...current,
    version: 2,
    reviewVersion: null,
    status: "needs_review",
    artifacts: [],
  };
  release();
  await expect(pending).rejects.toThrow(/변경/);
});
