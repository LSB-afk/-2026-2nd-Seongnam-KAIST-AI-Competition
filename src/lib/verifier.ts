import type { Claim, ReviewIssue, Run } from "./types";

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
      !compact(source.snapshot).includes(compact(evidence.quote))
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
      "박물관을 소개하는 근거 있는 사실 문장이 최소 2개 필요합니다.",
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
    if (/AI\s*산업.*이어|기술.*계승|직접.*이어졌|기원.*AI/.test(claim.text))
      add(
        claim.id,
        "unsupported_relation",
        "문화유산과 오늘날 산업의 역사적 연결을 지지하는 근거가 없습니다.",
        claim.evidenceIds,
        "공식 자료를 추가 확인하고, 근거가 없으면 인과관계를 삭제하거나 명확한 비유로 바꾸세요.",
      );
    if (/사업.*확정|조성.*확정|건립.*확정|내년.*개관/.test(claim.text))
      add(
        claim.id,
        "future_as_fact",
        "미래 장면을 확정 사업처럼 표현했습니다. 공식 계획 근거를 확인해야 합니다.",
        claim.evidenceIds,
        "확인되지 않은 계획 주장을 제거하고 창작 장면을 명확히 표시하세요.",
      );
    if (
      claim.kind !== "fact" &&
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
  return issues;
}
