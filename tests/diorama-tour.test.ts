import { describe, expect, it } from 'vitest';
import {
  createTourState, decodeTourSettings, defaultTourSettings, reduceTour,
  type TourState,
} from '../src/lib/diorama/tour';

const stops = ['museum-exterior', 'park-lake', 'market-stalls'];
const play = { type: 'play', eligibleStopIds: stops } as const;

function dwelling(stopId = stops[0]): TourState {
  const loading = reduceTour(createTourState(stopId), play);
  const transition = reduceTour(loading, { type: 'loaded', stopId, requestId: loading.requestId });
  return reduceTour(transition, { type: 'arrived', stopId, requestId: transition.requestId });
}

function tick(state: TourState, elapsedMs: number, eligibleStopIds = stops): TourState {
  return reduceTour(state, { type: 'tick', elapsedMs, eligibleStopIds, requestId: state.requestId });
}

describe('3D tour playback', () => {
  it('does not start without an eligible stop', () => {
    const state = reduceTour(createTourState(null), { type: 'play', eligibleStopIds: [] });
    expect(state.status).toBe('idle');
    expect(state.stopId).toBeNull();
  });

  it('starts with the selected eligible stop, or the first eligible replacement', () => {
    expect(reduceTour(createTourState(stops[1]), play)).toMatchObject({ status: 'loading', stopId: 'park-lake' });
    expect(reduceTour(createTourState('unmodeled-place'), play)).toMatchObject({ status: 'loading', stopId: 'museum-exterior' });
  });

  it('makes repeated play requests idempotent across active phases', () => {
    const loading = reduceTour(createTourState(stops[0]), play);
    const transition = reduceTour(loading, { type: 'loaded', stopId: stops[0], requestId: loading.requestId });
    for (const state of [loading, transition, dwelling()]) expect(reduceTour(state, play)).toBe(state);
  });

  it('starts reading time only after the current camera has arrived', () => {
    const loading = reduceTour(createTourState(stops[0]), play);
    expect(tick(loading, 5000)).toBe(loading);
    expect(reduceTour(loading, { type: 'arrived', stopId: stops[0], requestId: loading.requestId })).toBe(loading);
    const transition = reduceTour(loading, { type: 'loaded', stopId: stops[0], requestId: loading.requestId });
    expect(transition.status).toBe('transition');
    expect(tick(transition, 5000)).toBe(transition);
    expect(reduceTour(transition, { type: 'arrived', stopId: stops[0], requestId: transition.requestId }))
      .toMatchObject({ status: 'dwelling', remainingMs: 10000 });
  });

  it('preserves remaining reading time through pause and explicit resume', () => {
    const paused = reduceTour(tick(dwelling(), 3500), { type: 'pause' });
    expect(paused).toMatchObject({ status: 'paused', resumePhase: 'dwelling', remainingMs: 6500 });
    expect(tick(paused, 60000)).toBe(paused);
    const resumed = reduceTour(paused, play);
    expect(resumed).toMatchObject({ status: 'dwelling', remainingMs: 6500 });
    expect(tick(resumed, 1000).remainingMs).toBe(5500);
  });

  it.each(['loading', 'transition'] as const)('resumes the interrupted %s phase', (phase) => {
    let state = reduceTour(createTourState(stops[0]), play);
    if (phase === 'transition') state = reduceTour(state, { type: 'loaded', stopId: stops[0], requestId: state.requestId });
    const paused = reduceTour(state, { type: 'pause' });
    expect(paused.resumePhase).toBe(phase);
    expect(reduceTour(paused, play).status).toBe(phase);
  });

  it('invalidates pre-pause timers so they cannot consume time after resume', () => {
    const state = dwelling();
    const resumed = reduceTour(reduceTour(state, { type: 'pause' }), play);
    expect(reduceTour(resumed, { type: 'tick', requestId: state.requestId, elapsedMs: 5000, eligibleStopIds: stops })).toBe(resumed);
  });

  it('keeps camera speed independent from current and future reading time', () => {
    const state = reduceTour(tick(dwelling(), 1000), { type: 'settings', settings: { speed: 2 } });
    expect(state.settings.speed).toBe(2);
    expect(state.remainingMs).toBe(9000);
    const next = tick(state, 9000);
    const transition = reduceTour(next, { type: 'loaded', stopId: stops[1], requestId: next.requestId });
    expect(reduceTour(transition, { type: 'arrived', stopId: stops[1], requestId: next.requestId }).remainingMs).toBe(10000);
  });

  it('applies a new dwell preference to the next stop without resetting the current countdown', () => {
    const state = reduceTour(tick(dwelling(), 1000), { type: 'settings', settings: { dwellSeconds: 20 } });
    expect(state.remainingMs).toBe(9000);
    const next = tick(state, 9000);
    const transition = reduceTour(next, { type: 'loaded', stopId: stops[1], requestId: next.requestId });
    expect(reduceTour(transition, { type: 'arrived', stopId: stops[1], requestId: next.requestId }).remainingMs).toBe(20000);
  });

  it('interrupts automatic playback when the user starts dragging', () => {
    const state = dwelling();
    const manual = reduceTour(state, { type: 'manual' });
    expect(manual.status).toBe('manual');
    expect(tick(manual, 60000)).toBe(manual);
    expect(reduceTour(manual, { type: 'arrived', stopId: stops[0], requestId: state.requestId })).toBe(manual);
    expect(reduceTour(manual, play)).toMatchObject({ status: 'loading', stopId: 'museum-exterior' });
  });

  it('suspends hidden tabs without using background time to skip places', () => {
    const hidden = reduceTour(tick(dwelling(), 2500), { type: 'hidden' });
    expect(hidden).toMatchObject({ status: 'paused', remainingMs: 7500 });
    expect(tick(hidden, 3600000)).toBe(hidden);
    expect(reduceTour(hidden, play)).toMatchObject({ status: 'dwelling', stopId: 'museum-exterior', remainingMs: 7500 });
  });

  it('stops while retaining the last selection and ignores late completion', () => {
    const state = dwelling(stops[1]);
    const stopped = reduceTour(state, { type: 'stop' });
    expect(stopped).toMatchObject({ status: 'idle', stopId: 'park-lake', remainingMs: 0, resumePhase: null });
    expect(tick(stopped, 60000)).toBe(stopped);
    expect(reduceTour(stopped, { type: 'error', stopId: stops[1], requestId: state.requestId })).toBe(stopped);
  });

  it('cancels old loading, arrival and dwell events when a new stop is selected', () => {
    const old = dwelling();
    const latest = reduceTour(old, { type: 'select', stopId: stops[2] });
    expect(latest).toMatchObject({ status: 'loading', stopId: 'market-stalls', remainingMs: 10000 });
    for (const type of ['loaded', 'arrived', 'error'] as const) {
      expect(reduceTour(latest, { type, stopId: stops[0], requestId: old.requestId })).toBe(latest);
      expect(reduceTour(latest, { type, stopId: stops[2], requestId: old.requestId })).toBe(latest);
    }
    expect(reduceTour(latest, { type: 'tick', elapsedMs: 60000, eligibleStopIds: stops, requestId: old.requestId })).toBe(latest);
  });

  it('invalidates callbacks even when the user reselects the same stop', () => {
    const old = reduceTour(createTourState(stops[0]), play);
    const selected = reduceTour(old, { type: 'select', stopId: stops[0] });
    expect(reduceTour(selected, { type: 'loaded', stopId: stops[0], requestId: old.requestId })).toBe(selected);
  });

  it('does not start playing when selecting a place while stopped or paused', () => {
    expect(reduceTour(createTourState(stops[0]), { type: 'select', stopId: stops[1] }))
      .toMatchObject({ status: 'idle', stopId: 'park-lake', remainingMs: 0 });
    const selected = reduceTour(reduceTour(dwelling(), { type: 'pause' }), { type: 'select', stopId: stops[1] });
    expect(selected).toMatchObject({ status: 'paused', resumePhase: 'loading', stopId: 'park-lake', remainingMs: 10000 });
    expect(reduceTour(selected, play).status).toBe('loading');
  });

  it('advances only once when a large elapsed time exceeds the whole itinerary', () => {
    const before = dwelling();
    const next = tick(before, 3600000);
    expect(next).toMatchObject({ status: 'loading', stopId: 'park-lake', remainingMs: 10000 });
    expect(tick(next, 3600000)).toBe(next);
    expect(reduceTour(next, { type: 'tick', elapsedMs: 3600000, eligibleStopIds: stops, requestId: before.requestId })).toBe(next);
  });

  it('ends at the last stop by default and repeats only when explicitly enabled', () => {
    expect(tick(dwelling(stops[2]), 10000)).toMatchObject({ status: 'idle', stopId: 'market-stalls', remainingMs: 0 });
    const looping = reduceTour(dwelling(stops[2]), { type: 'settings', settings: { repeat: true } });
    expect(tick(looping, 10000)).toMatchObject({ status: 'loading', stopId: 'museum-exterior' });
  });

  it('next obeys pause and idle intent instead of starting a hidden tour', () => {
    expect(reduceTour(dwelling(), { type: 'next', eligibleStopIds: stops }))
      .toMatchObject({ status: 'loading', stopId: 'park-lake' });
    expect(reduceTour(reduceTour(dwelling(), { type: 'pause' }), { type: 'next', eligibleStopIds: stops }))
      .toMatchObject({ status: 'paused', stopId: 'park-lake', resumePhase: 'loading' });
    expect(reduceTour(createTourState(stops[0]), { type: 'next', eligibleStopIds: stops }))
      .toMatchObject({ status: 'idle', stopId: 'park-lake' });
  });

  it('stops on every filter reconciliation, clearing only an excluded selection', () => {
    const state = dwelling();
    expect(reduceTour(state, { type: 'reconcile', eligibleStopIds: stops.slice(0, 2) }))
      .toMatchObject({ status: 'idle', stopId: 'museum-exterior', remainingMs: 0 });
    expect(reduceTour(state, { type: 'reconcile', eligibleStopIds: [stops[2]] }))
      .toMatchObject({ status: 'idle', stopId: null, remainingMs: 0 });
    expect(reduceTour(state, { type: 'reconcile', eligibleStopIds: [] }).status).toBe('idle');
  });

  it('does not advance stale filtered selections even if reconciliation has not run yet', () => {
    const state = dwelling();
    expect(tick(state, 10000, [stops[2]])).toMatchObject({ status: 'idle', stopId: null });
    expect(tick(state, 10000, [])).toMatchObject({ status: 'idle', stopId: null });
  });

  it('ignores non-finite or negative elapsed time', () => {
    const state = dwelling();
    for (const elapsedMs of [NaN, Infinity, -1, 0]) expect(tick(state, elapsedMs)).toBe(state);
  });

  it('rejects failure from another stop, but surfaces a current failure and allows retry', () => {
    const state = reduceTour(createTourState(stops[0]), play);
    expect(reduceTour(state, { type: 'error', stopId: stops[1], requestId: state.requestId })).toBe(state);
    const failed = reduceTour(state, { type: 'error', stopId: stops[0], requestId: state.requestId });
    expect(failed).toMatchObject({ status: 'error', stopId: 'museum-exterior', remainingMs: 0 });
    expect(tick(failed, 60000)).toBe(failed);
    expect(reduceTour(failed, play).status).toBe('loading');
  });
});

