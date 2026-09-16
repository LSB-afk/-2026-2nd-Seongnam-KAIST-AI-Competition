"use client";

import type { Card, ClaimAssessment, Revision, Run, Source } from "@/lib/types";
import styles from "./review-trace.module.css";

const verdictLabels = { supported: "근거가 지지함", contradicted: "근거와 모순됨", insufficient: "판단 근거 부족" };
const actionLabels = {
  keep: "원문과 대조한 표현을 유지하고 담당자 검토를 이어가세요.",
  search: "이 문장을 확인할 공식 자료를 추가로 확인한 뒤 재검수하세요.",
  revise: "근거에 맞게 해당 표현을 수정한 뒤 재검수하세요.",
  delete: "확인할 수 없는 해당 표현을 삭제한 뒤 재검수하세요.",
  human_review: "담당자가 원문과 시점을 대조하고 수정 여부를 판단해 주세요.",
};
const fieldLabels = { title: "제목", body: "본문", script: "대본" };
const relationLabels = { supports: "이 문장을 지지하는 근거", contradicts: "이 문장과 모순되는 근거", context: "판단에 참고한 배경 자료" };
const freshnessLabels = { stable: "시점 영향이 적은 사실", current: "검수 시점 기준 확인", unverified: "시점 추가 확인 필요", outdated: "오래된 자료 · 현재 정보 재확인", conflicting: "자료 간 시점 또는 내용 충돌" };
type SelectField = (field: ClaimAssessment["field"]) => void;

export function safeSourceUrl(url: string): string | undefined {
  try { const parsed = new URL(url); return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : undefined; }
  catch { return undefined; }
}

/** Revisions in which this card itself differs from the revision before, so unchanged cards are not listed as edited. */
export function cardRevisionChanges(revisions: Revision[], cardId: string): { revision: Revision; previous?: Card; next?: Card }[] {
  return revisions.slice(1).flatMap((revision, index) => {
    const previous = revisions[index].cards.find((entry) => entry.id === cardId);
    const next = revision.cards.find((entry) => entry.id === cardId);
    const unchanged = previous?.title === next?.title && previous?.body === next?.body && previous?.script === next?.script &&
      previous?.image?.src === next?.image?.src && previous?.image?.crop.x === next?.image?.crop.x && previous?.image?.crop.y === next?.image?.crop.y && previous?.image?.crop.zoom === next?.image?.crop.zoom;
    return unchanged ? [] : [{ revision, previous, next }];
  });
}

function collectedAt(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "미기록";
}

function SourceSnapshot({ source }: { source: Source }) {
  const href = safeSourceUrl(source.url);
  return <div className={`trace-source ${styles.source}`}>
    {href ? <a href={href} target="_blank" rel="noreferrer">{source.title} <span aria-hidden="true">↗</span></a> : <strong>{source.title}</strong>}
    <p>{source.publisher} · {source.status === "ok" ? "수집 당시 원문 확인" : "원문 접근 실패"}</p>
    <dl className={styles.sourceDates}>
      <dt>자료 수집</dt><dd>{collectedAt(source.retrievedAt)} <span>(한국 시간)</span></dd>
      <dt>원문 발행</dt><dd>{source.publishedAt || "원문에 표시된 시점 미확인"}</dd>
      <dt>원문 수정</dt><dd>{source.modifiedAt || "원문에 표시된 시점 미확인"}</dd>
    </dl>
    <p className={styles.dateNote}>자료 수집일은 원문의 발행·수정일과 다릅니다. 방문 정보는 현재 원문도 확인해 주세요.</p>
    <details className="trace-snapshot"><summary>검수에 사용한 원문 보기</summary><pre>{source.snapshot || "저장된 원문이 없습니다."}</pre></details>
    <details className="trace-snapshot"><summary>기록 식별 정보</summary><p>자료 ID: {source.id}</p><p>스냅샷 해시: {source.hash || "미기록"}</p><p>이용 조건: {source.license || "미기록"}</p></details>
  </div>;
}

function EvidenceDetail({ run, id, expanded = false, citation }: {
  run: Run; id: string; expanded?: boolean; citation?: NonNullable<ClaimAssessment["citations"]>[number];
}) {
  const evidence = run.evidence.find((entry) => entry.id === id);
  const source = run.sources.find((entry) => entry.id === evidence?.sourceId);
  const linkedCitation = citation && citation.sourceId === evidence?.sourceId && citation.quote === evidence?.quote ? citation : undefined;
  return <details className={`trace-evidence ${styles.evidence}`} open={expanded}>
    <summary>{source?.title || (evidence ? "연결된 원문 확인 필요" : "근거 기록 확인 필요")}</summary>
    {evidence ? <>
      {linkedCitation && <p className={styles.relation}>{relationLabels[linkedCitation.relation]}</p>}
      <blockquote>{evidence.quote}</blockquote>
      {linkedCitation && <p>{linkedCitation.explanation}</p>}
      <p className={styles.locator}>원문 위치 · {evidence.locator || "미기록"}</p>
    </> : <p>이 기록에서 근거 내용을 찾을 수 없습니다. 공식 자료를 다시 확인해 주세요.</p>}
    {source && <SourceSnapshot source={source} />}
    <details className="trace-snapshot"><summary>근거 연결 정보</summary><p>근거 ID: {id}</p>{evidence?.searchId && <p>수집 검색 ID: {evidence.searchId}</p>}</details>
  </details>;
}

