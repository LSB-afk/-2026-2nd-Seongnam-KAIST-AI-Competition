import { z } from "zod";
import { getPlace, PLACES } from "./places";
import { assertOfficialUrl } from "./sources";
import { REVIEW_RULES_VERSION } from "./prompts";
import type { Claim, ClaimAssessment, Evidence, ReviewIssue, Run } from "./types";

function compact(text: string) {
  return text.replace(/[\s\p{P}\p{S}]/gu, "");
}
function covered(text: string, claims: Claim[]) {
  let rest = compact(text);
  for (const claim of [...claims].sort((a, b) => b.text.length - a.text.length))
    rest = rest.replaceAll(compact(claim.text), "");
  return rest.length === 0;
}

/** Rule checks enforce structural integrity; live mode additionally requires a model evidence review. */
export function verifyContent(run: Run): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const place = getPlace(run.brief.placeId ?? run.brief.place);
  const add = (
    targetId: string,
    type: string,
    message: string,
    evidenceIds: string[] = [],
    recommendation = "근거와 문장을 확인하고 수정한 뒤 다시 검사하세요.",
  ) => {
    if (
      !issues.some(
        (issue) => issue.targetId === targetId && issue.type === type,
      )
    )
      issues.push({
        id: `${run.version}:${targetId}:${type}`,
        targetId,
        type,
        severity: "error",
        message,
        evidenceIds,
        recommendation,
        resolved: false,
      });
  };
  if (run.cards.length !== 4)
    add("run", "card_count", "카드가 정확히 4장이어야 합니다.");
  for (const [name, items] of [
    ["card", run.cards],
    ["claim", run.claims],
    ["source", run.sources],
    ["evidence", run.evidence],
  ] as const) {
    const seen = new Set<string>();
    for (const item of items) {
      if (!item.id || seen.has(item.id))
        add(
          item.id || "run",
          "duplicate_id",
          `${name} ID가 없거나 중복되었습니다.`,
        );
      seen.add(item.id);
    }
  }
  const sourceMap = new Map(run.sources.map((source) => [source.id, source]));
  const evidenceMap = new Map(
    run.evidence.map((evidence) => [evidence.id, evidence]),
  );
  for (const evidence of run.evidence) {
    const source = sourceMap.get(evidence.sourceId);
    if (
      !source ||
      source.status !== "ok" ||
      !evidence.quote.trim() ||
      !evidenceIsValid(run, evidence.id)
    ) {
      add(
        evidence.id,
        "invalid_evidence",
        "근거 원문이 수집한 출처에서 확인되지 않습니다.",
        [evidence.id],
      );
    }
  }
  const claimMap = new Map(run.claims.map((claim) => [claim.id, claim]));
  for (const card of run.cards) {
    if (place && PLACES.some(other => other.id !== place.id && `${card.title} ${card.body} ${card.script}`.includes(other.name)))
      add(card.id, "place_mismatch", "선택한 관광지와 다른 장소의 내용이 섞여 있습니다.");
    if (!card.title.trim() || !card.body.trim() || !card.script.trim())
      add(card.id, "empty_content", "제목·본문·대본이 필요합니다.");
    if (card.title.length > 44 || card.body.length > 220)
      add(
        card.id,
        "readability",
        "청소년용 카드의 제목 또는 본문이 너무 깁니다.",
        [],
        "제목 44자, 본문 220자 이하로 줄이세요.",
      );
    const claims = card.claimIds
      .map((id) => claimMap.get(id))
      .filter((claim): claim is Claim => !!claim);
    if (
      !card.claimIds.length ||
      claims.length !== card.claimIds.length ||
      claims.some((claim) => claim.cardId !== card.id)
    )
      add(
        card.id,
        "invalid_claim_reference",
        "카드와 문장의 연결이 올바르지 않습니다.",
      );
    if (!covered(card.body, claims) || !covered(card.script, claims))
      add(
        card.id,
        "unmapped_text",
        "본문 또는 대본에 검수 대상 문장으로 등록되지 않은 내용이 있습니다.",
      );
    if (
      claims.some((claim) => claim.kind === "imagination") &&
      (!card.imagination || !/상상/.test(card.body))
    )
      add(
        card.id,
        "imagination_label",
        "창작 장면은 카드 본문에 상상임을 표시해야 합니다.",
      );
    if (
      /\d{4}|확정|계승|기원|이어졌/.test(card.title) &&
      !covered(card.title, claims)
    )
      add(
        card.id,
        "unmapped_title",
        "제목의 사실 주장도 검수 문장에 포함해야 합니다.",
      );
  }
  if (run.claims.filter((claim) => claim.kind === "fact").length < 2)
    add(
      "run",
      "missing_museum_facts",
      "선택한 관광지를 소개하는 근거 있는 사실 문장이 최소 2개 필요합니다.",
    );
  const last = run.cards[3];
  if (last && (!last.imagination || !/상상/.test(last.body)))
    add(
      last.id,
      "imagination_label",
      "마지막 장에 상상 장면 표시가 필요합니다.",
    );
  for (const claim of run.claims) {
    if (
      !run.cards.some(
        (card) => card.id === claim.cardId && card.claimIds.includes(claim.id),
      )
    )
      add(claim.id, "orphan_claim", "문장이 카드와 연결되지 않았습니다.");
    const cited = claim.evidenceIds.map((id) => evidenceMap.get(id));
    const valid =
      cited.length > 0 &&
      cited.every(
        (evidence) =>
          evidence &&
          sourceMap.get(evidence.sourceId)?.status === "ok" &&
          !issues.some((issue) => issue.targetId === evidence.id),
      );
    if (claim.evidenceIds.some((id) => !evidenceMap.has(id)))
      add(
        claim.id,
        "missing_evidence",
        "존재하지 않는 근거를 참조합니다.",
        claim.evidenceIds,
      );
    if (claim.kind === "fact" && !valid)
      add(
        claim.id,
        "missing_evidence",
        "사실 주장을 지지할 확인된 원문 근거가 부족합니다.",
        claim.evidenceIds,
      );
    if (run.mode === "fixture" && /AI\s*산업.*이어|기술.*계승|직접.*이어졌|기원.*AI/.test(claim.text))
      add(
        claim.id,
        "unsupported_relation",
        "문화유산과 오늘날 산업의 역사적 연결을 지지하는 근거가 없습니다.",
        claim.evidenceIds,
        "공식 자료를 추가 확인하고, 근거가 없으면 인과관계를 삭제하거나 명확한 비유로 바꾸세요.",
      );
    if (run.mode === "fixture" && /사업.*확정|조성.*확정|건립.*확정|내년.*개관/.test(claim.text))
      add(
        claim.id,
        "future_as_fact",
        "미래 장면을 확정 사업처럼 표현했습니다. 공식 계획 근거를 확인해야 합니다.",
        claim.evidenceIds,
        "확인되지 않은 계획 주장을 제거하고 창작 장면을 명확히 표시하세요.",
      );
    if (
      run.mode === "fixture" && claim.kind !== "fact" &&
      /개관|문을 열었|발굴조사|백제.*석실분|고구려.*석실분/.test(claim.text)
    )
      add(
        claim.id,
        "hidden_fact",
        "비유·상상 문장 안의 실제 역사 주장은 별도 사실 문장으로 분리해야 합니다.",
        claim.evidenceIds,
      );
    if (run.mode === "fixture" && claim.kind === "fact" && valid) {
      const quotes = cited.map((evidence) => evidence!.quote).join(" ");
      const opening =
        [
          "판교박물관은 2013년 4월 2일에 문을 열었어요.",
          "판교박물관은 2013년 4월 2일 개관했어요.",
        ].includes(claim.text) &&
        /2013/.test(quotes) &&
        /4월\s*2일|04[.-]02|4[.-]2/.test(quotes);
      const exhibit =
        [
          "백제·고구려 시대 석실분과 판교 전역에서 출토된 유물 일부를 만날 수 있어요.",
          "백제·고구려 석실분과 판교 출토 유물 일부를 전시해요.",
        ].includes(claim.text) &&
        /백제/.test(quotes) &&
        /고구려/.test(quotes) &&
        /석실분/.test(quotes);
      const excavation =
        [
          "판교 지역에서는 2003년부터 2008년까지 발굴조사가 진행됐어요.",
          "2003~2008년 판교에서 발굴조사가 진행됐어요.",
        ].includes(claim.text) &&
        /2003/.test(quotes) &&
        /2008/.test(quotes) &&
        /발굴/.test(quotes);
      const exact = cited.some((evidence) =>
        compact(evidence!.quote).includes(compact(claim.text)),
      );
      if (!opening && !exhibit && !excavation && !exact)
        add(
          claim.id,
          "evidence_mismatch",
          "연결된 출처는 존재하지만 이 문장을 뒷받침하지 않습니다.",
          claim.evidenceIds,
        );
    }
    const hasIssue = issues.some(
      (issue) => issue.targetId === claim.id || issue.targetId === claim.cardId,
    );
    claim.support = hasIssue
      ? "insufficient"
      : claim.kind === "fact"
        ? run.mode === "fixture"
          ? "supported"
          : "insufficient"
        : "not_applicable";
  }
  if (run.mode === "fixture") run.assessments = fixtureAssessments(run, issues);
  return issues;
}

