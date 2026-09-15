export type TourSettings = {
  speed: number;
  dwellSeconds: number;
  labels: boolean;
  tourists: boolean;
  traffic: boolean;
  density: number;
  peopleScale: number;
  motion: boolean;
  repeat: boolean;
};

type RunningPhase = 'loading' | 'transition' | 'dwelling';
export type TourStatus = 'idle' | RunningPhase | 'paused' | 'manual' | 'error';

export type TourState = {
  status: TourStatus;
  stopId: string | null;
  remainingMs: number;
  requestId: number;
  resumePhase: RunningPhase | null;
  settings: TourSettings;
};

export type TourEvent =
  | { type: 'play' | 'next' | 'reconcile'; eligibleStopIds: readonly string[] }
  | { type: 'loaded' | 'arrived' | 'error'; stopId: string; requestId: number }
  | { type: 'tick'; elapsedMs: number; eligibleStopIds: readonly string[]; requestId: number }
  | { type: 'pause' | 'hidden' | 'manual' | 'stop' }
  | { type: 'select'; stopId: string | null }
  | { type: 'settings'; settings: Partial<TourSettings> };

export function defaultTourSettings(): TourSettings {
  return { speed: 1, dwellSeconds: 10, labels: true, tourists: true, motion: true, repeat: false, traffic: true, density: 1, peopleScale: 1.7 };
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function readSettings(value: unknown, fallback: TourSettings): TourSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...fallback };
  const input = value as Record<string, unknown>;
  return {
    speed: boundedNumber(input.speed, fallback.speed, 0.5, 2),
    dwellSeconds: boundedNumber(input.dwellSeconds, fallback.dwellSeconds, 6, 30),
    labels: typeof input.labels === 'boolean' ? input.labels : fallback.labels,
    tourists: typeof input.tourists === 'boolean' ? input.tourists : fallback.tourists,
    traffic: typeof input.traffic === 'boolean' ? input.traffic : fallback.traffic,
    density: boundedNumber(input.density, fallback.density, .5, 2),
    peopleScale: boundedNumber(input.peopleScale, fallback.peopleScale, 1, 2.5),
    motion: typeof input.motion === 'boolean' ? input.motion : fallback.motion,
    repeat: typeof input.repeat === 'boolean' ? input.repeat : fallback.repeat,
  };
}

/** Restore preferences only; playback always starts idle via createTourState. */
export function decodeTourSettings(raw: string | null): TourSettings {
  const fallback = defaultTourSettings();
  if (!raw || raw.length > 8192) return fallback;
  try {
    return readSettings(JSON.parse(raw), fallback);
  } catch {
    return fallback;
  }
}

export function createTourState(stopId: string | null, settings = defaultTourSettings()): TourState {
  return {
    status: 'idle', stopId, remainingMs: 0, requestId: 0, resumePhase: null,
    settings: readSettings(settings, defaultTourSettings()),
  };
}

function isRunning(status: TourStatus): status is RunningPhase {
  return status === 'loading' || status === 'transition' || status === 'dwelling';
}

function stopTour(state: TourState, stopId = state.stopId): TourState {
  if (state.status === 'idle' && state.stopId === stopId) return state;
  return { ...state, status: 'idle', stopId, remainingMs: 0, resumePhase: null, requestId: state.requestId + 1 };
}

function loadStop(state: TourState, stopId: string): TourState {
  return {
    ...state, status: 'loading', stopId, remainingMs: state.settings.dwellSeconds * 1000,
    resumePhase: null, requestId: state.requestId + 1,
  };
}

function selectStop(state: TourState, stopId: string | null): TourState {
  if (stopId === null) return stopTour(state, null);
  if (isRunning(state.status)) return loadStop(state, stopId);
  if (state.status === 'paused') {
    return { ...loadStop(state, stopId), status: 'paused', resumePhase: 'loading' };
  }
  return {
    ...state, status: 'idle', stopId, remainingMs: 0, resumePhase: null, requestId: state.requestId + 1,
  };
}

function nextStop(state: TourState, eligibleStopIds: readonly string[]): TourState {
  if (!eligibleStopIds.length) return stopTour(state, null);
  const currentIndex = state.stopId === null ? -1 : eligibleStopIds.indexOf(state.stopId);
  const next = eligibleStopIds[currentIndex + 1] ?? (state.settings.repeat ? eligibleStopIds[0] : null);
  return next === null ? stopTour(state) : selectStop(state, next);
}

/**
 * The renderer echoes stopId/requestId on completion; timers echo requestId.
 * Pausing invalidates old callbacks. Resume restarts the interrupted renderer
 * phase with the new token, while preserving the remaining reading time.
 */
export function reduceTour(state: TourState, event: TourEvent): TourState {
  switch (event.type) {
    case 'play': {
      const stopId = state.stopId !== null && event.eligibleStopIds.includes(state.stopId)
        ? state.stopId : event.eligibleStopIds[0];
      if (stopId === undefined) return stopTour(state);
      if (stopId === state.stopId) {
        if (isRunning(state.status)) return state;
        if (state.status === 'paused' && state.resumePhase) {
          return { ...state, status: state.resumePhase, resumePhase: null };
        }
      }
      return loadStop(state, stopId);
    }
    case 'loaded':
    case 'arrived':
    case 'error': {
      if (event.stopId !== state.stopId || event.requestId !== state.requestId) return state;
      if (event.type === 'loaded' && state.status === 'loading') return { ...state, status: 'transition' };
      if (event.type === 'arrived' && state.status === 'transition') {
        return { ...state, status: 'dwelling', remainingMs: state.settings.dwellSeconds * 1000 };
      }
      if (event.type === 'error' && (isRunning(state.status) || state.status === 'paused')) {
        return { ...state, status: 'error', remainingMs: 0, resumePhase: null, requestId: state.requestId + 1 };
      }
      return state;
    }
    case 'tick': {
      if (state.status !== 'dwelling' || event.requestId !== state.requestId) return state;
      if (!Number.isFinite(event.elapsedMs) || event.elapsedMs <= 0) return state;
      if (state.stopId === null || !event.eligibleStopIds.includes(state.stopId)) return stopTour(state, null);
      const remainingMs = Math.max(0, state.remainingMs - event.elapsedMs);
      return remainingMs === 0 ? nextStop(state, event.eligibleStopIds) : { ...state, remainingMs };
    }
    case 'pause':
    case 'hidden':
      return isRunning(state.status)
        ? { ...state, status: 'paused', resumePhase: state.status, requestId: state.requestId + 1 }
        : state;
    case 'manual':
      return state.status === 'manual' ? state
        : { ...state, status: 'manual', resumePhase: null, requestId: state.requestId + 1 };
    case 'stop':
      return stopTour(state);
    case 'select':
      return selectStop(state, event.stopId);
    case 'next':
      return nextStop(state, event.eligibleStopIds);
    case 'reconcile':
      return stopTour(state, state.stopId !== null && event.eligibleStopIds.includes(state.stopId) ? state.stopId : null);
    case 'settings':
      return { ...state, settings: readSettings(event.settings, state.settings) };
  }
}