export function EvidenceLinks({ run, ids }: { run: Run; ids: string[] }) {
  return <div className="trace-evidence-links">{[...new Set(ids)].map((id) => <EvidenceDetail key={id} run={run} id={id} />)}</div>;
}

function AssessmentList({ run, assessments, current = false, onSelectField }: {
  run: Run; assessments: ClaimAssessment[]; current?: boolean; onSelectField?: SelectField;
}) {
  const firstToCheck = assessments.find((item) => item.verdict !== "supported")?.id ?? assessments[0]?.id;
  return <div className={`assessment-list ${styles.claimList}`}>{assessments.map((assessment) => <details className={styles.claim} key={assessment.id} open={current && assessment.id === firstToCheck}>
    <summary className={styles.claimSummary}>
      <span className={styles.claimHeading}><span className={`verdict ${assessment.verdict}`}>{verdictLabels[assessment.verdict]}</span><span>{fieldLabels[assessment.field]}</span><span className={styles.disclosure} aria-hidden="true">＋</span></span>
      <span className={styles.sentence}>{assessment.text}</span>
    </summary>
    <div className={styles.claimContent}>
      <div className={styles.reason}><strong>판정 이유</strong><p>{assessment.rationale}</p>{assessment.freshness && <p className={styles.freshness}>{freshnessLabels[assessment.freshness]}</p>}</div>
      <div className={styles.nextAction}><strong>다음 행동</strong><p>{actionLabels[assessment.action]}</p>
        {current && onSelectField && assessment.field !== "script" && <button type="button" className="secondary-button" onClick={() => onSelectField(assessment.field)}>{fieldLabels[assessment.field]} 편집으로 이동</button>}
      </div>
      <div className={styles.linkedEvidence}><strong>대조한 근거</strong>{assessment.evidenceIds.length > 0
        ? [...new Set(assessment.evidenceIds)].map((id) => <EvidenceDetail key={id} run={run} id={id} expanded citation={assessment.citations?.find((entry) => entry.evidenceId === id)} />)
        : <p className="trace-muted">연결된 근거가 없습니다. 공식 자료를 추가로 확인해 주세요.</p>}
      </div>
    </div>
  </details>)}</div>;
}

function matchesCurrentCard(card: Card | undefined, assessment: ClaimAssessment) {
  if (!card || !assessment.text.trim()) return false;
  if (assessment.start !== undefined && assessment.end !== undefined) {
    return assessment.start >= 0 && assessment.end > assessment.start && card[assessment.field].slice(assessment.start, assessment.end) === assessment.text;
  }
  return card[assessment.field].includes(assessment.text);
}

