"use client";

import type { Action, Run } from "@/lib/types";
import { EvidenceLinks, RunTrace } from "./review-trace";
import "./agent-center.css";

const skills: { action: Action; title: string; description: string; detail: string }[] = [
  { action: "search_sources", title: "공식 자료 찾기", description: "선택한 장소의 공식 원문에서 이야기의 근거를 찾습니다.", detail: "장소에 등록된 공식 URL만 확인합니다. 수집한 자료가 문장을 뒷받침하는지는 별도로 검수합니다." },
  { action: "compose_story", title: "독자에 맞게 작성하기", description: "제작 목적과 독자를 반영해 네 장의 이야기를 구성합니다.", detail: "허용된 문구의 부분 수정도 이 기능에서 수행합니다. 직접 편집한 카드는 보호하며 마지막 상상 장면을 구분합니다." },
  { action: "verify_content", title: "문장과 근거 대조하기", description: "제목·본문·대본의 사실을 근거와 하나씩 대조합니다.", detail: "지지됨·충돌함·근거 부족을 구분합니다. 근거 부족은 거짓이라는 뜻이 아니며 담당자의 원문 확인이 필요합니다." },
  { action: "render_cards", title: "카드 파일 만들기", description: "검수한 문구와 사진으로 PNG와 ZIP을 만듭니다.", detail: "현재 버전의 문구, 사진, 출처를 함께 출력합니다. 담당자가 승인한 뒤 다운로드할 수 있습니다." },
  { action: "finish", title: "제작 단계 마무리", description: "파일과 검수 상태를 확인하고 담당자 검토를 기다립니다.", detail: "에이전트의 실행 완료는 담당자 승인이 아닙니다. 최종 문구와 사진을 확인한 사람의 승인을 별도로 받습니다." },
  { action: "escalate", title: "담당자에게 확인 요청", description: "해결하기 어려운 문장과 중단 이유를 남깁니다.", detail: "자료가 부족하거나 수정·시간·비용 상한에 도달하면 추가 확인이 필요한 상태로 종료합니다." },
];
const statusLabels: Record<Run["status"], string> = {
  queued: "제작 대기", running: "작업 진행 중", needs_review: "담당자 확인 필요",
  ready_for_approval: "AI 검수 통과 · 승인 대기", approved: "담당자 승인 완료",
  failed: "작업 실패 · 기록 확인", cancelled: "작업 취소",
};
const eventLabels: Record<Run["events"][number]["action"], string> = {
  ...Object.fromEntries(skills.map(skill => [skill.action, skill.title])),
  started: "실행 시작", cancelled: "실행 취소", approved: "담당자 승인", edited: "문구·사진 변경", error: "오류 확인",
} as Record<Run["events"][number]["action"], string>;