/** References are a code check, separate from the model's semantic entailment verdict. */
export function evidenceIsValid(run: Run, evidenceId: string): boolean {
  const evidence = run.evidence.find((item) => item.id === evidenceId);
  if (!evidence || !evidence.quote.trim()) return false;
  const source = run.sources.find((item) => item.id === evidence.sourceId);
  if (!source || source.status !== "ok") return false;
  const place = getPlace(run.brief.placeId ?? run.brief.place);
  // Legacy museum snapshots predate the registry; new destinations require their own allowlist.
  if (place && place.id !== "pangyo-museum") {
    try { assertOfficialUrl(source.url, place.id); } catch { return false; }
  }
  if (evidence.start !== undefined || evidence.end !== undefined) {
    return Number.isSafeInteger(evidence.start) && Number.isSafeInteger(evidence.end)
      && evidence.start! >= 0 && evidence.end! > evidence.start! && evidence.end! <= source.snapshot.length
      && source.snapshot.slice(evidence.start, evidence.end) === evidence.quote;
  }
  return source.snapshot.includes(evidence.quote);
}

const atomicId = z.string().min(1).max(160);
const atomicIds = z.array(atomicId).max(40);
const explanation = z.string().min(1).max(1600);
const fieldSchema = z.enum(["title", "body", "script"]);
const atomSchema = z.object({
  id: atomicId, claimId: atomicId.nullable(), cardId: atomicId, field: fieldSchema,
  text: z.string().min(1).max(2500), atomic: z.literal(true),
  verdict: z.enum(["supported", "contradicted", "insufficient"]), evidenceIds: atomicIds,
  citations: z.array(z.object({ evidenceId: atomicId, sourceId: atomicId, quote: z.string().min(1).max(8000), relation: z.enum(["supports", "contradicts", "context"]), explanation }).strict()).max(40),
  rationale: explanation, action: z.enum(["keep", "search", "revise", "delete", "human_review"]),
  freshness: z.enum(["stable", "current", "unverified", "outdated", "conflicting"]),
}).strict();
export const atomicReviewSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  fields: z.array(z.object({
    cardId: atomicId, field: fieldSchema,
    segments: z.array(z.object({ text: z.string().min(1).max(2500), kind: z.enum(["fact", "nonfact"]), assessmentId: atomicId.nullable(), reason: explanation }).strict()).min(1).max(40),
  }).strict()).length(12),
  assessments: z.array(atomSchema).max(120),
  issues: z.array(z.object({ id: atomicId, targetId: atomicId, type: atomicId, severity: z.enum(["error", "warning"]), message: explanation, evidenceIds: atomicIds, recommendation: explanation, resolved: z.literal(false) }).strict()).max(80),
}).strict();
export type AtomicReviewOutput = z.infer<typeof atomicReviewSchema>;