export function AtomicReview({ run, cardId, onSelectField }: { run: Run; cardId: string; onSelectField?: SelectField }) {
  const card = run.cards.find((entry) => entry.id === cardId);
  const reviewed = run.reviewVersion === run.version;
  const recorded = reviewed ? (run.assessments || []).filter((entry) => entry.cardId === cardId) : [];
  const assessments = recorded.filter((entry) => matchesCurrentCard(card, entry));
  const mismatched = recorded.length - assessments.length;
  const pending = assessments.filter((entry) => entry.verdict !== "supported").length;
  const history = (run.reviews || []).filter((review) => review.version < run.version && review.assessments.some((entry) => entry.cardId === cardId));
  return <section className={`atomic-review ${styles.review}`} aria-label="문장별 세부 검수">
    <div className={styles.reviewHeading}><h3>문장별 세부 검수</h3><span>콘텐츠 v{run.version}</span></div>
    <p className={styles.intro}>문장을 선택하면 판정 이유와 실제 근거를 함께 확인할 수 있어요.</p>
    {run.mode === "fixture" && <p className={styles.demoNotice}>저장된 응답 데모 · 실제 모델 판정이 아닙니다.</p>}
    {!reviewed && <p className={styles.reviewNotice} role="status">현재 v{run.version}의 재검수가 필요합니다. 이전 판정으로 현재 문구를 승인할 수 없습니다.</p>}
    {mismatched > 0 && <p className={styles.reviewNotice} role="status">현재 문구와 일치하지 않는 판정 {mismatched}개가 있어 숨겼습니다. 재검수 후 확인해 주세요.</p>}
    {assessments.length > 0 ? <>
      <div className={styles.reviewCounts}><span>연결된 판정 {assessments.length}개</span><strong>{pending ? `확인이 필요한 문장 ${pending}개` : "연결된 문장은 근거가 지지합니다"}</strong></div>
      <p className={styles.distinction}>근거 부족은 거짓이라는 뜻이 아닙니다. 확인할 자료가 더 필요하다는 의미입니다. 이 판정은 담당자 승인을 대신하지 않습니다.</p>
      <AssessmentList key={`${run.id}:${run.version}:${cardId}`} run={run} assessments={assessments} current onSelectField={onSelectField} />
    </> : reviewed && <p className="field-note">현재 문구에 연결된 문장별 판정이 없습니다. 판정 기록만으로 이 카드 전체의 검수 통과를 판단하지 마세요.</p>}
    {history.length > 0 && <details className={styles.history}><summary>이전 버전의 검수 기록 · {history.length}회</summary><p className={styles.distinction}>당시 문구를 검수한 결과이며 현재 문구의 판정이 아닙니다.</p>
      {history.map((review, index) => <details className="review-snapshot" key={`${review.version}-${index}`}><summary>v{review.version} · {collectedAt(review.at)}</summary><AssessmentList run={run} assessments={review.assessments.filter((entry) => entry.cardId === cardId)} /></details>)}
    </details>}
  </section>;
}

export function ProtectedChanges({ run, cardId, disabled, onLoad }: { run: Run; cardId: string; disabled: boolean; onLoad: (card: Card) => void }) {
  const proposals = (run.proposedChanges || []).filter((entry) => entry.cardId === cardId);
  const protectedCard = run.protectedCardIds?.includes(cardId);
  if (!protectedCard && !proposals.length) return null;
  return <section className="protected-changes" aria-label="담당자 문구 보호와 수정 제안">
    {protectedCard && <div className="protected-notice"><strong>담당자가 수정한 카드</strong><p>직접 수정한 문구는 자동으로 덮어쓰지 않습니다. 아래 제안을 확인하고 필요한 표현을 선택해 주세요.</p></div>}
    {proposals.map((proposal, index) => <article className="revision-item" key={`${proposal.expectedVersion}-${index}`}>
      <h3>자동 수정 제안 · 기준 v{proposal.expectedVersion}</h3><p className="field-note">{proposal.reason}</p>
      <div className="before"><span>현재 문구</span><p>{proposal.before.title}<br />{proposal.before.body}</p><details><summary>현재 대본</summary><p>{proposal.before.script}</p></details></div>
      <div className="after"><span>제안 문구 · 아직 적용되지 않음</span><p>{proposal.after.title}<br />{proposal.after.body}</p><details><summary>제안 대본</summary><p>{proposal.after.script}</p></details></div>
      <EvidenceLinks run={run} ids={proposal.evidenceIds} />
      <button type="button" className="secondary-button" disabled={disabled || proposal.expectedVersion !== run.version} onClick={() => onLoad(proposal.after)}>제안을 편집창에 불러오기</button>
      <p className="field-note">{proposal.expectedVersion !== run.version ? "이전 버전의 제안입니다. 현재 버전에서 재검수가 필요합니다." : "제목과 본문만 편집창에 복사합니다. 저장 전 수정할 수 있고, 저장 후 재검수가 필요합니다."}</p>
    </article>)}
  </section>;
}

