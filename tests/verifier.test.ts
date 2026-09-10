import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureStory } from "../src/lib/fixture";
import { verifyLive } from "../src/lib/provider";
import { newRun } from "../src/lib/run";
import { fixtureSources } from "../src/lib/sources";
import { validateAtomicReview, verifyContent } from "../src/lib/verifier";
import type { Run } from "../src/lib/types";

function state(): Run {
  const run = newRun({ mode: "fixture" });
  Object.assign(run, fixtureSources(), createFixtureStory(run));
  run.mode = "live"; run.version = 1;
  return run;
}
function validReview(run: Run) {
  const assessments: Record<string, unknown>[] = [];
  const fields = run.cards.flatMap((card) => (["title", "body", "script"] as const).map((field) => {
    const claim = run.claims.find((item) => item.id === card.claimIds[0])!;
    const isFact = field !== "title" && claim.kind === "fact";
    const assessmentId = isFact ? `${card.id}:${field}` : null;
    if (isFact) assessments.push({ id: assessmentId, claimId: claim.id, cardId: card.id, field, text: card[field], atomic: true, verdict: "supported", evidenceIds: claim.evidenceIds, citations: claim.evidenceIds.map((id) => { const evidence = run.evidence.find((item) => item.id === id)!; return { evidenceId: id, sourceId: evidence.sourceId, quote: evidence.quote, relation: "supports", explanation: "공식 원문에서 해당 사실 확인" }; }), rationale: "인용이 해당 사실을 지지합니다.", action: "keep", freshness: "stable" });
    return { cardId: card.id, field, segments: [{ text: card[field], kind: isFact ? "fact" : "nonfact", assessmentId, reason: isFact ? "실제 사실 설명" : "제목 또는 순수 상상 질문" }] };
  }));
  return { expectedVersion: run.version, fields, assessments, issues: [] };
}

