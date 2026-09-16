import { getPlace, type Place } from "./places";
import type { Run } from "./types";
import type { WorkspaceView } from "./workspace-state";

export type GuideView = WorkspaceView;
export type GuideContext = {
  canStartProduction?: boolean;
  view: GuideView;
  selectedPlace: Place | null;
  draftPlace: Place;
  run: Run | null;
  busy: boolean;
  error: string;
  tab: "evidence" | "changes" | "edit" | "image";
  selectedCardId: string;
};
export type GuideActions = {
  navigate: (view: GuideView) => void;
  openStudio: () => void;
  startProduction: () => void;
  openReview: (cardId?: string) => void;
  openEditor: () => void;
  resumeRun: () => void;
  showApprove: () => void;
  showDownload: () => void;
};
export type TamiMood = "idle" | "greeting" | "guiding" | "working" | "success" | "error";
export type GuideSnapshot = {
  view: GuideView;
  selectedPlaceId: string | null;
  draftPlaceId: string;
  runId: string | null;
  runPlaceId: string | null;
  cardCount: number;
  version: number | null;
  reviewed: boolean;
  approved: boolean;
  downloadReady: boolean;
  running: boolean;
  failed: boolean;
  busy: boolean;
};
export type GuideState = {
  version: 1;
  status: "idle" | "active" | "paused" | "completed" | "skipped";
  step: number;
  placeId: string | null;
  runId: string | null;
  sourcePlaceId: string | null;
};
export type GuideEvent =
  | { type: "start" | "restart" | "resume" | "pause" | "skip" | "previous" | "next" | "download-opened" }
  | { type: "source-opened"; placeId: string | null }
  | { type: "observe"; before: GuideSnapshot };
export type GuidePreferences = { minimized: boolean; animationOff: boolean; invitationDismissed: boolean };
export type GuideStorage = { version: 1; tutorial: GuideState; preferences: GuidePreferences };
export const GUIDE_STORAGE_KEY = "timestory:tami-guide:v1";
export const GUIDE_STEP_COUNT = 8;

export function initialGuideState(): GuideState {
  return { version: 1, status: "idle", step: 0, placeId: null, runId: null, sourcePlaceId: null };
}

export function getGuideSnapshot(context: GuideContext): GuideSnapshot {
  const run = context.run;
  const reviewed = !!run && run.cards.length === 4 && run.reviewVersion === run.version &&
    !run.issues.some((issue) => !issue.resolved && issue.severity === "error") &&
    (run.status === "ready_for_approval" || run.status === "approved");
  const approved = reviewed && run?.status === "approved" && run.approval?.version === run.version;
  return {
    view: context.view,
    selectedPlaceId: context.selectedPlace?.id ?? null,
    draftPlaceId: context.draftPlace.id,
    runId: run?.id ?? null,
    runPlaceId: run ? getPlace(run.brief.placeId ?? run.brief.place)?.id ?? null : null,
    cardCount: run?.cards.length ?? 0,
    version: run?.version ?? null,
    reviewed,
    approved,
    downloadReady: approved && !!run?.artifacts.some((artifact) => artifact.kind === "zip" && artifact.version === run.version && artifact.reviewVersion === run.version),
    running: run?.status === "running" || run?.status === "queued" || run?.imageJob?.status === "running",
    failed: run?.status === "failed" || run?.status === "cancelled",
    busy: context.busy,
  };
}

function matchingRun(state: GuideState, snapshot: GuideSnapshot) {
  return !!snapshot.runId && snapshot.runPlaceId === (state.placeId ?? snapshot.draftPlaceId) &&
    (!state.runId || state.runId === snapshot.runId);
}