export default function AgentCenter({ run, duration, loading, failed, onStudio, onExplore, onHelp, onReview, onHistory }: {
  run: Run | null; duration: number; loading: boolean; failed: boolean;
  onStudio: () => void; onExplore: () => void; onHelp: () => void;
  onReview: (cardId?: string) => void; onHistory: () => void;
}) {
  const issues = run?.issues.filter(issue => !issue.resolved) || [];
  const latest = run?.events.at(-1);
  const currentApproval = run?.status === "approved" && run.approval?.version === run.version;
  return <div className="agent-center">
    <header className="agent-intro">
      <div><p className="agent-eyebrow">성남 타임스토리 · AI 에이전트</p>
        <h1>이야기의 시작부터,<br />근거를 확인하는 순간까지.</h1>
        <p className="agent-lead">공식 자료를 찾고, 독자에 맞게 쓰고, 문장을 검수합니다.<br className="agent-desktop-break" /> 마지막 확인은 여러분과 함께합니다.</p>
        <div className="agent-intro-actions"><button type="button" className="primary-button" onClick={run ? onStudio : onExplore}>{run ? "현재 작업 이어가기" : "소개할 장소 고르기"}<span aria-hidden="true">↗</span></button><button type="button" className="agent-text-button" onClick={onHelp}>타미와 사용법 살펴보기 <span aria-hidden="true">＋</span></button></div>
      </div>
      <aside className="agent-role-note"><span className="agent-role-symbol" aria-hidden="true">✳</span><h2>만드는 에이전트,<br />길을 안내하는 타미.</h2><p>제작 에이전트는 자료와 콘텐츠를 다룹니다. 타미는 지금 필요한 기능과 확인할 위치를 안내합니다.</p><span>사실은 근거로 · 상상은 상상으로</span></aside>
    </header>

    <section className="agent-current" aria-label="에이전트 현재 작업">
      <div className="agent-section-heading"><div><p className="agent-eyebrow">현재 작업</p><h2>{run ? `${run.brief.place}의 이야기` : loading ? "작업을 불러오고 있어요" : "첫 이야기를 시작해 보세요"}</h2></div>{run && <span className={`status-chip ${run.status}`}>{statusLabels[run.status]}</span>}</div>
      {run ? <>
        <p className="agent-run-caption">{run.brief.audience}을 위한 카드뉴스 · 콘텐츠 v{run.version} · {run.mode === "fixture" ? "저장된 응답 데모" : "실제 AI"} · {run.strategy === "baseline" ? "고정 순서 실행" : "에이전트 실행"}</p>
        {run.mode === "fixture" && <p className="agent-mode-note">데모는 준비된 응답으로 제작 과정을 보여 줍니다. 실제 모델의 판단이나 자유 입력 이해를 뜻하지 않습니다.</p>}
        <dl className="agent-metrics"><div><dt>확보한 자료</dt><dd>{run.sources.filter(source => source.status === "ok").length}<small>개</small></dd></div><div><dt>확인할 항목</dt><dd>{issues.length}<small>건</small></dd></div><div><dt>실제 모델 API 시도</dt><dd>{run.execution?.apiCalls ?? "—"}<small>{run.execution?.apiCalls === undefined ? "미기록" : "회"}</small></dd></div><div><dt>{run.usage.costKind === "fixture" ? "API 비용" : "누적 추정 비용"}</dt><dd className="agent-cost">{run.usage.costKind === "fixture" ? "없음" : `$${run.usage.costUsd.toFixed(4)}`}</dd></div></dl>
        <div className="agent-latest" role="status"><span className={run.status === "running" ? "activity-dot pulsing" : "activity-dot"} /><div><strong>{latest?.message || "아직 실행 이벤트가 없습니다."}</strong>{latest?.decision?.reasonSummary && <p>{latest.decision.reasonSummary}</p>}</div><button type="button" className="agent-text-button" onClick={onStudio}>작업실 보기 ↗</button></div>
        <div className="agent-review-state"><span>현재 버전 검수 <strong>{run.reviewVersion === run.version ? "완료" : "필요"}</strong></span><span>담당자 승인 <strong>{currentApproval ? "완료" : "대기"}</strong></span><button type="button" className="agent-text-button" onClick={() => onReview()}>문장과 근거 확인 →</button></div>
        {run.stopReason && <p className="agent-stop">{run.stopReason}</p>}
        {issues.length > 0 && <div className="agent-issues"><h3>담당자가 확인할 내용</h3>{issues.map(issue => {
          const cardId = run.cards.find(card => card.id === issue.targetId)?.id || run.claims.find(claim => claim.id === issue.targetId)?.cardId;
          return <article key={issue.id}><div><strong>{issue.message}</strong><p>{issue.recommendation}</p></div><button type="button" className="agent-text-button" onClick={() => onReview(cardId)}>확인하기 →</button></article>;
        })}</div>}
      </> : <div className="agent-empty"><p>{loading ? "선택한 작업의 실제 실행 기록을 확인하고 있습니다." : failed ? "작업을 불러오지 못했습니다. 위의 재시도 버튼으로 다시 확인해 주세요." : "장소를 고르고 카드를 만들면, 사용한 자료와 실행 과정을 이곳에서 확인할 수 있어요."}</p><div><button type="button" className="secondary-button" onClick={onExplore}>성남 장소 둘러보기</button><button type="button" className="agent-text-button" onClick={onHistory}>제작 기록에서 불러오기 →</button></div></div>}
    </section>

    <section className="agent-skills" aria-label="에이전트 작업 기능"><div className="agent-section-heading"><div><p className="agent-eyebrow">사용하는 스킬</p><h2>여섯 가지 기능이 이야기를 만듭니다.</h2></div><p>스킬은 에이전트가 작업에 쓰는 기능입니다.</p></div>
      <div className="agent-skill-grid">{skills.map((skill, index) => <details className="agent-skill" key={skill.action}><summary><span className="agent-skill-index">{String(index + 1).padStart(2, "0")}</span><h3>{skill.title}</h3><p>{skill.description}</p><span className="agent-skill-more">기능 자세히 보기 <span aria-hidden="true">＋</span></span></summary><div className="agent-skill-detail"><p>{skill.detail}</p><code>{skill.action}</code></div></details>)}</div>
    </section>

    {run && <section className="agent-log" aria-label="에이전트 실행 기록"><div className="agent-section-heading"><div><p className="agent-eyebrow">작업의 발자취</p><h2>어떤 일을 했는지 확인하세요.</h2></div><p>기록된 행동과 결과를 시간순으로 보여 줍니다.</p></div>
      <ol className="agent-event-list">{run.events.map(event => <li key={event.id}><div className="agent-event-time"><time dateTime={event.at}>{new Date(event.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><span>v{event.version}</span></div><details><summary><span>{eventLabels[event.action]}</span><strong>{event.message}</strong></summary><div className="agent-event-detail">{event.decision ? <><p>{event.decision.reasonSummary}</p>{event.decision.uncertainty && <p>확인할 점: {event.decision.uncertainty}</p>}{event.decision.blockedReason && <p>진행하지 않은 이유: {event.decision.blockedReason}</p>}<EvidenceLinks run={run} ids={event.decision.evidenceIds} /></> : <p>이 이벤트에는 추가 행동 이유가 기록되지 않았습니다.</p>}</div></details></li>)}</ol>
      {!run.events.length && <p className="field-note">기록된 이벤트가 없습니다.</p>}
      <RunTrace run={run} duration={duration} />
    </section>}
  </div>;
}
