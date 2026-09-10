import { randomUUID } from "node:crypto";
import type { Card, Claim, Decision, Run, SourceResult } from "./types";

export function searchIntent(run: Run, chosen: Decision) {
  const targets = run.claims.filter(
    (claim) => chosen.targetIds.includes(claim.id) || chosen.targetIds.includes(claim.cardId),
  );
  return chosen.search ?? {
    query: targets.map((claim) => claim.text).join(" ") || run.brief.goal,
    targetClaimIds: targets.map((claim) => claim.id),
    missingInformation: run.issues.filter((issue) => !issue.resolved).map((issue) => issue.message),
    reason: chosen.reasonSummary,
  };
}

/** Append immutable evidence. An ID collision must never rewrite an old review's source. */
export function mergeSearchResult(run: Run, result: SourceResult, chosen: Decision, at: string) {
  const sources = new Map(run.sources.map((source) => [source.id, source]));
  const evidence = new Map(run.evidence.map((item) => [item.id, item]));
  for (const source of result.sources) {
    const existing = sources.get(source.id);
    if (existing && (existing.hash !== source.hash || existing.snapshot !== source.snapshot || existing.url !== source.url)) {
      throw new Error("동일한 출처 ID의 스냅샷을 덮어쓸 수 없습니다.");
    }
    if (!existing) sources.set(source.id, structuredClone(source));
  }
  const newIds: string[] = [];
  const normalized = (quote: string) => quote.normalize("NFKC").replace(/\s+/g, " ").trim();
  const knownQuotes = new Set(run.evidence.map((item) => normalized(item.quote)));
  for (const item of result.evidence) {
    const existing = evidence.get(item.id);
    if (existing && (existing.quote !== item.quote || existing.sourceId !== item.sourceId)) {
      throw new Error("동일한 근거 ID의 원문을 덮어쓸 수 없습니다.");
    }
    if (!sources.has(item.sourceId)) throw new Error("검색 근거의 출처 스냅샷이 없습니다.");
    if (!existing) {
      evidence.set(item.id, structuredClone(item));
      const quote = normalized(item.quote);
      if (!knownQuotes.has(quote)) newIds.push(item.id);
      knownQuotes.add(quote);
    }
  }
  const intent = searchIntent(run, chosen);
  const report = result.search ? structuredClone(result.search) : {
    ...intent,
    id: randomUUID(), at, version: run.version,
    visitedPages: result.sources.length,
    newEvidenceCount: newIds.length,
    evidenceIds: newIds,
    resolvedClaimIds: [],
    remainingInformation: intent.missingInformation,
    errors: [],
  };
  // Search provides new candidates, never a semantic success verdict.
  report.newEvidenceCount = newIds.length;
  report.resolvedClaimIds = [];
  report.evidenceIds = newIds;
  run.sources = [...sources.values()];
  run.evidence = [...evidence.values()];
  (run.searches ??= []).push(report);
  if (run.execution) run.execution.sourceSnapshotIds = run.sources.map((source) => source.id);
  return report;
}

function preserveClaimIds(prior: Claim[], incoming: Claim[], card: Card) {
  const incomingIds = new Set(incoming.map((claim) => claim.id));
  const unused = prior.filter((claim) => !incomingIds.has(claim.id));
  const mapping = new Map<string, string>();
  for (const claim of incoming) {
    if (prior.some((old) => old.id === claim.id)) continue;
    const matchingText = unused.findIndex((old) => old.text === claim.text);
    if (matchingText < 0 && prior.length !== incoming.length) continue;
    const [old] = unused.splice(matchingText < 0 ? 0 : matchingText, 1);
    if (old) mapping.set(claim.id, old.id);
  }
  return {
    claims: incoming.map((claim) => ({ ...claim, id: mapping.get(claim.id) ?? claim.id })),
    card: { ...card, claimIds: card.claimIds.map((id) => mapping.get(id) ?? id) },
  };
}

function claimContent(claim: Claim) {
  return { id: claim.id, cardId: claim.cardId, text: claim.text, kind: claim.kind, evidenceIds: claim.evidenceIds };
}