/** Guards describe prerequisites only. They never trigger application actions. */
export function getStepGuard(state: GuideState, snapshot: GuideSnapshot): string | null {
  switch (state.step) {
    case 0: return null;
    case 1: return snapshot.selectedPlaceId ? null : "목록이나 지도에서 장소를 하나 선택해 주세요.";
    case 2: return state.sourcePlaceId && state.sourcePlaceId === snapshot.selectedPlaceId ? null : "선택한 장소의 공식 정보 링크를 열어 확인해 주세요.";
    case 3: return snapshot.view === "studio" && snapshot.draftPlaceId === state.placeId ? null : "선택한 장소로 제작 화면을 열어 주세요.";
    case 4:
      if (snapshot.running || snapshot.busy) return "제작이 진행 중이에요. 완료되면 다음 단계로 안내할게요.";
      if (snapshot.failed) return "작업이 중단되었어요. 원인을 확인하고 직접 다시 실행해 주세요.";
      return matchingRun(state, snapshot) && snapshot.cardCount === 4 ? null : "선택한 장소의 대상과 목적을 정하고 직접 제작하기를 눌러 주세요.";
    case 5: return matchingRun(state, snapshot) && snapshot.cardCount === 4 && snapshot.view === "studio" ? null : "이번 작업의 카드 4장을 제작 화면에서 열어 주세요.";
    case 6: return matchingRun(state, snapshot) && snapshot.reviewed && !snapshot.busy && !snapshot.running ? null : "현재 버전의 검수가 통과해야 해요. 표시된 문제를 확인하고 수정한 뒤 다시 검수해 주세요.";
    case 7:
      if (!matchingRun(state, snapshot) || !snapshot.approved) return "검수가 통과한 현재 버전을 직접 승인해 주세요. 타미가 대신 승인하지 않아요.";
      return snapshot.downloadReady ? null : "승인한 버전의 다운로드 파일이 준비되면 이어갈 수 있어요.";
    default: return "사용법을 처음부터 다시 시작해 주세요.";
  }
}

export function getStepTarget(state: GuideState, snapshot: GuideSnapshot): string {
  return ["nav-explore", "place-results", "official-source", "create-from-place", "brief-fields", "cards", "review-panel", snapshot.approved ? "download" : "approve-panel"][state.step] ?? "nav-explore";
}

export const GUIDE_STEPS = [
  { title: "관광 탐색 열기", body: "성남의 장소를 목록과 지도에서 찾아볼까요? 관광 탐색을 열어 주세요.", action: "관광 탐색 열기" },
  { title: "마음에 드는 장소 선택", body: "목록이나 지도에서 장소 하나를 선택해 주세요. 상세정보에 출처와 사진이 함께 표시돼요.", action: "장소 목록 보기" },
  { title: "공식 정보 확인", body: "장소 상세의 공식 정보 링크를 열어 주세요. 관람 시간 등 방문 정보는 공식 안내를 한 번 더 확인하는 것이 좋아요.", action: "공식 정보 위치 보기" },
  { title: "이 장소로 제작 시작", body: "아래 파란 버튼을 눌러 ‘다음’을 활성화해 주세요. ‘다음’을 누르면 선택한 장소의 제작 화면으로 이동해요.", action: "선택한 장소 확인" },
  { title: "대상과 목적 정하기", body: "누구에게 어떤 이야기를 전할지 입력한 뒤 ‘다음’을 누르면 카드뉴스 제작을 시작해요.", action: "제작 입력 보기" },
  { title: "카드 4장 살펴보기", body: "제목·사진·문구를 읽고 필요한 부분을 고쳐 주세요. 수정 없이 다음으로 넘어가도 돼요. 마지막 장은 상상 이야기예요.", action: "카드와 편집 화면 보기" },
  { title: "사실과 출처 검수", body: "문제가 있는 문구와 근거를 확인해 주세요. 수정 뒤에는 현재 버전을 다시 검수해야 승인할 수 있어요.", action: "검수 결과 보기" },
  { title: "직접 승인하고 다운로드", body: "검수 결과와 카드 내용을 확인한 뒤 직접 승인해 주세요. 승인한 현재 버전의 PNG와 ZIP을 내려받을 수 있어요.", action: "승인 위치 보기" },
] as const;

function nextStep(state: GuideState, snapshot: GuideSnapshot): GuideState {
  if (getStepGuard(state, snapshot)) return state;
  if (state.step === GUIDE_STEP_COUNT - 1) return { ...state, status: "completed" };
  return {
    ...state,
    step: state.step + 1,
    placeId: state.step === 1 ? snapshot.selectedPlaceId : state.placeId,
    runId: state.step === 4 ? snapshot.runId : state.runId,
  };
}

