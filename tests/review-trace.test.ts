import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AtomicReview, EvidenceLinks, cardRevisionChanges } from "../src/components/review-trace";
import { newRun } from "../src/lib/run";
import type { Card, CardImage, ClaimAssessment, Revision, Run } from "../src/lib/types";

function reviewRun(): Run {
  const run = newRun({ mode: "fixture" });
  run.version = 2;
  run.reviewVersion = 2;
  run.cards = [{ id: "card-1", title: "판교박물관 소개", body: "박물관은 2013년에 개관했습니다.", script: "박물관의 역사를 알아봐요.", claimIds: ["claim-1"], imagination: false }];
  run.sources = [{ id: "source-internal-id", title: "판교박물관 공식 소개", publisher: "성남시", url: "https://www.seongnam.go.kr/museum", retrievedAt: "2026-09-14T01:00:00Z", publishedAt: "2023-01-01", modifiedAt: "2024-01-02", status: "ok", snapshot: "판교박물관은 2013년에 개관했습니다.", hash: "hash", license: "출처 표시" }];
  run.evidence = [{ id: "evidence-internal-id", sourceId: "source-internal-id", quote: "판교박물관은 2013년에 개관했습니다.", locator: "박물관 소개" }];
  run.assessments = [{ id: "assessment-1", claimId: "claim-1", cardId: "card-1", field: "body", text: run.cards[0].body, verdict: "supported", evidenceIds: ["evidence-internal-id"], rationale: "개관 연도가 원문과 일치합니다.", action: "keep" }];
  return run;
}

const renderReview = (run: Run) => renderToStaticMarkup(createElement(AtomicReview, { run, cardId: "card-1" }));