function liveResponse(output: unknown) {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-secret"); vi.stubEnv("ANTHROPIC_MODEL", "test-model");
  vi.stubEnv("ANTHROPIC_INPUT_USD_PER_MILLION", "3"); vi.stubEnv("ANTHROPIC_OUTPUT_USD_PER_MILLION", "15"); vi.stubEnv("MAX_COST_USD", "1");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(output) }], usage: { input_tokens: 100, output_tokens: 10 } })));
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("atomic semantic review integrity", () => {
  it("accepts complete independent review of every title, body and script", () => {
    const run = state(); const output = validateAtomicReview(run, validReview(run));
    expect(output.assessments).toHaveLength(6);
    expect(output.assessments[0]).toMatchObject({ start: 0, end: run.cards[0].body.length, freshness: "stable" });
    expect(output.issues).toEqual([]);
    expect(output.assessments.every((item) => item.verdict === "supported")).toBe(true);
  });
  it("fails closed when even one field is omitted", () => {
    const run = state(); const review = validReview(run); review.fields.pop();
    expect(() => validateAtomicReview(run, review)).toThrow(/전체|필드|누락/);
  });
  it("rejects coverage that silently omits a sentence", () => {
    const run = state(); const review = validReview(run); run.cards[0].body += " 입장료는 1만 원입니다.";
    expect(() => validateAtomicReview(run, review)).toThrow(/원문|구간|일치/);
  });
  it("rejects an existing but irrelevant citation for a numerical assertion", () => {
    const run = state(); const review = validReview(run); const unrelated = run.evidence.find((item) => item.id === "evidence-exhibit")!;
    review.assessments[0].evidenceIds = [unrelated.id];
    review.assessments[0].citations = [{ evidenceId: unrelated.id, sourceId: unrelated.sourceId, quote: unrelated.quote, relation: "supports", explanation: "출처 존재" }];
    expect(() => validateAtomicReview(run, review)).toThrow(/수치|인용|관련/);
  });
  it("rejects a fabricated quote or incorrect source ID", () => {
    const run = state(); const review = validReview(run);
    (review.assessments[0].citations as { quote: string }[])[0].quote = "없는 인용";
    expect(() => validateAtomicReview(run, review)).toThrow(/인용|원문/);
  });
  it("rejects unsupported approval of a compound assertion", () => {
    const run = state(); run.claims[0].text = "2013년 개관했으며 월요일은 휴관합니다."; run.cards[0].body = run.claims[0].text; run.cards[0].script = run.claims[0].text;
    expect(() => validateAtomicReview(run, validReview(run))).toThrow(/원자|분리|복합/);
  });
  it("keeps a correct atom supported while a second atom is contradicted", () => {
    const run = state();
    const original = run.cards[0].body;
    const wrong = " 월요일은 휴관합니다.";
    run.claims[0].text = original + wrong; run.cards[0].body = original + wrong; run.cards[0].script = original + wrong;
    const sourceId = run.sources[0].id;
    run.sources[0].snapshot += "\n월요일은 정상 운영합니다.";
    run.sources[0].modifiedAt = new Date().toISOString();
    run.evidence.push({ id: "evidence-monday", sourceId, quote: "월요일은 정상 운영합니다.", locator: "운영 안내" });
    const review = validReview(run);
    for (const field of ["body", "script"] as const) {
      const fieldReview = review.fields.find((item) => item.cardId === "card-1" && item.field === field)!;
      const originalAssessment = review.assessments.find((item) => item.id === `card-1:${field}`)!;
      originalAssessment.text = original;
      fieldReview.segments[0].text = original;
      fieldReview.segments.push({ text: wrong, kind: "fact", assessmentId: `card-1:${field}:wrong`, reason: "운영일 별도 주장" });
      review.assessments.push({ ...originalAssessment, id: `card-1:${field}:wrong`, text: wrong, verdict: "contradicted", evidenceIds: ["evidence-monday"], citations: [{ evidenceId: "evidence-monday", sourceId, quote: "월요일은 정상 운영합니다.", relation: "contradicts", explanation: "월요일 운영 여부가 반대입니다." }], rationale: "공식 안내는 월요일 정상 운영입니다.", action: "revise", freshness: "current" });
    }
    const output = validateAtomicReview(run, review);
    expect(output.assessments.find((item) => item.id === "card-1:body")!.verdict).toBe("supported");
    expect(output.assessments.find((item) => item.id === "card-1:body:wrong")!.verdict).toBe("contradicted");
    expect(output.issues.some((item) => item.type === "contradicted")).toBe(true);
  });
  it("does not let the imagination flag hide historical facts", () => {
    const run = state(); run.cards[3].body = "상상 장면: 2015년에 개관한 박물관을 우주로 옮긴다면?"; run.cards[3].script = run.cards[3].body; run.claims[3].text = run.cards[3].body;
    expect(() => validateAtomicReview(run, validReview(run))).toThrow(/사실|nonfact|추출/);
  });
  it("requires an assessment even when the writer failed to register a title fact", () => {
    const run = state(); run.cards[0].title = "2015년 개관";
    expect(() => validateAtomicReview(run, validReview(run))).toThrow(/사실|nonfact|추출/);
  });
  it("does not treat unavailable or conflicting evidence as verified support", () => {
    const run = state(); const review = validReview(run); review.assessments[0].freshness = "conflicting";
    expect(() => validateAtomicReview(run, review)).toThrow(/충돌|시점|supported/);
  });
  it("creates labelled conservative fixture assessments", () => {
    const run = state(); run.mode = "fixture"; verifyContent(run);
    expect(run.assessments?.length).toBeGreaterThan(0);
    expect(run.assessments?.every((item) => item.rationale.includes("fixture"))).toBe(true);
  });
  it("records a contradicted live claim separately from insufficient evidence", async () => {
    const run = state(); run.claims[0].text = "판교박물관은 2015년에 개관했어요."; run.cards[0].body = run.claims[0].text; run.cards[0].script = run.claims[0].text;
    const output = validReview(run);
    for (const assessment of output.assessments.filter((item) => item.claimId === run.claims[0].id)) {
      assessment.verdict = "contradicted"; assessment.action = "revise";
      (assessment.citations as { relation: string }[]).forEach((citation) => citation.relation = "contradicts");
    }
    liveResponse(output);
    const issues = await verifyLive(run, new AbortController().signal);
    expect(run.claims[0].support).toBe("contradicted");
    expect(run.assessments?.filter((item) => item.claimId === run.claims[0].id).every((item) => item.verdict === "contradicted")).toBe(true);
    expect(issues.some((issue) => issue.type === "contradicted")).toBe(true);
  });
  it("keeps unrelated evidence insufficient instead of calling it a contradiction", () => {
    const run = state(); const output = validReview(run);
    output.assessments[0].verdict = "insufficient"; output.assessments[0].action = "search"; output.assessments[0].freshness = "unverified";
    output.assessments[0].evidenceIds = []; output.assessments[0].citations = [];
    const review = validateAtomicReview(run, output);
    expect(review.assessments[0].verdict).toBe("insufficient");
    expect(review.issues[0].type).toBe("insufficient");
  });
  it("fails a semantically malformed model result without retaining old supported state", async () => {
    const run = state(); const output = validReview(run);
    output.fields[0].segments[0].text = "다른 제목";
    run.claims[0].support = "supported";
    run.assessments = [{ id: "old", claimId: run.claims[0].id, cardId: "card-1", field: "body", text: run.cards[0].body, verdict: "supported", evidenceIds: [], rationale: "old", action: "keep" }];
    liveResponse(output);
    await expect(verifyLive(run, new AbortController().signal)).rejects.toThrow(/원문|구간/);
    expect(run.claims[0].support).toBe("insufficient");
    expect(run.assessments).toEqual([]);
    expect(run.modelCallLog?.at(-1)?.status).toBe("failed");
    expect(run.usage.inputTokens).toBe(100);
  });

  it("rejects a substantive unchecked suffix inside a registered compound fact", () => {
    const run = state(); const first = run.cards[0].body; const suffix = " 국내 최초 AI 전시다.";
    run.claims[0].text = first + suffix; run.cards[0].body = first + suffix;
    const output = validReview(run);
    const body = output.fields.find((item) => item.cardId === "card-1" && item.field === "body")!;
    body.segments[0].text = first;
    body.segments.push({ text: suffix, kind: "nonfact", assessmentId: null, reason: "홍보 표현" });
    output.assessments.find((item) => item.id === "card-1:body")!.text = first;
    expect(() => validateAtomicReview(run, output)).toThrow(/사실|nonfact|미검수/);
  });
  it("detects an unregistered assertion of a first-of-its-kind exhibition inside imagination", () => {
    const run = state(); run.cards[3].body = "상상 장면: 국내 최초 AI 전시를 도입했다. 우주로 떠나볼까요?"; run.cards[3].script = run.cards[3].body; run.claims[3].text = run.cards[3].body;
    expect(() => validateAtomicReview(run, validReview(run))).toThrow(/사실|nonfact|추출/);
  });
  it("allows a purely hypothetical future without certifying an actual project", () => {
    const run = state(); run.cards[3].body = "상상 장면: 국내 최초 AI 전시를 도입한다면 어떨까요?"; run.cards[3].script = run.cards[3].body; run.claims[3].text = run.cards[3].body;
    expect(validateAtomicReview(run, validReview(run)).issues).toEqual([]);
  });

  it("keeps unresolved source conflict as insufficient and sends it to a person", () => {
    const run = state(); const output = validReview(run);
    output.assessments[0].freshness = "conflicting"; output.assessments[0].verdict = "insufficient"; output.assessments[0].action = "human_review";
    const result = validateAtomicReview(run, output);
    expect(result.issues[0].type).toBe("source_conflict");
    expect(result.assessments[0].freshness).toBe("conflicting");
    expect(result.assessments[0].citations?.[0].quote).toBe(run.evidence[0].quote);
  });
  it("does not certify current information using an explicitly old source date", () => {
    const run = state(); const output = validReview(run);
    output.assessments[0].freshness = "current";
    run.sources[0].modifiedAt = "2000-01-01T00:00:00.000Z";
    expect(() => validateAtomicReview(run, output)).toThrow(/시점|오래/);
  });

});