/** Claim targets permit exact local substitutions, never a rewrite of the containing card. */
function assertClaimUpdateScope(old: Card, next: Card, prior: Claim[], incoming: Claim[], targetIds: Set<string>) {
  if (JSON.stringify(old.claimIds) !== JSON.stringify(next.claimIds) || prior.length !== incoming.length || new Set(incoming.map((claim) => claim.id)).size !== incoming.length ||
      incoming.some((claim) => !prior.some((existing) => existing.id === claim.id))) {
    throw new Error("Claim 단위 수정에서 주장 추가·삭제·재정렬은 허용하지 않습니다. 카드 단위 수정 대상을 명시하세요.");
  }
  if (old.imagination !== next.imagination) {
    throw new Error("지정 Claim 밖의 카드 표시를 변경할 수 없습니다. 카드 단위 수정 대상을 명시하세요.");
  }
  const targeted = prior.filter((claim) => targetIds.has(claim.id));
  const untouched = prior.filter((claim) => !targetIds.has(claim.id));
  for (const claim of untouched) {
    const index = incoming.findIndex((candidate) => candidate.id === claim.id);
    if (index < 0 || JSON.stringify(claimContent(claim)) !== JSON.stringify(claimContent(incoming[index]))) {
      throw new Error("같은 카드 안에서도 지정하지 않은 Claim의 내용이나 근거는 변경할 수 없습니다.");
    }
    incoming[index] = structuredClone(claim);
  }
  for (const field of ["title", "body", "script"] as const) {
    const text = old[field];
    const replacements: { start: number; end: number; text: string }[] = [];
    for (const claim of targeted) {
      const replacement = incoming.find((candidate) => candidate.id === claim.id)!;
      if (!claim.text) throw new Error("수정 대상 Claim의 원문 위치를 안전하게 확인할 수 없습니다.");
      let from = 0;
      while (from < text.length) {
        const start = text.indexOf(claim.text, from);
        if (start < 0) break;
        const end = start + claim.text.length;
        if (claim.text !== replacement.text) replacements.push({ start, end, text: replacement.text });
        from = end;
      }
    }
    replacements.sort((left, right) => left.start - right.start || left.end - right.end);
    for (let i = 0; i < replacements.length; i++) {
      const span = replacements[i];
      if (i > 0 && span.start < replacements[i - 1].end) throw new Error("수정 대상 Claim 구간이 겹쳐 안전하게 분리할 수 없습니다. 카드 단위 수정이 필요합니다.");
      for (const claim of untouched) {
        if (!claim.text) continue;
        let from = 0;
        while (from < text.length) {
          const start = text.indexOf(claim.text, from);
          if (start < 0) break;
          const end = start + claim.text.length;
          if (span.start < end && span.end > start) throw new Error("수정 구간이 지정하지 않은 Claim과 겹칩니다. 카드 단위 수정이 필요합니다.");
          from = end;
        }
      }
    }
    let expected = "";
    let cursor = 0;
    for (const span of replacements) { expected += text.slice(cursor, span.start) + span.text; cursor = span.end; }
    expected += text.slice(cursor);
    if (next[field] !== expected) throw new Error(`수정 대상으로 지정한 Claim 구간 밖의 ${field} 내용을 변경할 수 없습니다.`);
  }
  for (const claim of targeted) {
    const replacement = incoming.find((candidate) => candidate.id === claim.id)!;
    if (claim.text !== replacement.text && !(["title", "body", "script"] as const).some((field) => old[field].includes(claim.text))) {
      throw new Error("수정 대상 Claim의 원문 구간을 찾을 수 없습니다. 카드 단위 수정이 필요합니다.");
    }
  }
}

