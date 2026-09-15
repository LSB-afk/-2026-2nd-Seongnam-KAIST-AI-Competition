"use client";

import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { getImageProps } from "next/image";
import {
  getGuideAdvice, getGuideSnapshot, getStepGuard, getStepTarget, GUIDE_STEPS, GUIDE_STEP_COUNT,
  GUIDE_STORAGE_KEY, initialGuideState, restoreGuideStorage, transitionGuide,
  type GuideContext, type GuideActions, type GuideEvent, type GuidePreferences, type GuideSnapshot,
  type GuideStorage, type TamiMood,
} from "../lib/guide";
import "./tami-guide.css";
import { anchorForPosition, clampDockPosition, hasDragged, resolveDockPosition, restoreTamiPosition, TAMI_POSITION_KEY, type Point, type Viewport } from "../lib/tami-position";

export type { GuideContext, GuideActions } from "../lib/guide";
const TAMI_SPRITE_SRC = getImageProps({ src: "/tami/tami-sprites.png", alt: "", width: 216, height: 144 }).props.src;

type UiState = GuideStorage & { hydrated: boolean; panelOpen: boolean };
type UiEvent =
  | { type: "restore"; storage: GuideStorage }
  | { type: "guide"; event: GuideEvent; snapshot: GuideSnapshot }
  | { type: "preferences"; value: Partial<GuidePreferences> }
  | { type: "panel"; open: boolean };
function reducer(state: UiState, event: UiEvent): UiState {
  if (event.type === "restore") return { ...state, ...event.storage, hydrated: true };
  if (event.type === "preferences") return { ...state, preferences: { ...state.preferences, ...event.value } };
  if (event.type === "panel") return { ...state, panelOpen: event.open, preferences: { ...state.preferences, invitationDismissed: true } };
  const tutorial = transitionGuide(state.tutorial, event.event, event.snapshot);
  return tutorial === state.tutorial ? state : { ...state, tutorial };
}
type Rect = { top: number; left: number; width: number; height: number; bottom: number; right: number };
type Geometry = { host: Element | null; target: Rect | null; found: boolean; width: number; height: number; panelWidth: number; panelHeight: number; modal: boolean; viewport: Viewport; dockWidth: number; dockHeight: number; invitationHeight: number; mapAttribution: Rect | null; protectedRects: Rect[] };
const EMPTY_GEOMETRY: Geometry = { host: null, target: null, found: false, width: 0, height: 0, panelWidth: 344, panelHeight: 350, modal: false, viewport: { left: 0, top: 0, width: 0, height: 0 }, dockWidth: 172, dockHeight: 72, invitationHeight: 180, mapAttribution: null, protectedRects: [] };

function currentViewport(): Viewport {
  const viewport = window.visualViewport;
  return { left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0, width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight };
}

function shown(element: Element) {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && !element.closest('[hidden],[inert],[aria-hidden="true"]');
}
function findTarget(name: string): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)).find(shown) ?? null;
}
function visibleRect(element: HTMLElement, width: number, height: number): Rect | null {
  const rect = element.getBoundingClientRect();
  let top = Math.max(8, rect.top), left = Math.max(8, rect.left), right = Math.min(width - 8, rect.right), bottom = Math.min(height - 8, rect.bottom);
  for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (/auto|scroll|hidden|clip/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) {
      const bounds = parent.getBoundingClientRect();
      top = Math.max(top, bounds.top); left = Math.max(left, bounds.left);
      right = Math.min(right, bounds.right); bottom = Math.min(bottom, bounds.bottom);
    }
  }
  if (bottom - top < 4 || right - left < 4) return null;
  return { top, left, right, bottom, width: right - left, height: bottom - top };
}
function panelPosition(geometry: Geometry) {
  const { width, height, panelWidth, panelHeight, target } = geometry;
  const margin = 16;
  let left = width - panelWidth - margin, top = height - panelHeight - 120;
  if (target) {
    if (width - target.right >= panelWidth + 28) { left = target.right + 12; top = target.top; }
    else if (target.left >= panelWidth + 28) { left = target.left - panelWidth - 12; top = target.top; }
    else if (height - target.bottom >= panelHeight + 28) { left = target.left; top = target.bottom + 12; }
    else if (target.top >= panelHeight + 28) { left = target.left; top = target.top - panelHeight - 12; }
  }
  return { left: Math.max(margin, Math.min(left, width - panelWidth - margin)), top: Math.max(margin, Math.min(top, height - panelHeight - margin)) };
}