describe('untrusted tour preferences', () => {
  it('falls back safely for missing, malformed, oversized and non-object storage', () => {
    for (const raw of [null, '', '{broken', 'null', '[]', 'true', '42', '"text"', 'x'.repeat(100000)]) {
      expect(decodeTourSettings(raw)).toEqual({ speed: 1, dwellSeconds: 10, labels: true, tourists: true, motion: true, repeat: false, traffic: true, density: 1, peopleScale: 1.7 });
    }
  });

  it('restores valid preferences without restoring playback or arbitrary fields', () => {
    const settings = decodeTourSettings(JSON.stringify({ speed: 1.5, dwellSeconds: 15, labels: false, tourists: false, motion: false, repeat: true, status: 'dwelling', remainingMs: 3000 }));
    expect(settings).toEqual({ speed: 1.5, dwellSeconds: 15, labels: false, tourists: false, motion: false, repeat: true, traffic: true, density: 1, peopleScale: 1.7 });
    expect(createTourState(stops[0], settings)).toMatchObject({ status: 'idle', remainingMs: 0, resumePhase: null });
  });

  it('bounds numeric preferences without coercing strings or non-finite values', () => {
    expect(decodeTourSettings('{"speed":900,"dwellSeconds":1}')).toMatchObject({ speed: 2, dwellSeconds: 6 });
    expect(decodeTourSettings('{"speed":-20,"dwellSeconds":300}')).toMatchObject({ speed: 0.5, dwellSeconds: 30 });
    expect(decodeTourSettings('{"speed":"2","dwellSeconds":1e999,"labels":"false","tourists":0,"motion":null,"repeat":1}'))
      .toEqual({ speed: 1, dwellSeconds: 10, labels: true, tourists: true, motion: true, repeat: false, traffic: true, density: 1, peopleScale: 1.7 });
  });

  it('validates settings changes while preserving existing valid preferences', () => {
    const state = createTourState(stops[0], { ...defaultTourSettings(), speed: 1.5, labels: false });
    const updated = reduceTour(state, { type: 'settings', settings: { speed: NaN, dwellSeconds: Infinity, tourists: false } });
    expect(updated.settings).toEqual({ speed: 1.5, dwellSeconds: 10, labels: false, tourists: false, motion: true, repeat: false, traffic: true, density: 1, peopleScale: 1.7 });
  });
});


describe('city population preferences', () => {
  it('restores older saves with lively defaults without starting playback', () => {
    expect(decodeTourSettings('{"tourists":false}')).toMatchObject({ tourists: false, traffic: true, density: 1, peopleScale: 1.7 });
  });
  it('bounds population cost and person size and rejects invalid stored types', () => {
    expect(decodeTourSettings('{"traffic":false,"density":100,"peopleScale":-10}')).toMatchObject({ traffic: false, density: 2, peopleScale: 1 });
    expect(decodeTourSettings('{"traffic":"false","density":null,"peopleScale":"2"}')).toMatchObject({ traffic: true, density: 1, peopleScale: 1.7 });
    expect(decodeTourSettings('{"density":0,"peopleScale":900}')).toMatchObject({ density: .5, peopleScale: 2.5 });
  });
});
