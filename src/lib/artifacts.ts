import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { Run, Artifact } from "./types";
import { AppError } from "./service";
const required = [
  "card-1.png",
  "card-2.png",
  "card-3.png",
  "card-4.png",
  "script.md",
  "sources.json",
  "review.json",
  "timestory.zip",
];
async function bytes(run: Run, artifact: Artifact): Promise<Buffer> {
  if (
    artifact.version !== run.version ||
    artifact.reviewVersion !== run.version ||
    run.reviewVersion !== run.version
  )
    throw new AppError("출력 파일의 검수 버전이 일치하지 않습니다.", 409);
  const expected = resolve("outputs", run.id, `v${run.version}`, artifact.name);
  if (!required.includes(artifact.name) || resolve(artifact.path) !== expected)
    throw new AppError("허용되지 않은 출력 경로입니다.", 400);
  const actual = await realpath(expected);
  const root = await realpath(resolve("outputs"));
  if (!actual.startsWith(root + sep) || actual !== expected)
    throw new AppError("허용되지 않은 출력 경로입니다.", 400);
  const data = await readFile(actual);
  if (createHash("sha256").update(data).digest("hex") !== artifact.sha256)
    throw new AppError("출력 파일이 변경되었습니다. 다시 생성하세요.", 409);
  return data;
}
export async function checkArtifacts(run: Run): Promise<boolean> {
  if (
    run.reviewVersion !== run.version ||
    run.artifacts.length !== required.length ||
    required.some((n) => run.artifacts.filter((a) => a.name === n).length !== 1)
  )
    return false;
  try {
    await Promise.all(run.artifacts.map((a) => bytes(run, a)));
    return true;
  } catch {
    return false;
  }
}
export async function artifactBytes(run: Run, name: string): Promise<Buffer> {
  if (
    !["ready_for_approval", "approved"].includes(run.status) ||
    run.issues.some((i) => !i.resolved)
  )
    throw new AppError("검수를 완료한 결과물만 다운로드할 수 있습니다.", 409);
  const artifact = run.artifacts.find((a) => a.name === name);
  if (!artifact) throw new AppError("파일을 찾을 수 없습니다.", 404);
  return bytes(run, artifact);
}

export async function downloadCurrentArtifact(
  id: string,
  name: string,
  readRun: (id: string) => Run | undefined,
  read = artifactBytes,
): Promise<Buffer> {
  const run = readRun(id);
  if (!run) throw new AppError("제작 기록을 찾을 수 없습니다.", 404);
  const data = await read(run, name);
  const current = readRun(id);
  if (
    !current ||
    current.version !== run.version ||
    current.reviewVersion !== run.reviewVersion ||
    !["ready_for_approval", "approved"].includes(current.status) ||
    current.issues.some((i) => !i.resolved) ||
    current.artifacts.find((a) => a.name === name)?.sha256 !==
      run.artifacts.find((a) => a.name === name)?.sha256
  )
    throw new AppError(
      "읽는 동안 콘텐츠 또는 검수 상태가 변경되었습니다. 최신 결과를 다시 확인하세요.",
      409,
    );
  return data;
}