function Character({ mood, animationOff, failed }: { mood: TamiMood; animationOff: boolean; failed: boolean }) {
  return <span aria-hidden="true" className={`tami-character tami-character--${mood}${animationOff ? " tami-character--still" : ""}${failed ? " tami-character--fallback" : ""}`} style={{ backgroundImage: failed ? "none" : `url("${TAMI_SPRITE_SRC}")` }} key={mood}>{failed ? "타미" : null}</span>;
}

export default function TamiGuide({ context, actions }: { context: GuideContext; actions: GuideActions }) {
  const [state, dispatch] = useReducer(reducer, {
    version: 1, tutorial: initialGuideState(),
    preferences: { minimized: false, animationOff: false, invitationDismissed: false },
    hydrated: false, panelOpen: false,
  });
  const [geometry, setGeometry] = useState<Geometry>(EMPTY_GEOMETRY);
  const [assetFailed, setAssetFailed] = useState(false);
  const [dockAnchor, setDockAnchor] = useReducer((_current: Point | null, next: Point | null) => next, null);
  const [dragging, setDragging] = useState(false);
  const [positionMessage, setPositionMessage] = useState("");
  const snapshot = useMemo(() => getGuideSnapshot(context), [context]);
  const previousSnapshot = useRef(snapshot);
  const panelRef = useRef<HTMLElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLButtonElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; start: Point; origin: Point; moved: boolean; originalAnchor: Point | null; latest: Point | null } | null>(null);
  const suppressClick = useRef(false);
  const previousFocus = useRef<HTMLElement | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const initialSnapshot = useRef(snapshot);
  const titleId = useId();
  const descriptionId = useId();
  const moveDescriptionId = useId();
  const active = state.tutorial.status === "active";
  const targetName = getStepTarget(state.tutorial, snapshot);
  const advice = getGuideAdvice(context);
  const invitation = state.hydrated && !state.preferences.invitationDismissed && !state.panelOpen && context.view === "dashboard" && !geometry.modal;
  const mood = invitation ? "greeting" : active ? snapshot.running || snapshot.busy ? "working" : "guiding" : advice.mood;
  const send = useCallback((event: GuideEvent) => dispatch({ type: "guide", event, snapshot }), [snapshot]);

  useEffect(() => {
    let raw: string | null = null;
    try { raw = localStorage.getItem(GUIDE_STORAGE_KEY); } catch { /* Browser privacy settings must not disable help. */ }
    dispatch({ type: "restore", storage: restoreGuideStorage(raw, initialSnapshot.current) });
    try { setDockAnchor(restoreTamiPosition(localStorage.getItem(TAMI_POSITION_KEY))); } catch { /* Position remains available without storage. */ }
    const sprite = new window.Image();
    sprite.onerror = () => setAssetFailed(true);
    sprite.src = TAMI_SPRITE_SRC;
    return () => { sprite.onerror = null; };
  }, []);

  useEffect(() => {
    if (!state.hydrated) return;
    try { localStorage.setItem(GUIDE_STORAGE_KEY, JSON.stringify({ version: 1, tutorial: state.tutorial, preferences: state.preferences })); } catch { /* Help remains usable without persistent storage. */ }
  }, [state.hydrated, state.tutorial, state.preferences]);

  useEffect(() => {
    const before = previousSnapshot.current;
    previousSnapshot.current = snapshot;
    if (state.hydrated) dispatch({ type: "guide", event: { type: "observe", before }, snapshot });
  }, [snapshot, state.hydrated]);

  const closePanel = useCallback(() => {
    send({ type: "pause" });
    dispatch({ type: "panel", open: false });
    queueMicrotask(() => {
      const focus = previousFocus.current;
      if (focus?.isConnected && shown(focus) && (!geometry.modal || geometry.host?.contains(focus))) focus.focus();
      else helpRef.current?.focus();
    });
  }, [send, geometry.modal, geometry.host]);

  const openPanel = useCallback(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dispatch({ type: "panel", open: true });
  }, []);

  useEffect(() => {
    let frame = 0;
    const openSettings = () => {
      openPanel();
      frame = requestAnimationFrame(() => {
        const settings = panelRef.current?.querySelector<HTMLDetailsElement>(".tami-settings");
        if (settings) { settings.open = true; settings.querySelector("summary")?.focus(); }
      });
    };
    window.addEventListener("tami:open-guide", openPanel);
    window.addEventListener("tami:open-settings", openSettings);
    return () => { window.removeEventListener("tami:open-guide", openPanel); window.removeEventListener("tami:open-settings", openSettings); cancelAnimationFrame(frame); };
  }, [openPanel]);

  useEffect(() => {
    if (state.panelOpen) panelRef.current?.focus({ preventScroll: true });
  }, [state.panelOpen]);

  useEffect(() => {
    if (!state.panelOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !rootRef.current?.contains(document.activeElement)) return;
      event.preventDefault(); event.stopPropagation(); closePanel();
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, [state.panelOpen, closePanel]);

  useEffect(() => {
    if (!active) return;
    const clicked = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      if (!element?.closest("a,button")) return;
      const tour = element.closest<HTMLElement>("[data-tour]")?.dataset.tour;
      if (tour === "official-source" && element.closest("a")) send({ type: "source-opened", placeId: snapshot.selectedPlaceId });
      if (tour === "download") send({ type: "download-opened" });
    };
    document.addEventListener("click", clicked, true);
    return () => document.removeEventListener("click", clicked, true);
  }, [active, send, snapshot.selectedPlaceId]);

  // Positions follow rendered elements and scroll containers. Animation frames coalesce layout
  // measurements only; they never advance tutorial steps or invoke application actions.
  useEffect(() => {
    if (!state.hydrated) return;
    let frame = 0;
    let observedTarget: HTMLElement | null = null;
    const measure = () => {
      frame = 0;
      const width = window.innerWidth;
      const height = window.visualViewport?.height ?? window.innerHeight;
      const modal = Array.from(document.querySelectorAll<HTMLElement>('.place-detail[role="dialog"][aria-modal="true"]')).find(shown);
      const host = modal ?? document.body;
      const target = active && state.panelOpen ? findTarget(targetName) : null;
      if (target !== observedTarget) {
        if (observedTarget) resize.unobserve(observedTarget);
        if (target) resize.observe(target);
        observedTarget = target;
      }
      const panel = panelRef.current?.getBoundingClientRect();
      const dock = dockRef.current?.getBoundingClientRect();
      const invitationHeight = rootRef.current?.querySelector(".tami-invitation")?.getBoundingClientRect().height ?? 0;
      const viewport = currentViewport();
      const osm = document.querySelector<HTMLIFrameElement>(".osm-map-viewport iframe, .diorama-real-info iframe");
      let mapAttribution: Rect | null = null;
      if (osm && shown(osm)) {
        const map = osm.getBoundingClientRect();
        const top = Math.max(map.bottom - 64, map.top, viewport.top), bottom = Math.min(map.bottom, viewport.top + viewport.height);
        const left = Math.max(map.left, viewport.left), right = Math.min(map.right, viewport.left + viewport.width);
        if (bottom > top && right > left) mapAttribution = { top, bottom, left, right, width: right - left, height: bottom - top };
      }
      const protectedRects = Array.from(document.querySelectorAll<HTMLElement>('[data-tami-avoid]')).filter(shown).map(element => visibleRect(element, width, height)).filter((rect): rect is Rect => rect !== null);
      const next: Geometry = { host, target: target ? visibleRect(target, width, height) : null, found: !!target, width, height, panelWidth: panel?.width ?? Math.min(344, width - 24), panelHeight: panel?.height ?? 350, modal: !!modal, viewport, dockWidth: dock?.width ?? (width <= 600 ? 140 : 172), dockHeight: dock?.height ?? (width <= 600 ? 56 : 72), invitationHeight: invitationHeight || 180, mapAttribution, protectedRects };
      setGeometry((current) => current.host === next.host && JSON.stringify({ ...current, host: null }) === JSON.stringify({ ...next, host: null }) ? current : next);
      const reserved = width <= 600 && state.panelOpen ? (panel?.height ?? 350) + 24 : invitation ? invitationHeight + 104 : width <= 600 ? 88 : 104;
      document.documentElement.style.setProperty("--tami-reserved-space", `${Math.ceil(reserved)}px`);
      if (pendingFocus.current) {
        const element = findTarget(pendingFocus.current);
        if (element) {
          pendingFocus.current = null;
          element.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });
          const hadTabIndex = element.hasAttribute("tabindex");
          if (!hadTabIndex) {
            element.setAttribute("tabindex", "-1");
            element.addEventListener("blur", () => element.removeAttribute("tabindex"), { once: true });
          }
          element.focus({ preventScroll: true });
        }
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    resize.observe(document.body);
    if (panelRef.current) resize.observe(panelRef.current);
    if (dockRef.current) resize.observe(dockRef.current);
    const mutation = new MutationObserver(schedule);
    mutation.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "open", "class", "aria-hidden", "aria-modal", "data-tour"] });
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect();
      window.removeEventListener("resize", schedule); document.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [active, targetName, state.panelOpen, state.hydrated, snapshot.view, invitation, state.preferences.minimized]);

  useEffect(() => () => { document.documentElement.style.removeProperty("--tami-reserved-space"); }, []);

  const focusTarget = (name: string) => {
    pendingFocus.current = name;
    const element = findTarget(name);
    if (element) {
      element.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });
      if (!element.hasAttribute("tabindex")) {
        element.setAttribute("tabindex", "-1");
        element.addEventListener("blur", () => element.removeAttribute("tabindex"), { once: true });
      }
      element.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  };

  // Every callback below is initiated by a visible user button. No button calls click() on
  // production targets; creating, retrying, approving and downloading stay user decisions.
  const showStep = () => {
    const step = state.tutorial.step;
    if (step <= 2) actions.navigate("explore");
    else if (step <= 4) actions.openStudio();
    else if (step === 5) actions.openEditor();
    else if (step === 6) actions.openReview();
    else if (snapshot.approved) actions.showDownload();
    else actions.showApprove();
    focusTarget(step === 0 ? "place-results" : targetName);
  };
  const actOnAdvice = () => {
    switch (advice.action) {
      case "explore": actions.navigate("explore"); focusTarget("place-results"); break;
      case "studio": actions.openStudio(); focusTarget("brief-fields"); break;
      case "review": actions.openReview(advice.cardId); focusTarget("review-panel"); break;
      case "editor": actions.openEditor(); focusTarget(context.run ? "cards" : "brief-fields"); break;
      case "resume": actions.resumeRun(); break;
      case "approve": actions.showApprove(); focusTarget("approve-panel"); break;
      case "download": actions.showDownload(); focusTarget("download"); break;
    }
  };
  const startTutorial = (restart = false) => {
    openPanel(); send({ type: restart ? "restart" : "start" });
  };
  const updatePreferences = (value: Partial<GuidePreferences>) => dispatch({ type: "preferences", value });
  const persistPosition = (anchor: Point | null) => {
    try {
      if (anchor) localStorage.setItem(TAMI_POSITION_KEY, JSON.stringify({ version: 1, ...anchor }));
      else localStorage.removeItem(TAMI_POSITION_KEY);
    } catch { /* Dragging and keyboard positioning still work in private storage modes. */ }
  };
  const resetPosition = () => {
    setDockAnchor(null); persistPosition(null); setPositionMessage("타미를 기본 위치로 돌렸어요.");
  };
  const moveBy = (x: number, y: number) => {
    const dock = dockRef.current?.getBoundingClientRect();
    if (!dock) return;
    const anchor = anchorForPosition({ x: dock.x + x, y: dock.y + y }, dock, currentViewport());
    setDockAnchor(anchor); persistPosition(anchor); setPositionMessage("타미 위치를 옮겨 저장했어요.");
  };
  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0 || drag.current) return;
    const dock = dockRef.current?.getBoundingClientRect();
    if (!dock) return;
    suppressClick.current = false;
    drag.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: { x: dock.x, y: dock.y }, moved: false, originalAnchor: dockAnchor, latest: null };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const updateDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = drag.current, dock = dockRef.current?.getBoundingClientRect();
    if (!gesture || gesture.pointerId !== event.pointerId || !dock) return;
    const pointer = { x: event.clientX, y: event.clientY };
    if (!gesture.moved && !hasDragged(gesture.start, pointer)) return;
    gesture.moved = true; suppressClick.current = true; setDragging(true);
    event.preventDefault();
    const anchor = anchorForPosition({ x: gesture.origin.x + pointer.x - gesture.start.x, y: gesture.origin.y + pointer.y - gesture.start.y }, dock, currentViewport());
    gesture.latest = anchor; setDockAnchor(anchor);
  };
  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>, canceled = false) => {
    const gesture = drag.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    drag.current = null; setDragging(false);
    if (canceled) setDockAnchor(gesture.originalAnchor);
    else if (gesture.moved && gesture.latest) {
      persistPosition(gesture.latest); setPositionMessage("타미 위치를 옮겨 저장했어요.");
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const positionKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const distance = event.shiftKey ? 40 : 12;
    const delta = { ArrowLeft: [-distance, 0], ArrowRight: [distance, 0], ArrowUp: [0, -distance], ArrowDown: [0, distance] }[event.key];
    if (delta) { event.preventDefault(); moveBy(delta[0], delta[1]); }
    else if (event.key === "Home") { event.preventDefault(); resetPosition(); }
  };
  const dockHandlers = {
    onPointerDown: beginDrag, onPointerMove: updateDrag,
    onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => finishDrag(event),
    onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => finishDrag(event, true),
    onLostPointerCapture: (event: ReactPointerEvent<HTMLButtonElement>) => finishDrag(event, true),
    onKeyDown: positionKey,
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      if (suppressClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; return; }
      if (state.panelOpen) closePanel(); else openPanel();
    },
  };
  if (!state.hydrated || !geometry.host) return null;
  const step = GUIDE_STEPS[state.tutorial.step];
  const guard = getStepGuard(state.tutorial, snapshot);
  const missingTarget = active && !geometry.target;
  const dockSize = { width: geometry.dockWidth, height: geometry.dockHeight };
  const preferredDock = { x: geometry.viewport.left + geometry.viewport.width - dockSize.width - (geometry.width <= 600 ? 12 : 20), y: geometry.viewport.top + geometry.viewport.height - dockSize.height - (geometry.width <= 600 ? 12 : 16) };
  const obstacles = [...geometry.protectedRects, ...(geometry.mapAttribution ? [geometry.mapAttribution] : [])];
  const dockPosition = resolveDockPosition(preferredDock, dockSize, geometry.viewport, obstacles, dockAnchor);
  const besideDock = (width: number, height: number) => {
    const viewport = geometry.viewport;
    let x = dockPosition.x + dockSize.width - width, y = dockPosition.y - height - 12;
    if (y < viewport.top + 8) {
      if (dockPosition.y + dockSize.height + 12 + height <= viewport.top + viewport.height - 8) y = dockPosition.y + dockSize.height + 12;
      else if (dockPosition.x >= viewport.left + width + 20) { x = dockPosition.x - width - 12; y = dockPosition.y; }
      else { x = dockPosition.x + dockSize.width + 12; y = dockPosition.y; }
    }
    const clamped = clampDockPosition({ x, y }, { width, height }, viewport);
    return { left: clamped.x, top: clamped.y, right: "auto", bottom: "auto" };
  };
  const position = active ? panelPosition(geometry) : dockAnchor && geometry.width > 600 ? besideDock(geometry.panelWidth, geometry.panelHeight) : undefined;
  const completed = state.tutorial.status === "completed";

  return createPortal(<div ref={rootRef} className={`tami-guide${state.preferences.animationOff ? " tami-guide--no-motion" : ""}${state.panelOpen ? " tami-guide--open" : ""}${geometry.modal ? " tami-guide--in-modal" : ""}${dragging ? " tami-guide--dragging" : ""}`} data-tami-state={mood}>
    {active && state.panelOpen && geometry.target && <div className="tami-target-outline" aria-hidden="true" data-tami-target={targetName} style={{ top: geometry.target.top - 3, left: geometry.target.left - 3, width: geometry.target.width + 6, height: geometry.target.height + 6 }} />}

    {invitation && <aside className="tami-invitation" aria-label="타미의 첫 안내" style={dockAnchor ? besideDock(Math.min(278, geometry.viewport.width - 32), geometry.invitationHeight) : undefined}>
      <strong>안녕하세요, 안내 로봇 타미예요.</strong>
      <p>장소 찾기부터 카드 다운로드까지,<br />8단계로 함께 둘러볼까요?</p>
      <div className="tami-inline-actions"><button className="tami-primary" onClick={() => startTutorial()}>사용법 시작</button><button className="tami-text-button" onClick={() => updatePreferences({ invitationDismissed: true })}>나중에</button></div>
    </aside>}

    {state.panelOpen && <section ref={panelRef} className={`tami-panel${active ? " tami-panel--tour" : ""}`} style={position} role="dialog" aria-modal="false" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1} data-testid="tami-panel">
      <header className="tami-panel-header"><div><span className="tami-panel-name">타미와 함께</span><h2 id={titleId}>{active ? step.title : completed ? "사용법을 모두 살펴봤어요" : "지금 무엇을 하면 좋을까요?"}</h2></div><button className="tami-icon-button" onClick={closePanel} aria-label="타미 안내 닫기">×</button></header>

      {active ? <>
        <div className="tami-step-count" aria-live="polite" aria-atomic="true"><strong>{state.tutorial.step + 1}</strong><span> / {GUIDE_STEP_COUNT}단계</span><span className="tami-step-dots" aria-hidden="true">{GUIDE_STEPS.map((_, index) => <i className={index <= state.tutorial.step ? "is-done" : ""} key={index} />)}</span></div>
        <p id={descriptionId} className="tami-description">{step.body}</p>
        {missingTarget && <p className="tami-target-note" role="status">{geometry.found ? "안내할 항목이 화면 밖에 있어요. 아래 버튼으로 위치를 확인해 주세요." : "이 단계의 화면을 먼저 열어 주세요. 항목이 나타나면 타미가 위치를 표시해요."}</p>}
        <button className="tami-primary tami-wide" onClick={showStep}>{state.tutorial.step === 7 && snapshot.approved ? "다운로드 위치 보기" : step.action}</button>
        {guard && <p className="tami-prerequisite" role="status">{guard}</p>}
        <nav className="tami-step-actions" aria-label="튜토리얼 단계 이동"><button className="tami-secondary" disabled={state.tutorial.step === 0} onClick={() => send({ type: "previous" })}>이전</button><button className="tami-secondary" disabled={!!guard} onClick={() => send({ type: "next" })}>{state.tutorial.step === 7 ? "사용법 마치기" : "다음"}</button></nav>
        <div className="tami-tour-footer"><button className="tami-text-button" onClick={() => { send({ type: "skip" }); closePanel(); }}>건너뛰기</button><button className="tami-text-button" onClick={closePanel}>종료하고 나중에 이어가기</button></div>
      </> : <>
        <div className="tami-advice" aria-live="polite"><h3>{completed ? "이제 직접 이야기를 이어가세요" : advice.title}</h3><p id={descriptionId}>{completed ? "사용법은 언제든 다시 시작할 수 있어요. 타미는 현재 화면에 맞춰 다음 할 일을 안내할게요." : advice.body}</p></div>
        {advice.action && <button className="tami-primary tami-wide" onClick={actOnAdvice}>{advice.actionLabel}</button>}
        <nav className="tami-shortcuts" aria-label="타미 빠른 안내">
          <button className="tami-secondary" onClick={() => { actions.navigate("explore"); focusTarget("place-results"); }}>장소 찾기</button>
          <button className="tami-secondary" onClick={() => { actions.openStudio(); focusTarget("brief-fields"); }}>카드뉴스 만들기 안내</button>
          <button className="tami-secondary" onClick={() => actions.resumeRun()}>하던 작업 이어가기</button>
        </nav>
        <div className="tami-tutorial-entry">
          <span>8단계 사용법</span>
          {state.tutorial.status === "paused" ? <button className="tami-secondary" onClick={() => send({ type: "resume" })}>{state.tutorial.step + 1}단계부터 이어하기</button> : <button className="tami-secondary" onClick={() => startTutorial()}>사용법 시작</button>}
          {state.tutorial.status !== "idle" && <button className="tami-text-button" onClick={() => startTutorial(true)}>처음부터 다시 시작</button>}
        </div>
      </>}
      <details className="tami-settings"><summary>타미 설정</summary><label><input type="checkbox" checked={state.preferences.animationOff} onChange={(event) => updatePreferences({ animationOff: event.target.checked })} /> 움직임 끄기</label><label><input type="checkbox" checked={state.preferences.minimized} onChange={(event) => updatePreferences({ minimized: event.target.checked })} /> 캐릭터 최소화</label>
        <div className="tami-position-controls" role="group" aria-label="타미 위치 조절"><button aria-label="타미 왼쪽으로 이동" onClick={() => moveBy(-24, 0)}>←</button><button aria-label="타미 위로 이동" onClick={() => moveBy(0, -24)}>↑</button><button aria-label="타미 아래로 이동" onClick={() => moveBy(0, 24)}>↓</button><button aria-label="타미 오른쪽으로 이동" onClick={() => moveBy(24, 0)}>→</button><button className="tami-position-reset" onClick={resetPosition}>위치 초기화</button></div>
        <p>타미나 사용법 버튼을 끌어 옮길 수 있어요. 키보드 방향키로도 옮길 수 있고 Home 키로 초기화해요.</p><p>설정과 사용법 진행 위치는 이 브라우저에 저장돼요.</p></details>
    </section>}

    <span id={moveDescriptionId} className="tami-sr-only">끌어서 위치 이동. 방향키로 이동, Shift와 방향키로 크게 이동, Home으로 위치 초기화. Enter나 Space로 사용법 열기.</span>
    <span className="tami-sr-only" role="status" aria-live="polite">{positionMessage}</span>
    <div ref={dockRef} className={`tami-dock${state.preferences.minimized ? " tami-dock--minimized" : ""}`} style={{ left: dockPosition.x, top: dockPosition.y, right: "auto", bottom: "auto" }}>
      {!state.preferences.minimized && <button className="tami-character-button" aria-label="안내 로봇 타미" aria-describedby={moveDescriptionId} title="끌어서 타미 위치 이동" aria-expanded={state.panelOpen} {...dockHandlers}><Character mood={mood} animationOff={state.preferences.animationOff} failed={assetFailed} /></button>}
      <button ref={helpRef} className="tami-help-button" aria-label="타미 사용법 열기" aria-describedby={moveDescriptionId} title="클릭하면 사용법, 끌면 위치 이동" aria-expanded={state.panelOpen} {...dockHandlers}>사용법<span aria-hidden="true">{state.panelOpen ? " −" : " +"}</span></button>
    </div>
  </div>, geometry.host);
}