function looksFactual(text: string): boolean {
  const withoutHypotheticals = text.replace(/(?:개관|운영|조성|건립|도입)(?:한다면|하면|된다면|되면)/g, "가정");
  return /\d{4}년.{0,40}(?:개관|발굴|확정|건립)|(?:현재|이미|실제로).{0,40}(?:있|운영|확정)|(?:매주|매일|입장료|휴관일|무료|유료).{0,35}(?:입니다|합니다|한다|해요|원|시)|(?:개관했|개관한|발굴조사.{0,20}진행)|(?:도입했다|도입했어요|도입한|보유하고 있다|보유한다|지정되었다|선정되었다|확정되었다)|(?:국내|세계|전국).{0,6}최초(?:다|이다|입니다)|최초.{0,30}(?:전시다|이다|입니다|했다)/.test(withoutHypotheticals);
}
function hasSubstantiveFactOverlap(run: Run, cardId: string, fieldText: string, start: number, length: number): boolean {
  for (const claim of run.claims.filter((item) => item.cardId === cardId && item.kind === "fact" && item.text.length > 0)) {
    let searchFrom = 0;
    while (searchFrom < fieldText.length) {
      const claimStart = fieldText.indexOf(claim.text, searchFrom);
      if (claimStart < 0) break;
      const overlapStart = Math.max(start, claimStart);
      const overlapEnd = Math.min(start + length, claimStart + claim.text.length);
      if (overlapStart < overlapEnd) {
        const content = compact(fieldText.slice(overlapStart, overlapEnd));
        if (content && !/^(?:(?:그리고|또한|하지만|그러나|및|또는|와|과|이고|이며|했고|했으며|하였으며|하고))+$/.test(content)) return true;
      }
      searchFrom = claimStart + claim.text.length;
    }
  }
  return false;
}
function isCompound(text: string): boolean {
  return /(?:했으며|했고|하였으며|이며|이고|이며,|그리고|또한)\s*[^\s,.!?。]/.test(text)
    || /[.!?。]\s*\S.{3,}(?:입니다|합니다|했|한다|해요)/.test(text);
}
function evidenceNumbers(evidence: Evidence): Set<string> {
  return new Set(evidence.quote.match(/\d+(?:\.\d+)?/g) ?? []);
}

