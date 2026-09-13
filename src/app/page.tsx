"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Brief, Card, Mode, Run, Scenario, Strategy } from "@/lib/types";
import { AtomicReview, EvidenceLinks, ProtectedChanges, RunTrace, safeSourceUrl } from "@/components/review-trace";

import { PLACES, getPlace, type Place } from "@/lib/places";
import PlaceExplorer, { PlacePhoto } from "@/components/place-explorer";
import ImageEditor, { CardPhoto } from "@/components/image-editor";
import PlatformHome, { RunHistory } from "@/components/platform-home";

type Config = {
  image?: { configured: boolean; reason?: string; model?: string };
  live: { configured: boolean; reason?: string; model?: string };
};
const example: Brief = {
  place: "판교박물관",
  placeId: "pangyo-museum",
  audience: "청소년",
  goal: "청소년에게 판교박물관을 소개할 카드뉴스 4장을 만들어줘. 마지막 장에는 성남의 미래 문화공간을 상상하는 내용을 넣어줘.",
  cardCount: 4,
  includeFuture: true,
};
const statuses: Record<Run["status"], string> = {
  queued: "제작 대기",
  running: "제작 중",
  needs_review: "담당자 검토 필요",
  ready_for_approval: "검수 통과 · 승인 대기",
  approved: "담당자 승인 완료",
  failed: "제작 실패",
  cancelled: "제작 취소",
};
const scenarios: Record<Scenario, string> = {
  normal: "정상 설명",
  causal: "근거 없는 역사적 연결",
  future: "미래 상상을 확정 사업으로 표현",
  mismatch: "주장과 출처 불일치",
  unavailable: "공식 자료 접근 실패",
  persistent: "수정 후에도 남는 오류",
};
const kinds = { fact: "사실", analogy: "비유", imagination: "상상" };
const supportLabels = {
  supported: "근거 확인",
  insufficient: "근거 부족",
  contradicted: "근거와 불일치",
  not_applicable: "사실 주장 아님",
};
const sampleCards = [
  {
    title: "판교, 시간을 열다",
    body: "우리 동네의 이야기는 어디에서 시작됐을까?",
    tag: "이야기의 시작",
    shape: "arch",
  },
  {
    title: "기록에서 찾은 이야기",
    body: "박물관의 공식 자료에서 이야기의 실마리를 찾아요.",
    tag: "자료로 살펴보기",
    shape: "stones",
  },
  {
    title: "오늘의 우리와 만나다",
    body: "과거와 현재를 비교하며 나만의 질문을 만들어요.",
    tag: "생각 이어보기",
    shape: "window",
  },
  {
    title: "내일의 문화공간",
    body: "만약 우리가 미래의 박물관을 만든다면?",
    tag: "상상 장면",
    shape: "orbit",
  },
];

async function readJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error || "요청을 처리하지 못했습니다. 다시 시도해 주세요.",
    );
  return data as T;
}