describe("문장과 근거를 대조하는 검수 화면", () => {
  it("검수가 무효화되면 남아 있는 이전 판정을 현재 결과로 표시하지 않는다", () => {
    const run = reviewRun();
    run.reviewVersion = null;
    const html = renderReview(run);
    expect(html).toContain("현재 v2의 재검수가 필요합니다");
    expect(html).not.toContain("개관 연도가 원문과 일치합니다.");
    expect(html).not.toContain("근거가 지지함");
  });

  it("현재 카드에서 찾을 수 없는 문장 판정은 재검수 대상으로 남긴다", () => {
    const run = reviewRun();
    run.cards[0].body = "개관일을 다시 확인하고 있어요.";
    const html = renderReview(run);
    expect(html).toContain("현재 문구와 일치하지 않는 판정 1개");
    expect(html).not.toContain("개관 연도가 원문과 일치합니다.");
  });

  it("문장을 선택하는 요약과 근거 구절, 판정 이유, 다음 행동을 연결한다", () => {
    const html = renderReview(reviewRun());
    const summaries = [...html.matchAll(/<summary[^>]*>(.*?)<\/summary>/g)].map((match) => match[1]);
    expect(summaries.some((summary) => summary.includes("박물관은 2013년에 개관했습니다.") && summary.includes("근거가 지지함"))).toBe(true);
    expect(html).toContain("판교박물관은 2013년에 개관했습니다.");
    expect(html).toContain("판정 이유");
    expect(html).toContain("다음 행동");
    expect(html).toContain("저장된 응답 데모");
  });

  it("근거 부족의 의미와 우선 확인할 문장을 보여 준다", () => {
    const run = reviewRun();
    run.assessments!.push({ ...run.assessments![0], id: "assessment-2", verdict: "insufficient", rationale: "확인할 원문이 없습니다.", evidenceIds: [], action: "search" } satisfies ClaimAssessment);
    const html = renderReview(run);
    expect(html).toContain("근거 부족은 거짓이라는 뜻이 아닙니다");
    expect(html).toContain("확인이 필요한 문장 1개");
    expect(html).toContain("공식 자료를 추가로 확인");
  });

  it("직접 편집을 지원하는 제목·본문에만 편집 이동 버튼을 표시한다", () => {
    const run = reviewRun();
    run.assessments = (["title", "body", "script"] as const).map((field) => ({ ...run.assessments![0], id: `assessment-${field}`, field, text: run.cards[0][field] }));
    const html = renderToStaticMarkup(createElement(AtomicReview, { run, cardId: "card-1", onSelectField: () => {} }));
    expect(html).toContain("제목 편집으로 이동");
    expect(html).toContain("본문 편집으로 이동");
    expect(html).not.toContain("대본 편집으로 이동");
    expect(html).toContain("박물관의 역사를 알아봐요.");
  });

  it("이전 검수 기록에는 버전과 현재 판정이 아니라는 안내를 붙인다", () => {
    const run = reviewRun();
    run.reviewVersion = null;
    run.reviews = [{ version: 1, at: "2026-09-13T01:00:00Z", sourceSnapshotIds: ["source-internal-id"], assessments: run.assessments!, issues: [] }];
    run.assessments = [];
    const html = renderReview(run);
    expect(html).toContain("이전 버전의 검수 기록");
    expect(html).toContain("v1");
    expect(html).toContain("현재 문구의 판정이 아닙니다");
  });

  it("원문 제목을 먼저 보여 주고 수집일과 원문 발행·수정일을 구분한다", () => {
    const html = renderToStaticMarkup(createElement(EvidenceLinks, { run: reviewRun(), ids: ["evidence-internal-id"] }));
    const summary = html.match(/<summary[^>]*>(.*?)<\/summary>/)?.[1];
    expect(summary).toContain("판교박물관 공식 소개");
    expect(summary).not.toContain("evidence-internal-id");
    expect(html).toContain("자료 수집");
    expect(html).toContain("원문 발행");
    expect(html).toContain("원문 수정");
    expect(html).toContain("기록 식별 정보");
  });

  it("수정 내역에는 선택한 카드의 제목·본문·대본·사진·구도가 실제로 바뀐 버전만 남긴다", () => {
    const first: Card = { id: "card-1", title: "판교박물관 소개", body: "박물관은 2013년에 개관했습니다.", script: "대본", claimIds: [], imagination: false };
    const second: Card = { ...first, id: "card-2", title: "두 번째 이야기" };
    const photo: CardImage = { id: "upload-1", placeId: "pangyo-museum", kind: "upload", src: "/api/images/upload-1", sha256: "hash", width: 1200, height: 800, mime: "image/jpeg", sourceUrl: "", author: "사용자 제공", license: "사용자가 이용 권한을 확인한 사진", licenseUrl: "", createdAt: "2026-09-14T01:00:00Z", crop: { x: 0.5, y: 0.5, zoom: 1 } };
    const revision = (version: number, cards: Card[], reason: string): Revision => ({ version, createdAt: "2026-09-14T01:00:00Z", cards, claims: [], reason, origin: "human" });
    const edited = { ...first, body: "개관 연도를 다시 확인했습니다." };
    const revisions = [
      revision(1, [first, second], "초안"),
      revision(2, [edited, second], "담당자 문구 수정"),
      revision(3, [edited, { ...second, image: photo }], "담당자 사진 교체"),
      revision(4, [edited, { ...second, image: { ...photo, crop: { ...photo.crop, zoom: 1.4 } } }], "담당자 사진 크롭·초점 수정"),
      revision(5, [edited, { ...second, image: { ...photo, crop: { ...photo.crop, zoom: 1.4 } } }], "재검수"),
      revision(6, [{ ...edited, script: "고친 대본" }, { ...second, image: { ...photo, crop: { ...photo.crop, zoom: 1.4 } } }], "대본 수정"),
    ];
    expect(cardRevisionChanges(revisions, "card-1").map((change) => change.revision.version)).toEqual([2, 6]);
    expect(cardRevisionChanges(revisions, "card-2").map((change) => change.revision.version)).toEqual([3, 4]);
    expect(cardRevisionChanges(revisions, "card-1")[0]).toMatchObject({ previous: first, next: edited });
    expect(cardRevisionChanges(revisions, "card-3")).toEqual([]);
    expect(cardRevisionChanges(revisions.slice(0, 1), "card-1")).toEqual([]);
  });

  it("누락된 원문 날짜나 잘못된 링크를 최신 공식 자료처럼 표시하지 않는다", () => {
    const run = reviewRun();
    run.sources[0].url = "javascript:alert(1)";
    delete run.sources[0].publishedAt;
    delete run.sources[0].modifiedAt;
    const html = renderToStaticMarkup(createElement(EvidenceLinks, { run, ids: ["evidence-internal-id"] }));
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("원문에 표시된 시점 미확인");
  });
});