/** The model supplies semantic judgements; code proves complete coverage, exact locations and reference integrity. */
export function validateAtomicReview(run: Run, raw: unknown): { assessments: ClaimAssessment[]; issues: ReviewIssue[] } {
  const parsed = atomicReviewSchema.safeParse(raw);
  if (!parsed.success) throw new Error("원자 검수 출력의 스키마 또는 전체 필드 목록이 불완전합니다.");
  const review = parsed.data;
  if (review.expectedVersion !== run.version) throw new Error("검수 결과 버전이 현재 원문 버전과 일치하지 않습니다.");
  const atoms = new Map(review.assessments.map((assessment) => [assessment.id, assessment]));
  if (atoms.size !== review.assessments.length) throw new Error("원자 검수 ID가 중복되었습니다.");
  const visited = new Set<string>();
  const usedAtoms = new Set<string>();
  const offsets = new Map<string, number>();
  for (const coverage of review.fields) {
    const card = run.cards.find((item) => item.id === coverage.cardId);
    const key = `${coverage.cardId}:${coverage.field}`;
    if (!card || visited.has(key)) throw new Error("검수 필드가 중복되었거나 현재 카드에 없습니다.");
    visited.add(key);
    if (coverage.segments.map((segment) => segment.text).join("") !== card[coverage.field]) throw new Error("검수 구간과 원문 필드가 정확히 일치하지 않습니다.");
    let offset = 0;
    for (const segment of coverage.segments) {
      if (segment.kind === "nonfact") {
        const registeredFact = hasSubstantiveFactOverlap(run, card.id, card[coverage.field], offset, segment.text.length);
        if (segment.assessmentId !== null || looksFactual(segment.text) || registeredFact || (coverage.field === "title" && /(?:19|20)\d{2}|(?:국내|세계|전국).{0,6}최초/.test(segment.text))) throw new Error("사실이 포함된 구간을 nonfact로 처리하여 독립 사실 추출을 생략했습니다.");
      } else {
        const atom = segment.assessmentId ? atoms.get(segment.assessmentId) : undefined;
        if (!atom || usedAtoms.has(atom.id) || atom.cardId !== card.id || atom.field !== coverage.field || atom.text !== segment.text) throw new Error("사실 구간과 원자 검수의 위치·문자열·연결이 일치하지 않습니다.");
        if (isCompound(atom.text)) throw new Error("복합 주장을 독립 원자 주장으로 더 분리해야 합니다.");
        usedAtoms.add(atom.id); offsets.set(atom.id, offset);
      }
      offset += segment.text.length;
    }
  }
  if (run.cards.some((card) => (["title", "body", "script"] as const).some((field) => !visited.has(`${card.id}:${field}`)))) throw new Error("제목·본문·대본 전체 필드의 검수가 누락되었습니다.");
  if (usedAtoms.size !== atoms.size) throw new Error("원문 구간에 연결되지 않은 원자 검수가 있습니다.");
  const targets = new Set(["run", ...run.cards.map((card) => card.id), ...run.claims.map((claim) => claim.id), ...run.evidence.map((evidence) => evidence.id)]);
  const issues = [...review.issues];
  if (issues.some((issue) => !targets.has(issue.targetId) || issue.evidenceIds.some((id) => !evidenceIsValid(run, id)))) throw new Error("검수 문제에 존재하지 않는 대상 또는 유효하지 않은 근거 인용이 있습니다.");
  const assessments: ClaimAssessment[] = [];
  for (const atom of review.assessments) {
    const claim = atom.claimId ? run.claims.find((item) => item.id === atom.claimId) : undefined;
    if (atom.claimId && (!claim || claim.cardId !== atom.cardId || !claim.text.includes(atom.text.trim()))) throw new Error("원자 주장의 기존 Claim 연결이 원문과 일치하지 않습니다.");
    if (new Set(atom.evidenceIds).size !== atom.evidenceIds.length || atom.citations.length !== atom.evidenceIds.length || new Set(atom.citations.map((citation) => citation.evidenceId)).size !== atom.citations.length) throw new Error("원자 검수의 근거 목록과 인용 목록이 일치하지 않습니다.");
    for (const citation of atom.citations) {
      const evidence = run.evidence.find((item) => item.id === citation.evidenceId);
      if (!evidence || !atom.evidenceIds.includes(evidence.id) || !evidenceIsValid(run, evidence.id) || citation.sourceId !== evidence.sourceId || citation.quote !== evidence.quote) throw new Error("검수 인용이 실제 출처의 원문·ID·위치와 일치하지 않습니다.");
    }
    if (atom.freshness === "conflicting" && (atom.verdict !== "insufficient" || atom.action !== "human_review")) throw new Error("출처 충돌이 해소되지 않은 사실은 insufficient와 human_review로 남겨야 합니다.");
    if (atom.verdict === "supported") {
      if (!atom.citations.length || atom.citations.some((citation) => citation.relation !== "supports")) throw new Error("supported 판정에 해당 주장을 지지하는 인용이 없습니다.");
      if (["unverified", "outdated", "conflicting"].includes(atom.freshness)) throw new Error("충돌하거나 확인되지 않은 시점의 정보를 supported로 승인할 수 없습니다.");
      const assertedNumbers = atom.text.match(/\d+(?:\.\d+)?/g) ?? [];
      const referencedNumbers = new Set(atom.evidenceIds.flatMap((id) => [...evidenceNumbers(run.evidence.find((evidence) => evidence.id === id)!)]));
      if (assertedNumbers.some((value) => !referencedNumbers.has(value))) throw new Error("수치 주장을 지지하지 않는 무관한 인용으로 supported를 선언했습니다.");
      if (/휴관|운영시간|입장료|무료|유료|사업.*확정/.test(atom.text) && atom.freshness !== "current") throw new Error("현재 운영·사업 정보의 시점 확인이 누락되었습니다.");
      if (atom.freshness === "current") {
        const referenceTime = Date.parse(run.updatedAt || run.createdAt);
        const datedCurrentSource = atom.evidenceIds.some((id) => {
          const evidence = run.evidence.find((item) => item.id === id)!;
          const source = run.sources.find((item) => item.id === evidence.sourceId)!;
          const sourceTime = Date.parse(source.modifiedAt || source.publishedAt || source.retrievedAt);
          return Number.isFinite(referenceTime) && Number.isFinite(sourceTime) && referenceTime - sourceTime <= 366 * 24 * 60 * 60 * 1000 && sourceTime - referenceTime <= 24 * 60 * 60 * 1000;
        });
        if (!datedCurrentSource) throw new Error("현재 정보의 출처 시점을 확인할 수 없거나 자료가 오래되었습니다.");
      }
      if (atom.action !== "keep") throw new Error("supported 원자 주장의 조치가 keep과 일치하지 않습니다.");
    } else {
      if (atom.action === "keep") throw new Error("미해결 원자 주장을 keep으로 처리할 수 없습니다.");
      if (atom.verdict === "contradicted" && !atom.citations.some((citation) => citation.relation === "contradicts")) throw new Error("contradicted 판정에는 반박하는 원문 인용이 필요합니다.");
    }
    const claimId = atom.claimId ?? `unregistered:${atom.cardId}:${atom.field}:${offsets.get(atom.id)}`;
    assessments.push({ id: atom.id, claimId, cardId: atom.cardId, field: atom.field, text: atom.text, start: offsets.get(atom.id)!, end: offsets.get(atom.id)! + atom.text.length, freshness: atom.freshness, citations: structuredClone(atom.citations), verdict: atom.verdict, evidenceIds: atom.evidenceIds, rationale: atom.rationale, action: atom.action });
    if (atom.verdict !== "supported") issues.push({ id: `${run.version}:${atom.id}:${atom.verdict}`, targetId: atom.claimId ?? atom.cardId, type: atom.freshness === "conflicting" ? "source_conflict" : atom.verdict, severity: "error", message: `${atom.field}: ${atom.text.trim()} — ${atom.rationale}`, evidenceIds: atom.evidenceIds, recommendation: atom.action === "search" ? "해당 사실을 지지하거나 반박할 공식 원문을 추가 탐색하세요." : atom.action === "human_review" ? "근거와 시점을 담당자가 확인하세요." : "해당 원자 주장만 수정 또는 삭제하고 다시 검사하세요.", resolved: false });
    if (atom.claimId === null) issues.push({ id: `${run.version}:${atom.id}:unregistered_fact`, targetId: atom.cardId, type: "unregistered_fact", severity: "error", message: `${atom.field}에서 작성자가 등록하지 않은 사실을 발견했습니다: ${atom.text.trim()}`, evidenceIds: atom.evidenceIds, recommendation: "해당 사실을 별도 Claim으로 등록하고 근거를 연결하세요.", resolved: false });
  }
  return { assessments, issues };
}