function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? "small" : ""}`} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export default function Studio() {
  const [view, setView] = useState<"dashboard" | "explore" | "studio" | "history">("dashboard");
  const [recordsLoaded, setRecordsLoaded] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [imageChoice, setImageChoice] = useState<"photo" | "ai">("photo");
  const [brief, setBrief] = useState<Brief>(example);
  const [mode, setMode] = useState<Mode>("fixture");
  const [strategy, setStrategy] = useState<Strategy>("agent");
  const [scenario, setScenario] = useState<Scenario>("causal");
  const [config, setConfig] = useState<Config | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [history, setHistory] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedCardId, setSelectedCardId] = useState("");
  const [selectedClaimId, setSelectedClaimId] = useState("");
  const [tab, setTab] = useState<"evidence" | "changes" | "edit" | "image">("evidence");
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const [historyLoading, setHistoryLoading] = useState(false);
  const textActive = run?.status === "queued" || run?.status === "running";
  const active = textActive || run?.imageJob?.status === "running";
  const draftPlace = getPlace(brief.placeId || brief.place) || PLACES[0];
  const liveUnavailable = mode === "live" && !config?.live.configured;
  const card =
    run?.cards.find((item) => item.id === selectedCardId) || run?.cards[0];
  const cardClaims =
    run?.claims.filter((claim) => claim.cardId === card?.id) || [];
  const claim =
    cardClaims.find((item) => item.id === selectedClaimId) || cardClaims[0];
  const unresolved = run?.issues.filter((issue) => !issue.resolved) || [];
  const zip = run?.artifacts.find(
    (artifact) =>
      artifact.kind === "zip" &&
      artifact.version === run.version &&
      artifact.reviewVersion === run.reviewVersion,
  );
  const duration = run
    ? Math.max(
        0,
        Math.round(
          Math.max(
            run.usage.elapsedMs || 0,
            textActive && run.startedAt
              ? (run.attemptBaseElapsedMs || 0) +
                  clock -
                  new Date(run.startedAt).getTime()
              : 0,
          ) / 1000,
        ),
      )
    : 0;

  const refreshInitial = useCallback(async () => {
    setInitialLoading(true);
    setLoadError("");
    const [settings, previous] = await Promise.allSettled([
      readJson<Config>("/api/config"),
      readJson<Run[]>("/api/runs"),
    ]);
    const failures: string[] = [];
    if (settings.status === "fulfilled") setConfig(settings.value);
    else failures.push("AI 연결 설정을 불러오지 못했습니다.");
    if (previous.status === "fulfilled") {
      setHistory(previous.value);
      setRecordsLoaded(true);
    } else failures.push("제작 기록을 불러오지 못했습니다.");
    setLoadError(failures.join(" "));
    setInitialLoading(false);
  }, []);

  useEffect(() => {
    let mounted = true;
    void Promise.resolve().then(() => { if (mounted) void refreshInitial(); });
    return () => { mounted = false; };
  }, [refreshInitial]);

  useEffect(() => {
    if (!active || !run?.id) return;
    let mounted = true;
    let pending = false;
    const id = run.id;
    const timer = setInterval(() => {
      setClock(Date.now());
      if (pending) return;
      pending = true;
      readJson<Run>(`/api/runs/${id}`)
        .then((next) => {
          if (!mounted) return;
          setRun(next);
          setHistory((previous) => [
            next,
            ...previous.filter((item) => item.id !== next.id),
          ]);
        })
        .catch((cause: Error) => {
          if (mounted)
            setError(`진행 상태를 불러오지 못했습니다: ${cause.message}`);
        })
        .finally(() => {
          pending = false;
        });
    }, 1000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [active, run?.id]);

  function chooseCard(next: Card) {
    setSelectedCardId(next.id);
    setSelectedClaimId("");
    setEditTitle(next.title);
    setEditBody(next.body);
  }

  async function start() {
    if (liveUnavailable) {
      setError("실제 AI 연결 설정이 필요합니다. 연결 설정 안내를 확인하거나 데모 모드를 선택해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = await readJson<Run>("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          brief,
          mode,
          strategy,
          scenario,
          requestId: crypto.randomUUID(),
        }),
      });
      setRun(next);
      setView("studio");
      setSelectedCardId("");
      setSelectedClaimId("");
      setTab(imageChoice === "ai" ? "image" : "evidence");
      setReviewer("");
      setClock(Date.now());
      setHistory((previous) => [
        next,
        ...previous.filter((item) => item.id !== next.id),
      ]);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "제작을 시작하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function mutate(
    action: "cancel" | "approve" | "edit" | "retry",
    body: object,
  ) {
    if (!run) return;
    setBusy(true);
    setError("");
    try {
      const next = await readJson<Run>(`/api/runs/${run.id}/${action}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setRun(next);
      setHistory((previous) => [
        next,
        ...previous.filter((item) => item.id !== next.id),
      ]);
      if (action === "edit") setTab("evidence");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "변경을 저장하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadRun(id: string) {
    if (!id) return;
    setHistoryLoading(true);
    setError("");
    try {
      const next = await readJson<Run>(`/api/runs/${id}`);
      setRun(next);
      setView("studio");
      setSelectedCardId("");
      setSelectedClaimId("");
      setTab("evidence");
      setReviewer("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "이전 작업을 열지 못했습니다.",
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  function choosePlace(place: Place) {
    if (active) { setError("진행 중인 제작이 끝나면 새 장소로 시작할 수 있습니다."); setView("studio"); return; }
    setBrief((previous) => ({ ...previous, place: place.name, placeId: place.id, goal: previous.goal.replaceAll(previous.place, place.name) }));
    setRun(null); setSelectedCardId(""); setSelectedClaimId(""); setView("studio"); setTab("evidence");
  }
  function receiveRun(next: Run) { setRun(next); setHistory((previous) => [next, ...previous.filter((item) => item.id !== next.id)]); }
  const menu = [{ id: "dashboard", label: "대시보드", icon: "◫" }, { id: "explore", label: "성남 관광지 탐색", icon: "◎" }, { id: "studio", label: "카드뉴스 제작", icon: "▧" }, { id: "history", label: "제작 기록", icon: "◷" }] as const;

  function fileUrl(name: string) {
    return `/api/runs/${run?.id}/files/${encodeURIComponent(name)}`;
  }

  return (
    <div className="platform-shell">
      <aside className="platform-sidebar"><Link href="/" className="brand" onClick={(event) => { event.preventDefault(); setView("dashboard"); }}><Mark /><span>성남 타임스토리<small>도시를 발견하는 새로운 방법</small></span></Link><span className="sidebar-caption">나의 콘텐츠 공간</span><nav aria-label="주 메뉴">{menu.map((item) => <button type="button" key={item.id} className={view === item.id ? "selected" : ""} aria-current={view === item.id ? "page" : undefined} onClick={() => setView(item.id)}><span aria-hidden="true">{item.icon}</span>{item.label}{item.id === "history" && recordsLoaded && <small>{history.length}</small>}</button>)}</nav><div className="sidebar-foot"><Mark small /><strong>도시의 이야기를 함께.</strong><p>공식 자료로 사실을 확인하고<br />상상으로 내일을 연결합니다.</p></div></aside>
      <div className="platform-main">
      <header className="topbar">
        <div className="topbar-location"><span>성남 타임스토리</span><span aria-hidden="true">/</span><strong>{menu.find((item) => item.id === view)?.label}</strong></div>
        <div className="header-right">
          <span className="workspace-label">콘텐츠 작업실</span>
          <label className="history-select">
            <span className="sr-only">이전 작업 열기</span>
            <select
              aria-label="이전 작업 열기"
              value={run?.id || ""}
              disabled={active || busy || historyLoading}
              onChange={(event) => void loadRun(event.target.value)}
            >
              <option value="">이전 작업</option>
              {history.map((item) => (
                <option key={item.id} value={item.id}>
                  {new Date(item.createdAt).toLocaleDateString("ko-KR")}{" "}
                  {item.brief.place} · {statuses[item.status]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      <main className="workspace">
        {loadError && <div className="error-banner initial-load-error" role="alert"><span>{loadError} 입력한 내용은 유지됩니다.</span><button type="button" className="text-button" disabled={initialLoading} onClick={() => void refreshInitial()}>설정과 기록 다시 불러오기</button></div>}
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError("")}
              aria-label="오류 메시지 닫기"
            >
              ×
            </button>
          </div>
        )}

        {view === "dashboard" && <PlatformHome runs={history} loaded={recordsLoaded} failed={!recordsLoaded && Boolean(loadError)} busy={active || busy} onExplore={() => setView("explore")} onCreate={choosePlace} onOpen={(id) => void loadRun(id)} />}
        <PlaceExplorer visible={view === "explore"} onCreate={choosePlace} />
        {view === "history" && <RunHistory runs={history} loaded={recordsLoaded} failed={!recordsLoaded && Boolean(loadError)} busy={active || busy} onOpen={(id) => void loadRun(id)} full />}
        <div hidden={view !== "studio"}>
        <section className="intro">
          <div>
            <h1>
              도시의 이야기를,
              <br className="mobile-break" /> 근거 있는 콘텐츠로.
            </h1>
            <p>자료를 찾고, 이야기를 다듬고, 사실과 상상을 구분해 완성해요.</p>
          </div>
          <div className="intro-art" aria-hidden="true">
            <span>과거</span>
            <i />
            <span>오늘</span>
            <i />
            <span>상상</span>
            <Mark small />
          </div>
        </section>
        <div className="studio-layout">
          <aside className="brief-panel">
            <div className="panel-heading">
              <h2>제작 요청</h2>
              <button
                className="text-button"
                type="button"
                disabled={active || busy}
                onClick={() => setBrief({ ...example, place: draftPlace.name, placeId: draftPlace.id, goal: example.goal.replaceAll(example.place, draftPlace.name) })}
              >
                예시 불러오기
              </button>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void start();
              }}
            >
              <fieldset disabled={active || busy} className="brief-fields">
                <label>
                  소개할 장소
                  <input
                    value={brief.place}
                    readOnly
                    aria-describedby="place-note"
                  />
                </label>
                <p id="place-note" className="field-note">{draftPlace.district} · {draftPlace.type} <button type="button" className="text-button" onClick={() => setView("explore")}>장소 변경</button></p>
                <label>
                  누구에게 전할까요?
                  <select
                    value={brief.audience}
                    onChange={(event) =>
                      setBrief({ ...brief, audience: event.target.value })
                    }
                  >
                    <option>청소년</option>
                    <option>가족 관람객</option>
                    <option>성남 시민</option>
                  </select>
                </label>
                <label>
                  어떤 이야기를 만들까요?
                  <textarea
                    rows={6}
                    value={brief.goal}
                    minLength={10}
                    maxLength={1000}
                    required
                    onChange={(event) =>
                      setBrief({ ...brief, goal: event.target.value })
                    }
                  />
                </label>
                <div className="format-line">
                  <span>카드뉴스</span>
                  <strong>4장</strong>
                  <span>1080 × 1080</span>
                </div>
                <p className="future-note">
                  <span aria-hidden="true">✳</span> 마지막 장은 미래 문화공간을
                  상상해요.
                </p>
                <label>카드 이미지<select value={imageChoice} onChange={(event) => setImageChoice(event.target.value as "photo" | "ai")}><option value="photo">장소의 실제 사진으로 시작</option><option value="ai">제작 후 AI 이미지로 바꾸기</option></select></label>
                <p className="field-note">{imageChoice === "ai" ? "먼저 카드 문구를 완성한 뒤 사진 편집에서 원하는 장면을 생성합니다." : "확인된 장소 사진을 사용하고, 장별로 구도를 조정할 수 있어요."}</p>
                <div className="mode-field">
                  <span className="form-label">실행 모드</span>
                  <div className="segmented" role="group" aria-label="실행 모드 선택">
                    <button
                      type="button"
                      className={mode === "fixture" ? "selected" : ""}
                      aria-pressed={mode === "fixture"}
                      onClick={() => setMode("fixture")}
                    >
                      데모
                    </button>
                    <button
                      type="button"
                      className={mode === "live" ? "selected" : ""}
                      aria-pressed={mode === "live"}
                      onClick={() => setMode("live")}
                    >
                      실제 AI
                    </button>
                  </div>
                  <p className="field-note" aria-live="polite">
                    {mode === "fixture"
                      ? "선택한 장소의 확인된 자료와 준비된 응답으로 체험합니다. 자유로운 목표 반영은 실제 AI 모드에서 가능합니다."
                      : liveUnavailable
                        ? "실제 AI 모드가 선택되었습니다. 아래 연결 설정을 완료하면 제작할 수 있습니다."
                        : `실제 공식 자료와 AI를 사용합니다.${config?.live.model ? ` 모델: ${config.live.model}` : ""}`}
                  </p>
                  {!config?.live.configured && (
                    <>
                      <p className="config-note" id="live-config-note">
                        실제 AI는 연결 설정이 필요합니다. 데모는 바로 사용할 수 있습니다.
                      </p>
                      <details className="script-detail" open={mode === "live"}>
                        <summary>연결 설정 안내</summary>
                        <p className="field-note">
                          프로젝트의 .env.local에 Anthropic API 키, 모델, 토큰 단가와
                          실행 비용 상한을 설정한 뒤 서버를 다시 시작해 주세요.
                          필요한 항목은 .env.example과 README에 있습니다.
                        </p>
                        {config?.live.reason && <p className="field-note">{config.live.reason}</p>}
                      </details>
                    </>
                  )}
                </div>
                <details className="advanced">
                  <summary>시연·비교 설정</summary>
                  <label>
                    제작 방식
                    <select
                      value={strategy}
                      onChange={(event) =>
                        setStrategy(event.target.value as Strategy)
                      }
                    >
                      <option value="agent">
                        에이전트 · 검수 결과에 따라 행동
                      </option>
                      <option value="baseline">고정 순서 · 수정 1회</option>
                    </select>
                  </label>
                  <label>
                    테스트 상황
                    <select
                      value={scenario}
                      onChange={(event) =>
                        setScenario(event.target.value as Scenario)
                      }
                    >
                      {Object.entries(scenarios).map(([key, value]) => (
                        <option key={key} value={key}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="field-note">
                    오류 상황은 복구 과정을 확인하기 위한 의도적인 테스트입니다.
                  </p>
                </details>
                <button className="primary-button create-button" type="submit" disabled={liveUnavailable} aria-describedby={liveUnavailable ? "live-config-note" : undefined}>
                  {active
                    ? "이야기를 제작하고 있어요"
                    : busy
                      ? "처리 중…"
                      : liveUnavailable
                        ? "AI 연결 설정 필요"
                        : "카드뉴스 제작하기"}
                  <span aria-hidden="true">＋</span>
                </button>
              </fieldset>
            </form>
            <div className="brief-foot">
              <span className="tiny-mark" aria-hidden="true">
                ✓
              </span>
              <p>
                공개 전에는 담당자가
                <br />
                근거와 최종 결과를 확인합니다.
              </p>
            </div>
          </aside>
          <section className="production-panel" aria-label="카드뉴스 제작 결과">
            <div className="production-heading">
              <div>
                <h2>
                  {run
                    ? `${run.brief.place} 이야기`
                    : "이렇게 이야기가 만들어져요"}
                </h2>
                <p>
                  {run
                    ? `${run.brief.audience}을 위한 카드뉴스 · ${run.mode === "fixture" ? "저장된 응답 데모" : "실제 AI"} · ${run.strategy === "agent" ? "에이전트" : "고정 순서"}`
                    : "제작을 시작하면 실제 결과물과 근거를 확인할 수 있어요."}
                </p>
              </div>
              <span
                className={`status-chip ${run?.status || "example"}`}
                role="status"
              >
                {run ? statuses[run.status] : "구성 예시"}
              </span>
            </div>
            {run && (
              <div className="run-progress" aria-live="polite">
                <div className="progress-current">
                  <span
                    className={active ? "activity-dot pulsing" : "activity-dot"}
                  />
                  <strong>
                    {run.events.at(-1)?.message || "작업을 준비하고 있습니다."}
                  </strong>
                  {textActive && (
                    <button
                      type="button"
                      className="text-button danger"
                      disabled={busy}
                      onClick={() => void mutate("cancel", {})}
                    >
                      제작 취소
                    </button>
                  )}
                </div>
                <div className="run-metrics">
                  <span>
                    자료{" "}
                    <b>
                      {
                        run.sources.filter((source) => source.status === "ok")
                          .length
                      }
                    </b>
                    개
                  </span>
                  <span>
                    해결{" "}
                    <b>{run.issues.filter((issue) => issue.resolved).length}</b>
                    건
                  </span>
                  <span>
                    경과 <b>{duration}</b>/{Math.round(run.limits.maxDurationMs / 1000)}초
                  </span>
                  <span>
                    도구 <b>{run.usage.toolCalls}</b>/{run.limits.maxToolCalls}
                    회
                  </span>
                  <span>실제 모델 API 시도 <b>{run.execution?.apiCalls ?? "미기록"}</b>{run.execution?.apiCalls !== undefined ? "회" : ""}</span>
                  <span>
                    {run.usage.costKind === "fixture"
                      ? "모의 실행 · API 비용 없음"
                      : `추정 비용 $${run.usage.costUsd.toFixed(4)} / 상한 $${run.limits.maxCostUsd.toFixed(4)}`}
                  </span>
                </div>
                {run.mode === "fixture" && run.scenario !== "normal" && (
                  <p className="scenario-notice">
                    오류 복구 시연: {scenarios[run.scenario]} · 의도적으로
                    설정한 테스트 상황입니다.
                  </p>
                )}
                {run.stopReason && (
                  <p className="stop-reason">{run.stopReason}</p>
                )}
              </div>
            )}
            <div className="card-grid">
              {run?.cards.length
                ? run.cards.map((item, index) => {
                    const artifact = run.artifacts.filter(
                      (entry) =>
                        entry.kind === "png" && entry.version === run.version,
                    )[index];
                    return (
                      <button
                        className={`story-card card-tone-${index} ${card?.id === item.id ? "is-selected" : ""}`}
                        type="button"
                        key={item.id}
                        onClick={() => chooseCard(item)}
                        aria-pressed={card?.id === item.id}
                        aria-label={`${index + 1}장 ${item.title} 근거 보기`}
                      >
                        {artifact ? (
                          <Image
                            unoptimized
                            src={fileUrl(artifact.name)}
                            alt={`${index + 1}장: ${item.title}. ${item.body}`}
                            width={1080}
                            height={1080}
                          />
                        ) : (
                          <div className="card-design photo-card-design">
                            <div className="card-topline">
                              <span>
                                {item.imagination
                                  ? "상상 장면"
                                  : "성남 타임스토리"}
                              </span>
                              <span>{String(index + 1).padStart(2, "0")}</span>
                            </div>
                            <h3>{item.title}</h3>
                            <CardPhoto key={item.image?.src} card={item} />
                            <p>{item.body}</p>
                            <div className="card-bottomline">
                              <span>{run.brief.place}</span>
                              <span>제작 초안</span>
                            </div>
                          </div>
                        )}
                        <span className="card-select-label">
                          {index + 1}장{" "}
                          <span>
                            {card?.id === item.id ? "선택됨" : "근거 확인"}
                          </span>
                        </span>
                      </button>
                    );
                  })
                : sampleCards.map((sample, index) => (
                    <div
                      className={`story-card card-tone-${index} example-card`}
                      key={sample.title}
                    >
                      <div className="card-design photo-card-design">
                        <div className="card-topline">
                          <span>{sample.tag}</span>
                          <span>{String(index + 1).padStart(2, "0")}</span>
                        </div>
                        <h3>{index === 0 ? `${draftPlace.name}, 이야기를 열다` : sample.title}</h3>
                        <PlacePhoto place={draftPlace} />
                        <p>{sample.body}</p>
                        <div className="card-bottomline">
                          <span>성남 타임스토리</span>
                          <span>디자인 예시</span>
                        </div>
                      </div>
                    </div>
                  ))}
            </div>
            {!run && (
              <div className="example-notice">
                <span aria-hidden="true">ⓘ</span> 위 카드는 구성 예시이며, 아직
                조사·검수된 결과물이 아닙니다. 사진은 실제 장소를 보여줍니다.
              </div>
            )}
            {run && (
              <details className="event-log">
                <summary>
                  제작 기록 <span>{run.events.length}개 이벤트</span>
                </summary>
                <ol>
                  {run.events.map((event) => (
                    <li key={event.id}>
                      <time>
                        {new Date(event.at).toLocaleTimeString("ko-KR", {
                          hour12: false,
                        })}
                      </time>
                      <div>
                        <strong>{event.message}</strong>
                        {event.decision?.reasonSummary && (
                          <p>{event.decision.reasonSummary}</p>
                        )}
                        {event.decision?.uncertainty && (
                          <small>확인 필요: {event.decision.uncertainty}</small>
                        )}
                      </div>
                      <span className="version-label">v{event.version}</span>
                    </li>
                  ))}
                </ol>
              </details>
            )}
            {run && <RunTrace run={run} duration={duration} />}
          </section>
          <aside className="review-panel" aria-label="근거와 담당자 검토">
            <div className="panel-heading">
              <h2>근거와 검토</h2>
              {run && <span className="version-label">v{run.version}</span>}
            </div>
            <div className="review-tabs" role="tablist" aria-label="검토 항목">
              {(
                [
                  { key: "evidence", label: "문장 근거" },
                  { key: "changes", label: "수정 내역" },
                  { key: "edit", label: "직접 수정" },
                  { key: "image", label: "사진 편집" },
                ] as const
              ).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  id={`tab-${item.key}`}
                  aria-controls="review-tabpanel"
                  aria-selected={tab === item.key}
                  onClick={() => {
                    setTab(item.key);
                    if (item.key === "edit" && card) {
                      setEditTitle(card.title);
                      setEditBody(card.body);
                    }
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div
              className="review-content"
              id="review-tabpanel"
              role="tabpanel"
              aria-labelledby={`tab-${tab}`}
            >
              {!run?.cards.length ? (
                <div className="review-empty">
                  <div className="document-icon" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <span>✓</span>
                  </div>
                  <h3>이야기에는 근거가 필요해요.</h3>
                  <p>
                    카드가 만들어지면 문장마다
                    <br />
                    공식 자료와 수정 이유를 확인해요.
                  </p>
                  <div className="legend">
                    <span className="kind fact">사실</span>
                    <span className="kind analogy">비유</span>
                    <span className="kind imagination">상상</span>
                  </div>
                  <p className="empty-footnote">
                    사실은 출처로 확인하고,
                    <br />
                    비유와 상상은 분명하게 표시합니다.
                  </p>
                </div>
              ) : (
                <>
                  <p className="selected-card-caption">
                    {run.cards.findIndex((item) => item.id === card?.id) + 1}장
                    · {card?.title}
                  </p>
                  {card && run.protectedCardIds?.includes(card.id) && <p className="protected-card-label">담당자 문구 보호 중 · 자동 덮어쓰기 없음</p>}
                  {card && (run.proposedChanges || []).some((proposal) => proposal.cardId === card.id) && tab !== "changes" && <button className="text-button proposal-link" type="button" onClick={() => setTab("changes")}>적용 전 수정 제안 확인</button>}
                  {tab === "evidence" && (
                    <>
                      <div className="claim-list">
                        {cardClaims.map((item) => (
                          <button
                            className={`claim-button ${claim?.id === item.id ? "selected" : ""}`}
                            type="button"
                            key={item.id}
                            onClick={() => setSelectedClaimId(item.id)}
                          >
                            <span className={`kind ${item.kind}`}>
                              {kinds[item.kind]}
                            </span>
                            <span>{item.text}</span>
                          </button>
                        ))}
                      </div>
                      {claim && (
                        <div className="evidence-detail">
                          <h3>{supportLabels[claim.support]}</h3>
                          {claim.evidenceIds.length === 0 ? (
                            <p className="field-note">
                              {claim.kind === "fact"
                                ? "연결된 근거가 없습니다. 추가 확인이 필요합니다."
                                : "비유·상상 표현입니다. 포함된 실제 사실은 별도로 확인해야 합니다."}
                            </p>
                          ) : (
                            claim.evidenceIds.map((id) => {
                              const evidence = run.evidence.find(
                                (item) => item.id === id,
                              );
                              const source = run.sources.find(
                                (item) => item.id === evidence?.sourceId,
                              );
                              return evidence ? (
                                <article className="source-item" key={id}>
                                  <blockquote>{evidence.quote}</blockquote>
                                  <p>{evidence.locator}</p>
                                  {source && (
                                    <>
                                      <a
                                        href={safeSourceUrl(source.url)}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        {source.title}{" "}
                                        <span aria-hidden="true">↗</span>
                                      </a>
                                      <small>
                                        {source.publisher} ·{" "}
                                        {source.status === "ok"
                                          ? "원문 확인"
                                          : "접근 실패"}
                                        <br />
                                        조회{" "}
                                        {new Date(
                                          source.retrievedAt,
                                        ).toLocaleString("ko-KR")}
                                      </small>
                                      <details className="trace-snapshot"><summary>검수 당시 원문 스냅샷</summary><p>자료 ID: {source.id}</p><p>스냅샷 해시: {source.hash || "미기록"}</p><pre>{source.snapshot || "저장된 원문이 없습니다."}</pre></details>
                                    </>
                                  )}
                                </article>
                              ) : (
                                <p key={id} className="field-note">
                                  근거 {id}를 확인할 수 없습니다.
                                </p>
                              );
                            })
                          )}
                        </div>
                      )}
                      {!cardClaims.length && (
                        <p className="field-note">
                          문장별 근거를 준비하고 있습니다.
                        </p>
                      )}
                      {card && <AtomicReview run={run} cardId={card.id} />}
                      {card?.script && (
                        <details className="script-detail">
                          <summary>이 장의 대본</summary>
                          <p>{card.script}</p>
                        </details>
                      )}
                    </>
                  )}
                  {tab === "changes" && (
                    <div className="revision-list">
                      {card && <ProtectedChanges run={run} cardId={card.id} disabled={active || busy} onLoad={(proposal) => { setEditTitle(proposal.title); setEditBody(proposal.body); setTab("edit"); }} />}
                      {run.revisions.length < 2 ? (
                        <p className="field-note">
                          아직 수정 전후 내역이 없습니다.
                        </p>
                      ) : (
                        run.revisions.slice(1).map((revision, index) => {
                          const previous = run.revisions[index].cards.find(
                            (item) => item.id === card?.id,
                          );
                          const next = revision.cards.find(
                            (item) => item.id === card?.id,
                          );
                          return (
                            <article
                              className="revision-item"
                              key={revision.version}
                            >
                              <h3>
                                v{revision.version} · {revision.reason}
                              </h3>
                              {revision.origin && <p className="field-note">{revision.origin === "human" ? "담당자가 직접 수정" : "모델이 수정"}</p>}
                              {!!revision.evidenceIds?.length && <EvidenceLinks run={run} ids={revision.evidenceIds} />}
                              {previous && (
                                <div className="before">
                                  <span>수정 전</span>
                                  <p>
                                    {previous.title}
                                    <br />
                                    {previous.body}
                                  </p>
                                  {previous.script !== next?.script && <details className="revision-script"><summary>수정 전 대본</summary><p>{previous.script}</p></details>}
                                </div>
                              )}
                              {next && (
                                <div className="after">
                                  <span>수정 후</span>
                                  <p>
                                    {next.title}
                                    <br />
                                    {next.body}
                                  </p>
                                  {previous?.script !== next.script && <details className="revision-script"><summary>수정 후 대본</summary><p>{next.script}</p></details>}
                                </div>
                              )}
                            </article>
                          );
                        })
                      )}
                    </div>
                  )}
                  {tab === "image" && card && <ImageEditor key={`${run.id}-${card.id}-${run.version}`} run={run} card={card} config={config?.image} locked={active || busy} onRun={receiveRun} onBusy={setBusy} />}
                  {tab === "edit" && (
                    <form
                      className="edit-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (card)
                          void mutate("edit", {
                            version: run.version,
                            cardId: card.id,
                            title: editTitle,
                            body: editBody,
                          });
                      }}
                    >
                      <p className="field-note">
                        수정하면 새 버전이 생성되고 기존 검수와 승인이
                        해제됩니다.
                      </p>
                      <label>
                        카드 제목
                        <input
                          required
                          maxLength={80}
                          value={editTitle}
                          disabled={active || busy}
                          onChange={(event) => setEditTitle(event.target.value)}
                        />
                      </label>
                      <label>
                        카드 본문
                        <textarea
                          required
                          rows={7}
                          maxLength={500}
                          value={editBody}
                          disabled={active || busy}
                          onChange={(event) => setEditBody(event.target.value)}
                        />
                      </label>
                      <button
                        className="secondary-button"
                        type="submit"
                        disabled={active || busy}
                      >
                        수정 저장
                      </button>
                    </form>
                  )}
                </>
              )}
            </div>
            {run && (
              <div className="approval-panel">
                {unresolved.length > 0 && (
                  <div className="issues">
                    <h3>확인이 필요한 항목 {unresolved.length}건</h3>
                    {unresolved.map((issue) => (
                      <article key={issue.id}>
                        <strong>{issue.message}</strong>
                        <p>{issue.recommendation}</p>
                      </article>
                    ))}
                  </div>
                )}
                {(run.status === "needs_review" || run.status === "failed") && (
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void mutate("retry", { version: run.version })
                    }
                  >
                    수정 내용 재검수
                  </button>
                )}
                {run.status === "ready_for_approval" && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void mutate("approve", {
                        version: run.version,
                        reviewer: reviewer.trim(),
                      });
                    }}
                  >
                    <h3>파일 검수가 끝났습니다.</h3>
                    <p>근거와 카드뉴스를 확인한 뒤 승인해 주세요.</p>
                    <p className="approval-version">승인 대상 v{run.version} · 검수 v{run.reviewVersion}</p>
                    <label>
                      확인 담당자
                      <input
                        required
                        maxLength={60}
                        placeholder="이름을 입력하세요"
                        value={reviewer}
                        onChange={(event) => setReviewer(event.target.value)}
                      />
                    </label>
                    <button
                      className="primary-button"
                      disabled={active || busy || !reviewer.trim()}
                      type="submit"
                    >
                      최종 결과 승인
                    </button>
                    <small>담당자 이름을 기록하는 로컬 검토 절차입니다.</small>
                  </form>
                )}
                {run.approval && (
                  <div className="approval-confirmed">
                    <strong>✓ 담당자 승인 완료</strong>
                    <p>
                      {run.approval.reviewer} · v{run.approval.version}
                      <br />
                      {new Date(run.approval.at).toLocaleString("ko-KR")}
                    </p>
                  </div>
                )}
                {zip && (
                  <a
                    className={
                      run.status === "approved"
                        ? "download-button"
                        : "secondary-button download-link"
                    }
                    href={fileUrl(zip.name)}
                    download
                  >
                    {run.status === "approved"
                      ? "카드뉴스 패키지 다운로드"
                      : "검토용 패키지 다운로드"}{" "}
                    <span aria-hidden="true">↓</span>
                  </a>
                )}
                {run.artifacts.length > 0 && (
                  <details className="files-detail">
                    <summary>개별 파일 {run.artifacts.length}개</summary>
                    {run.artifacts.map((artifact) => (
                      <a
                        key={artifact.name}
                        href={fileUrl(artifact.name)}
                        download
                      >
                        {artifact.name}
                        <span>v{artifact.version}</span>
                      </a>
                    ))}
                  </details>
                )}
              </div>
            )}
          </aside>
        </div>
        </div>
        <footer className="workspace-footer">
          <span>성남의 어제와 오늘, 우리가 상상하는 내일.</span>
          <span>성남 × KAIST AI 경진대회 · 예선 MVP</span>
        </footer>
      </main>
      </div>
    </div>
  );
}