/** Explicit cards may change as a unit; claim targets are confined to their exact source fragments. */
export function applyStoryUpdate(
  run: Run,
  story: { cards: Card[]; claims: Claim[] },
  chosen: Decision,
  at: string,
): boolean {
  if (chosen.expectedVersion !== undefined && chosen.expectedVersion !== run.version) {
    throw new Error("수정 대상 버전이 변경되었습니다. 최신 버전으로 다시 검토하세요.");
  }
  const initial = run.cards.length === 0;
  let cards = structuredClone(story.cards);
  let claims = structuredClone(story.claims);
  if (!initial) {
    const targetIds = new Set(chosen.targetIds);
    const targetCards = new Set(run.cards.filter((card) =>
      targetIds.has("run") || targetIds.has(card.id) || card.claimIds.some((id) => targetIds.has(id)),
    ).map((card) => card.id));
    // The declared baseline includes its one correction even on clean content.
    const baselineWholeCard = run.strategy === "baseline" && targetCards.size === 0;
    if (baselineWholeCard) {
      run.cards.forEach((card) => targetCards.add(card.id));
    }
    if (targetCards.size === 0) throw new Error("부분 수정 대상 카드가 지정되지 않았습니다.");
    const nextClaims: Claim[] = [];
    const proposals: NonNullable<Run["proposedChanges"]> = [];
    const mergedCards: Card[] = [];
    for (const old of run.cards) {
      if (!targetCards.has(old.id)) {
        mergedCards.push(structuredClone(old));
        nextClaims.push(...structuredClone(run.claims.filter((claim) => claim.cardId === old.id)));
        continue;
      }
      const candidate = cards.find((card) => card.id === old.id);
      if (!candidate) throw new Error("부분 수정에서 기존 카드 ID가 누락되었습니다.");
      const prior = run.claims.filter((claim) => claim.cardId === old.id);
      const stable = preserveClaimIds(prior, claims.filter((claim) => claim.cardId === old.id), candidate);
      const next = stable.card;
      const incoming = stable.claims;
      if (!baselineWholeCard && !targetIds.has("run") && !targetIds.has(old.id)) {
        assertClaimUpdateScope(old, next, prior, incoming, targetIds);
      }
      const withoutVerdicts = (items: Claim[]) => items.map((claim) => ({ ...claim, support: undefined }));
      const changed = JSON.stringify(old) !== JSON.stringify(next) ||
        JSON.stringify(withoutVerdicts(prior)) !== JSON.stringify(withoutVerdicts(incoming));
      if (changed && run.protectedCardIds?.includes(old.id)) {
        proposals.push({
          cardId: old.id, expectedVersion: run.version,
          before: structuredClone(old), after: structuredClone(next),
          claims: structuredClone(incoming), reason: chosen.reasonSummary,
          evidenceIds: [...new Set(incoming.flatMap((claim) => claim.evidenceIds))],
        });
      }
      mergedCards.push(next);
      nextClaims.push(...incoming);
    }
    if (proposals.length > 0) {
      (run.proposedChanges ??= []).push(...proposals);
      run.status = "needs_review";
      run.stopReason = "담당자가 편집한 문구에 수정 제안이 있습니다. 내용을 확인하고 직접 반영한 뒤 재검수하세요.";
      run.approval = null;
      run.artifacts = [];
      return false;
    }
    cards = mergedCards;
    claims = nextClaims;
  }
  if (cards.length !== 4 || new Set(cards.map((card) => card.id)).size !== 4 ||
      new Set(claims.map((claim) => claim.id)).size !== claims.length) {
    throw new Error("수정 콘텐츠의 카드 또는 주장 ID가 중복되거나 누락되었습니다.");
  }
  run.version++;
  run.cards = cards;
  run.claims = claims;
  run.automaticRevisions = (run.automaticRevisions ?? 0) + (initial ? 0 : 1);
  run.reviewVersion = null;
  run.approval = null;
  run.artifacts = [];
  run.assessments = [];
  run.proposedChanges = [];
  run.revisions.push({
    version: run.version, createdAt: at,
    cards: structuredClone(cards), claims: structuredClone(claims),
    reason: chosen.reasonSummary, origin: "model",
    evidenceIds: [...new Set(claims.flatMap((claim) => claim.evidenceIds))],
  });
  return true;
}

export function recordReview(run: Run, at: string) {
  (run.reviews ??= []).push({
    version: run.version, at,
    sourceSnapshotIds: run.sources.map((source) => source.id),
    assessments: structuredClone(run.assessments ?? []),
    issues: structuredClone(run.issues.filter((issue) => !issue.resolved)),
  });
  for (const search of run.searches ?? []) {
    if (search.version !== run.version) continue;
    search.resolvedClaimIds = search.targetClaimIds.filter((id) => {
      const claim = run.claims.find((claim) => claim.id === id);
      const assessments = (run.assessments ?? []).filter((assessment) => assessment.claimId === id);
      return claim?.support === "supported" && assessments.some((assessment) =>
        assessment.verdict === "supported" && assessment.evidenceIds.some((id) => search.evidenceIds.includes(id)),
      );
    });
    if (search.targetClaimIds.length > 0 && search.resolvedClaimIds.length === search.targetClaimIds.length) {
      search.remainingInformation = [];
    }
  }
}