function fixtureAssessments(run: Run, issues: ReviewIssue[]): ClaimAssessment[] {
  const assessments: ClaimAssessment[] = [];
  for (const card of run.cards) {
    for (const field of ["title", "body", "script"] as const) {
      const related = run.claims.filter((claim) => claim.cardId === card.id && card[field].includes(claim.text) && (claim.kind === "fact" || looksFactual(claim.text)));
      for (const claim of related) {
        const pending = issues.filter((issue) => issue.targetId === claim.id || issue.targetId === card.id);
        const supported = claim.kind === "fact" && claim.support === "supported" && pending.length === 0;
        assessments.push({ id: `fixture:${run.version}:${claim.id}:${field}`, claimId: claim.id, cardId: card.id, field, text: claim.text, start: card[field].indexOf(claim.text), end: card[field].indexOf(claim.text) + claim.text.length, freshness: supported ? "stable" : "unverified", verdict: supported ? "supported" : "insufficient", evidenceIds: claim.evidenceIds.filter((id) => evidenceIsValid(run, id)), rationale: `fixture 규칙 ${REVIEW_RULES_VERSION}: ${supported ? "저장한 공식 문구 또는 허용한 동일 의미 문구와 일치합니다. 실제 모델 판정이 아닙니다." : pending.map((issue) => issue.message).join(" ") || "저장된 규칙으로 지지 여부를 확인할 수 없습니다."}`, action: supported ? "keep" : "search" });
      }
      if (!related.length && looksFactual(card[field])) assessments.push({ id: `fixture:${run.version}:${card.id}:${field}`, claimId: `unregistered:${card.id}:${field}:0`, cardId: card.id, field, text: card[field], start: 0, end: card[field].length, freshness: "unverified", verdict: "insufficient", evidenceIds: [], rationale: `fixture 규칙 ${REVIEW_RULES_VERSION}: 등록되지 않은 사실 표현의 근거를 확인할 수 없습니다.`, action: "human_review" });
    }
  }
  return assessments;
}