/** Event gates prevent previous/resume from bouncing ahead when old conditions remain true. */
export function transitionGuide(state: GuideState, event: GuideEvent, snapshot: GuideSnapshot): GuideState {
  if (event.type === "start" || event.type === "restart") return { ...initialGuideState(), status: "active" };
  if (event.type === "resume") return { ...restoreGuide(state, snapshot), status: "active" };
  if (event.type === "pause") return state.status === "active" ? { ...state, status: "paused" } : state;
  if (event.type === "skip") return { ...state, status: "skipped" };
  if (state.status !== "active") return state;
  if (event.type === "previous") return { ...state, step: Math.max(0, state.step - 1) };
  if (event.type === "next") return nextStep(state, snapshot);
  if (event.type === "source-opened") {
    if (state.step !== 2 || !event.placeId || event.placeId !== snapshot.selectedPlaceId || event.placeId !== state.placeId) return state;
    return { ...state, sourcePlaceId: event.placeId };
  }
  if (event.type === "download-opened") return state.step === 7 && !getStepGuard(state, snapshot) ? { ...state, status: "completed" } : state;
  if (event.type !== "observe") return state;
  const before = event.before;
  if (state.step >= 2 && snapshot.selectedPlaceId && before.selectedPlaceId !== snapshot.selectedPlaceId && state.placeId !== snapshot.selectedPlaceId)
    return { ...state, step: 2, placeId: snapshot.selectedPlaceId, sourcePlaceId: null, runId: null };
  if (state.step >= 5 && before.runId !== snapshot.runId) {
    if (!snapshot.runId || snapshot.runPlaceId !== state.placeId) return { ...state, step: 4, runId: null };
    return { ...state, step: Math.min(state.step, 5), runId: snapshot.runId };
  }
  if (state.step === 7 && before.reviewed && !snapshot.reviewed) return { ...state, step: 6 };
  const relevantChange =
    (state.step === 4 && (before.runId !== snapshot.runId || before.cardCount !== snapshot.cardCount || before.running !== snapshot.running || before.busy !== snapshot.busy));
  return relevantChange ? nextStep(state, snapshot) : state;
}

/** Restoration can move backward to a valid prerequisite, never forward or into an active tour. */
export function restoreGuide(state: GuideState, snapshot: GuideSnapshot): GuideState {
  const result = { ...state, step: Math.min(7, Math.max(0, state.step)), status: state.status === "active" ? "paused" as const : state.status };
  if (result.status === "idle" || result.status === "completed" || result.status === "skipped" || result.step < 2) return result;
  const placeId = snapshot.selectedPlaceId ?? (snapshot.runPlaceId === result.placeId ? snapshot.runPlaceId : null);
  if (!placeId) return { ...result, step: 1, placeId: null, sourcePlaceId: null, runId: null };
  if (placeId !== result.placeId) return { ...result, step: 2, placeId, sourcePlaceId: null, runId: null };
  if (result.step >= 5 && (!snapshot.runId || snapshot.runPlaceId !== placeId)) return { ...result, step: 4, runId: null };
  if (result.step >= 5 && result.runId && result.runId !== snapshot.runId) return { ...result, step: 4, runId: null };
  if (result.step >= 5 && snapshot.cardCount !== 4) return { ...result, step: 4, runId: null };
  if (result.step === 7 && !snapshot.reviewed) return { ...result, step: 6 };
  return result;
}

export function restoreGuideStorage(raw: string | null, snapshot: GuideSnapshot): GuideStorage {
  const fallback: GuideStorage = { version: 1, tutorial: initialGuideState(), preferences: { minimized: false, animationOff: false, invitationDismissed: false } };
  if (!raw || raw.length > 10_000) return fallback;
  try {
    const value = JSON.parse(raw) as GuideStorage;
    if (!value || value.version !== 1 || !value.tutorial || !value.preferences) return fallback;
    const state = value.tutorial;
    if (state.version !== 1 || !["idle", "active", "paused", "completed", "skipped"].includes(state.status) || !Number.isSafeInteger(state.step) || state.step < 0 || state.step > 7) return fallback;
    if (![state.placeId, state.runId, state.sourcePlaceId].every((id) => id === null || (typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id)))) return fallback;
    return {
      version: 1,
      tutorial: restoreGuide({ version: 1, status: state.status, step: state.step, placeId: state.placeId, runId: state.runId, sourcePlaceId: state.sourcePlaceId }, snapshot),
      preferences: {
        minimized: value.preferences.minimized === true,
        animationOff: value.preferences.animationOff === true,
        invitationDismissed: value.preferences.invitationDismissed === true,
      },
    };
  } catch { return fallback; }
}

export type GuideAdvice = {
  mood: TamiMood;
  title: string;
  body: string;
  action: "explore" | "studio" | "review" | "editor" | "resume" | "approve" | "download" | null;
  actionLabel: string;
  cardId?: string;
};

