import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runAgent } from "../src/lib/agent";
import { checkArtifacts } from "../src/lib/artifacts";
import { defaultPlaceImage } from "../src/lib/images";
import { getPlace } from "../src/lib/places";
import { PURPOSES, goalForPurpose } from "../src/lib/purposes";
import { DEFAULT_BRIEF, newRun } from "../src/lib/run";
import { renderCards } from "../src/lib/render";
import { searchSources } from "../src/lib/sources";

// Rebuild with: node --import tsx scripts/build-example.ts
// Fixed local evidence and photographs only. Never call a paid model or fetch web sources.
const priorFetch = globalThis.fetch;
let networkRequests = 0;
globalThis.fetch = async () => {
  networkRequests += 1;
  throw new Error("공개 데모 예시 제작에서는 외부 네트워크를 사용할 수 없습니다.");
};
try {
  const place = getPlace("pangyo-museum")!;
  const purpose = "youth_story" as const;
  const run = newRun({ mode: "fixture", scenario: "normal", brief: {
    ...DEFAULT_BRIEF, placeId: place.id, place: place.name, purpose,
    audience: PURPOSES.find(item => item.id === purpose)!.audience,
    goal: goalForPurpose(place, purpose),
  } });
  run.id = "public-example-pangyo-youth-story";
  const photo = await defaultPlaceImage(place.id);
  if (!photo) throw new Error("예시 제작에 사용할 실제 장소 사진이 없습니다.");
  const finished = await runAgent(run, {
    search: searchSources,
    render: async (current, signal) => {
      current.cards.forEach(card => { card.image ??= structuredClone(photo); });
      const revision = current.revisions.find(item => item.version === current.version);
      if (revision) revision.cards = structuredClone(current.cards);
      return renderCards(current, signal);
    },
    persist: () => {},
    signal: AbortSignal.timeout(run.limits.maxDurationMs),
  });
  if (finished.status !== "ready_for_approval" || !(await checkArtifacts(finished)) || finished.issues.some(issue => !issue.resolved))
    throw new Error(`예시 검수·렌더링을 완료하지 못했습니다: ${finished.status} / ${finished.stopReason}`);
  if (networkRequests || finished.execution?.apiCalls || finished.usage.modelCalls || finished.usage.costUsd)
    throw new Error("예시는 네트워크·모델 호출과 API 비용이 모두 0이어야 합니다.");
  const reviewedAt = finished.reviews?.at(-1)?.at;
  if (!reviewedAt || finished.reviewVersion !== finished.version) throw new Error("예시의 현재 검수 기록이 없습니다.");
  const root = resolve("public/examples");
  await mkdir(root, { recursive: true });
  const cards = [];
  for (let index = 0; index < 4; index++) {
    const artifact = finished.artifacts.find(item => item.name === `card-${index + 1}.png`)!;
    const bytes = await readFile(artifact.path);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== artifact.sha256 || bytes.readUInt32BE(16) !== 1080 || bytes.readUInt32BE(20) !== 1080)
      throw new Error("예시 PNG의 크기 또는 해시가 원본 렌더와 일치하지 않습니다.");
    const name = `timestory-card-${index + 1}.png`;
    await copyFile(artifact.path, resolve(root, name));
    const card = finished.cards[index];
    cards.push({ id: card.id, title: card.title, body: card.body, image: `/examples/${name}`, width: 1080, height: 1080, sha256, originalArtifactSha256: artifact.sha256, sourceImage: card.image, imagination: card.imagination });
  }
  for (const name of ["sources.json", "review.json"]) {
    const artifact = finished.artifacts.find(item => item.name === name)!;
    await copyFile(artifact.path, resolve(root, name));
  }
  const metadata = {
    schemaVersion: 1, title: "판교박물관으로 떠나는 시간 탐험",
    description: "공식 근거와 실제 장소 사진으로 제작·검수한 준비된 응답 데모입니다. 실제 AI 성능이나 사람의 승인 결과가 아닙니다.",
    placeId: place.id, placeName: place.name, purpose, audience: finished.brief.audience,
    mode: "fixture", reviewedAt, generatedAt: new Date().toISOString(),
    sourceVerifiedAt: place.verifiedAt,
    version: finished.version, reviewVersion: finished.reviewVersion,
    reviewStatus: finished.status, humanApproved: false,
    ruleVersion: finished.execution?.reviewRulesVersion, promptVersion: finished.execution?.promptVersion,
    apiCalls: finished.execution?.apiCalls ?? 0, modelCalls: finished.usage.modelCalls, costUsd: finished.usage.costUsd, networkRequests,
    sourceDocumentation: "docs/place-sources.md", sourceManifestUrl: "/examples/sources.json", reviewManifestUrl: "/examples/review.json", cards,
    sources: finished.sources, evidence: finished.evidence, claims: finished.claims,
    reviews: finished.reviews,
  };
  await writeFile(resolve(root, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(JSON.stringify({ mode: metadata.mode, purpose, reviewedAt, images: cards.map(card => card.image), apiCalls: metadata.apiCalls, networkRequests, reviewStatus: metadata.reviewStatus }, null, 2));
} finally {
  globalThis.fetch = priorFetch;
}