export function RunTrace({ run, duration }: { run: Run; duration: number }) {
  const attempts = run.execution?.apiCalls;
  return <div className="run-trace">
    <details className="trace-section"><summary>검색과 근거 수집 <span>{run.searches?.length ?? 0}회 기록</span></summary>
      {run.searches?.length ? run.searches.map((search, index) => <article className="search-record" key={search.id}>
        <h3>{index + 1}차 검색 · v{search.version}</h3><time>{new Date(search.at).toLocaleString("ko-KR")}</time>
        <dl className="trace-definition"><dt>검색 질문</dt><dd>{search.query}</dd><dt>검색 이유</dt><dd>{search.reason}</dd><dt>보완할 정보</dt><dd>{search.missingInformation.length ? search.missingInformation.join(" / ") : "기록 없음"}</dd><dt>확인한 페이지</dt><dd>{search.visitedPages}개</dd><dt>새로 확보한 근거</dt><dd>{search.newEvidenceCount}개</dd><dt>해결한 주장</dt><dd>{search.resolvedClaimIds.length}개</dd><dt>남은 확인 사항</dt><dd>{search.remainingInformation.length ? search.remainingInformation.join(" / ") : "기록된 미해결 정보 없음"}</dd></dl>
        {search.targetClaimIds.length > 0 && <details className="trace-evidence"><summary>검색 대상 주장 {search.targetClaimIds.length}개</summary><ul>{search.targetClaimIds.map((id) => { const claim = run.revisions.find((revision) => revision.version === search.version)?.claims.find((item) => item.id === id) || (run.version === search.version ? run.claims.find((item) => item.id === id) : undefined); return <li key={id}>{claim?.text || id}</li>; })}</ul></details>}
        <EvidenceLinks run={run} ids={search.evidenceIds} />
        {search.errors.length > 0 && <div className="trace-errors"><strong>수집 중 확인된 문제</strong><ul>{search.errors.map((message, errorIndex) => <li key={errorIndex}>{message}</li>)}</ul></div>}
      </article>) : <p className="field-note">이 실행에는 검색 의도와 결과의 상세 기록이 없습니다.</p>}
    </details>
    <details className="trace-section"><summary>검수 버전과 자료 원문 <span>{run.reviews?.length ?? 0}회 검수</span></summary>
      <p className="field-note">현재 콘텐츠 v{run.version} · 검수 {run.reviewVersion === null ? "미완료" : `v${run.reviewVersion}`} · 담당자 승인 {run.approval ? `v${run.approval.version}` : "대기"}</p>
      {(run.reviews || []).map((review, index) => <details className="review-snapshot" key={`${review.version}-${index}`}><summary>v{review.version} 검수 · {new Date(review.at).toLocaleString("ko-KR")}</summary><p className="field-note">판정 {review.assessments.length}개 · 미해결 항목 {review.issues.filter((issue) => !issue.resolved).length}개</p><p className="trace-hash">사용한 자료 스냅샷: {review.sourceSnapshotIds.join(", ") || "미기록"}</p><AssessmentList run={run} assessments={review.assessments} /></details>)}
      <details className="trace-source-list"><summary>수집한 원문 {run.sources.length}개</summary>{run.sources.map((source) => <SourceSnapshot key={source.id} source={source} />)}</details>
    </details>
    <details className="trace-section"><summary>실행 방식과 사용량</summary>
      <dl className="trace-definition"><dt>실행 모드</dt><dd>{run.mode === "fixture" ? "저장된 응답 데모 · 실제 모델 판단 아님" : "실제 AI"}</dd><dt>실제 모델 API 시도</dt><dd>{attempts === undefined ? "미기록" : `${attempts}회`}</dd><dt>모델</dt><dd>{run.execution?.model || (run.mode === "fixture" ? "사용하지 않음" : "미기록")}</dd><dt>실행 시간 / 상한</dt><dd>{duration}초 / {Math.round(run.limits.maxDurationMs / 1000)}초</dd><dt>도구 호출 / 상한</dt><dd>{run.usage.toolCalls}회 / {run.limits.maxToolCalls}회</dd><dt>모델 호출 / 상한</dt><dd>{run.usage.modelCalls}회 / {run.limits.maxModelCalls}회</dd><dt>자동 수정 / 상한</dt><dd>{run.automaticRevisions === undefined ? "미기록" : `${run.automaticRevisions}회`} / {run.limits.maxRevisions}회</dd><dt>추정 비용 / 상한</dt><dd>{run.usage.costKind === "fixture" ? "모의 실행 · API 비용 없음" : `$${run.usage.costUsd.toFixed(4)} / $${run.limits.maxCostUsd.toFixed(4)}`}</dd><dt>입력 / 출력 토큰</dt><dd>{run.usage.inputTokens.toLocaleString()} / {run.usage.outputTokens.toLocaleString()}</dd></dl>
      <details className="trace-evidence"><summary>재현을 위한 실행 정보</summary><p>프롬프트 버전: {run.execution?.promptVersion || "미기록"}</p><p>검수 규칙 버전: {run.execution?.reviewRulesVersion || "미기록"}</p><p className="trace-hash">자료 스냅샷: {run.execution?.sourceSnapshotIds.join(", ") || "미기록"}</p></details>
      {!!run.modelCallLog?.length && <details className="trace-evidence"><summary>모델 API 호출 기록 {run.modelCallLog.length}개</summary>{run.modelCallLog.map((call) => <article className="model-call" key={call.id}><strong>{call.status === "succeeded" ? "성공" : call.status === "failed" ? "실패" : "호출 예약"} · {call.model}</strong><p>{new Date(call.at).toLocaleString("ko-KR")} · {call.promptVersion}</p><p>기록 비용 ${call.costUsd.toFixed(4)} · 예약 비용 ${call.reservedCostUsd.toFixed(4)}</p>{call.error && <p className="trace-errors">{call.error}</p>}</article>)}</details>}
    </details>
  </div>;
}