export function getGuideAdvice(context: GuideContext): GuideAdvice {
  const snapshot = getGuideSnapshot(context);
  if (snapshot.running || context.busy) return { mood: "working", title: "이야기를 준비하고 있어요", body: "진행 기록에서 현재 작업을 확인할 수 있어요. 완료되면 카드와 검수 결과를 함께 살펴봐요.", action: null, actionLabel: "" };
  if (context.error) return { mood: "error", title: "확인이 필요한 상황이에요", body: context.error.slice(0, 240), action: context.run ? "review" : "explore", actionLabel: context.run ? "현재 작업 확인" : "장소 목록 보기" };
  if (context.view === "diorama" && context.selectedPlace)
    return { mood: "guiding", title: `${context.selectedPlace.name}을 입체로 만나요`, body: "모형을 돌려보거나 이름표를 눌러 이야기를 읽어 보세요. 실제 사진과 위치를 확인한 뒤 같은 장소로 카드뉴스를 만들 수 있어요.", action: "studio", actionLabel: "이 장소로 제작 화면 열기" };
  if (context.view === "diorama")
    return { mood: "guiding", title: "성남 전체가 한눈에 보여요", body: "수정구·중원구·분당구를 함께 둘러보세요. 지역이나 명소를 누르면 같은 도시 안에서 가까이 이동해요. 성남 전체 버튼으로 다시 돌아올 수 있어요.", action: null, actionLabel: "" };
  if ((context.view === "explore" || context.view === "saved") && context.selectedPlace)
    return { mood: "guiding", title: `${context.selectedPlace.name}, 만나볼까요?`, body: "공식 출처와 방문 정보를 확인한 뒤 이 장소로 카드뉴스를 만들 수 있어요.", action: "studio", actionLabel: "이 장소로 제작 화면 열기" };
  const issue = context.run?.issues.find((entry) => !entry.resolved && entry.severity === "error");
  if (issue) {
    const cardId = context.run?.cards.find((card) => card.id === issue.targetId)?.id ?? context.run?.claims.find((claim) => claim.id === issue.targetId)?.cardId;
    return { mood: "error", title: "확인할 문구가 있어요", body: issue.message, action: "review", actionLabel: cardId ? "문제 카드 보기" : "검수 결과 보기", cardId };
  }
  if (snapshot.failed) return { mood: "error", title: "중단된 작업을 확인해 주세요", body: "진행 기록과 중단 이유를 먼저 확인해 주세요. 다시 실행할지는 직접 정할 수 있어요.", action: "resume", actionLabel: "중단 작업 확인" };
  if (snapshot.downloadReady) return { mood: "success", title: "이야기가 완성됐어요", body: "직접 승인한 현재 버전의 PNG와 ZIP을 내려받을 수 있어요.", action: "download", actionLabel: "다운로드 위치 보기" };
  if (snapshot.reviewed) return { mood: "guiding", title: "마지막으로 직접 확인해 주세요", body: "현재 버전의 검수가 통과했어요. 문구와 사진을 살펴본 뒤 승인하면 내려받을 수 있어요.", action: "approve", actionLabel: "승인 위치 보기" };
  if (context.run?.cards.length) return { mood: "guiding", title: "카드와 근거를 함께 살펴봐요", body: "문구나 사진을 고친 뒤에는 다시 검수해 주세요. 네 번째 카드는 상상 이야기로 구분돼요.", action: "review", actionLabel: "카드 검수 보기" };
  if (context.view === "studio") return { mood: "guiding", title: `${context.draftPlace.name}의 이야기`, body: "대상과 제작 목적을 정해 주세요. 제작하기는 내용을 확인한 뒤 직접 눌러 주세요.", action: "editor", actionLabel: "제작 입력 보기" };
  if (context.view === "agent") return { mood: "guiding", title: "이야기를 만드는 과정을 살펴봐요", body: "에이전트는 공식 자료를 찾고 문구를 작성·검수해요. 저는 이용 방법과 다음 확인 위치를 안내해 드려요.", action: "explore", actionLabel: "소개할 장소 고르기" };
  return { mood: "idle", title: "어떤 성남을 만나볼까요?", body: "관광 탐색에서 마음에 드는 장소를 골라 주세요. 사진과 공식 정보가 있는 장소부터 시작해 볼 수 있어요.", action: "explore", actionLabel: "관광 탐색 열기" };
}
