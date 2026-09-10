import type { Card, ClaimAssessment, Run, Source } from "@/lib/types";

const verdictLabels = { supported: "근거가 지지함", contradicted: "근거와 모순됨", insufficient: "판단 근거 부족" };
const actionLabels = { keep: "표현 유지", search: "추가 조사", revise: "표현 수정", delete: "표현 삭제", human_review: "담당자 판단" };
const fieldLabels = { title: "제목", body: "본문", script: "대본" };

export function safeSourceUrl(url: string): string | undefined {
  try { const parsed = new URL(url); return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : undefined; }
  catch { return undefined; }
}

function SourceSnapshot({ source }: { source: Source }) {
  const href = safeSourceUrl(source.url);
  return <div className="trace-source">
    {href ? <a href={href} target="_blank" rel="noreferrer">{source.title} ↗</a> : <strong>{source.title}</strong>}
    <p>{source.publisher} · {source.status === "ok" ? "원문 확인" : "접근 실패"}</p>
    <p>수집 {new Date(source.retrievedAt).toLocaleString("ko-KR")}</p>
    {source.publishedAt && <p>발행 {source.publishedAt}</p>}
    {source.modifiedAt && <p>원문 수정 {source.modifiedAt}</p>}
    <details className="trace-snapshot"><summary>검수에 사용한 원문 보기</summary><p>자료 ID: {source.id}</p><p>스냅샷 해시: {source.hash || "미기록"}</p><pre>{source.snapshot || "저장된 원문이 없습니다."}</pre></details>
  </div>;
}

export function EvidenceLinks({ run, ids }: { run: Run; ids: string[] }) {
  return <div className="trace-evidence-links">{[...new Set(ids)].map((id) => {
    const evidence = run.evidence.find((entry) => entry.id === id);
    const source = run.sources.find((entry) => entry.id === evidence?.sourceId);
    return <details className="trace-evidence" key={id}>
      <summary>근거 {id}{source ? ` · ${source.title}` : " · 원문 연결 미확인"}</summary>
      {evidence ? <><blockquote>{evidence.quote}</blockquote><p>{evidence.locator}</p>{evidence.searchId && <p>수집 검색: {evidence.searchId}</p>}</> : <p>이 기록에서 근거 내용을 찾을 수 없습니다.</p>}
      {source && <SourceSnapshot source={source} />}
    </details>;
  })}</div>;
}

function AssessmentList({ run, assessments }: { run: Run; assessments: ClaimAssessment[] }) {
  return <div className="assessment-list">{assessments.map((assessment) => <article className="assessment-item" key={assessment.id}>
    <div className="assessment-heading"><span className={`verdict ${assessment.verdict}`}>{verdictLabels[assessment.verdict]}</span><span>{fieldLabels[assessment.field]}</span></div>
    <p className="assessment-text">{assessment.text}</p>
    <p>{assessment.rationale}</p>
    <p className="assessment-action">다음 조치: {actionLabels[assessment.action]}</p>
    {assessment.evidenceIds.length > 0 ? <EvidenceLinks run={run} ids={assessment.evidenceIds} /> : <p className="trace-muted">연결된 근거 없음</p>}
  </article>)}</div>;
}

export function AtomicReview({ run, cardId }: { run: Run; cardId: string }) {
  const assessments = (run.assessments || []).filter((entry) => entry.cardId === cardId);
  return <section className="atomic-review" aria-label="문장별 세부 검수"><h3>문장별 세부 검수</h3>
    <p className="trace-muted">제목·본문·대본의 주장을 각각 확인한 결과입니다.</p>
    {assessments.length ? <AssessmentList run={run} assessments={assessments} /> : <p className="field-note">이 버전에는 문장별 세부 판정 기록이 없습니다.</p>}
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
      <dl className="trace-definition"><dt>실행 모드</dt><dd>{run.mode === "fixture" ? "저장된 응답 데모 · 실제 모델 판단 아님" : "실제 AI"}</dd><dt>실제 모델 API 시도</dt><dd>{attempts === undefined ? "미기록" : `${attempts}회`}</dd><dt>모델</dt><dd>{run.execution?.model || (run.mode === "fixture" ? "사용하지 않음" : "미기록")}</dd><dt>실행 시간 / 상한</dt><dd>{duration}초 / {Math.round(run.limits.maxDurationMs / 1000)}초</dd><dt>도구 호출 / 상한</dt><dd>{run.usage.toolCalls}회 / {run.limits.maxToolCalls}회</dd><dt>모델 호출 / 상한</dt><dd>{run.usage.modelCalls}회 / {run.limits.maxModelCalls}회</dd><dt>자동 수정 / 상한</dt><dd>{run.automaticRevisions === undefined ? "미기록" : `${run.automaticRevisions}회`} / {run.limits.maxRevisions}회</dd><dt>추정 비용 / 상한</dt><dd>{run.mode === "fixture" ? "모의 실행 · API 비용 없음" : `$${run.usage.costUsd.toFixed(4)} / $${run.limits.maxCostUsd.toFixed(4)}`}</dd><dt>입력 / 출력 토큰</dt><dd>{run.usage.inputTokens.toLocaleString()} / {run.usage.outputTokens.toLocaleString()}</dd></dl>
      <details className="trace-evidence"><summary>재현을 위한 실행 정보</summary><p>프롬프트 버전: {run.execution?.promptVersion || "미기록"}</p><p>검수 규칙 버전: {run.execution?.reviewRulesVersion || "미기록"}</p><p className="trace-hash">자료 스냅샷: {run.execution?.sourceSnapshotIds.join(", ") || "미기록"}</p></details>
      {!!run.modelCallLog?.length && <details className="trace-evidence"><summary>모델 API 호출 기록 {run.modelCallLog.length}개</summary>{run.modelCallLog.map((call) => <article className="model-call" key={call.id}><strong>{call.status === "succeeded" ? "성공" : call.status === "failed" ? "실패" : "호출 예약"} · {call.model}</strong><p>{new Date(call.at).toLocaleString("ko-KR")} · {call.promptVersion}</p><p>기록 비용 ${call.costUsd.toFixed(4)} · 예약 비용 ${call.reservedCostUsd.toFixed(4)}</p>{call.error && <p className="trace-errors">{call.error}</p>}</article>)}</details>}
    </details>
  </div>;
}
