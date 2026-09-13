import { describe, expect, it } from "vitest";
import { PLACES } from "../src/lib/places";
import { newRun } from "../src/lib/run";
import {
  getGuideAdvice, getGuideSnapshot, getStepGuard, getStepTarget, initialGuideState,
  restoreGuide, restoreGuideStorage, transitionGuide, type GuideContext, type GuideState,
} from "../src/lib/guide";

function context(overrides: Partial<GuideContext> = {}): GuideContext {
  return { view: "dashboard", selectedPlace: null, draftPlace: PLACES[0], run: null, busy: false, error: "", tab: "evidence", selectedCardId: "", ...overrides };
}
function tutorial(step: number, extra: Partial<GuideState> = {}): GuideState {
  return { ...initialGuideState(), status: "active", step, placeId: PLACES[0].id, ...extra };
}
function reviewedContext(): GuideContext {
  const run = newRun({ mode: "fixture", brief: { place: PLACES[0].name, placeId: PLACES[0].id, audience: "청소년", goal: "관광 안내", cardCount: 4, includeFuture: true } });
  run.version = 2; run.reviewVersion = 2; run.status = "ready_for_approval";
  run.cards = Array.from({ length: 4 }, (_, i) => ({ id: `card-${i + 1}`, title: "장소", body: "안내", script: "", claimIds: [], imagination: i === 3 }));
  return context({ view: "studio", selectedPlace: PLACES[0], run });
}

describe("state-driven tutorial", () => {
  it("starts only when explicitly requested and never assumes an existing selection was just made", () => {
    const snapshot = getGuideSnapshot(context({ view: "explore", selectedPlace: PLACES[0] }));
    const idle = initialGuideState();
    expect(transitionGuide(idle, { type: "observe", before: snapshot }, snapshot)).toEqual(idle);
    const started = transitionGuide(idle, { type: "start" }, snapshot);
    expect(started).toMatchObject({ step: 0, status: "active" });
    expect(transitionGuide(started, { type: "observe", before: snapshot }, snapshot)).toEqual(started);
  });
  it("advances one step on an actual navigation or selection change", () => {
    const before = getGuideSnapshot(context());
    const exploring = getGuideSnapshot(context({ view: "explore" }));
    const step1 = transitionGuide(tutorial(0), { type: "observe", before }, exploring);
    expect(step1.step).toBe(1);
    const selected = getGuideSnapshot(context({ view: "explore", selectedPlace: PLACES[0] }));
    expect(transitionGuide(step1, { type: "observe", before: exploring }, selected)).toMatchObject({ step: 2, placeId: PLACES[0].id });
  });
  it("does not bounce forward after previous, resume, or a stable state observation", () => {
    const snapshot = getGuideSnapshot(reviewedContext());
    const back = transitionGuide(tutorial(6, { runId: snapshot.runId }), { type: "previous" }, snapshot);
    expect(back.step).toBe(5);
    expect(transitionGuide(back, { type: "observe", before: snapshot }, snapshot)).toEqual(back);
    const paused = transitionGuide(back, { type: "pause" }, snapshot);
    expect(transitionGuide(paused, { type: "observe", before: getGuideSnapshot(context()) }, snapshot)).toEqual(paused);
    expect(transitionGuide(paused, { type: "resume" }, snapshot)).toMatchObject({ step: 5, status: "active" });
  });
  it("requires the selected place official link event before continuing", () => {
    const snapshot = getGuideSnapshot(context({ view: "explore", selectedPlace: PLACES[0] }));
    const state = tutorial(2);
    expect(getStepGuard(state, snapshot)).toContain("공식");
    expect(transitionGuide(state, { type: "source-opened", placeId: PLACES[1].id }, snapshot)).toEqual(state);
    expect(transitionGuide(state, { type: "next" }, snapshot)).toEqual(state);
    expect(transitionGuide(state, { type: "source-opened", placeId: PLACES[0].id }, snapshot)).toMatchObject({ step: 3, sourcePlaceId: PLACES[0].id });
  });
  it("clears an old source visit when a different place is selected", () => {
    const before = getGuideSnapshot(context({ view: "explore", selectedPlace: PLACES[0] }));
    const after = getGuideSnapshot(context({ view: "explore", selectedPlace: PLACES[1] }));
    expect(transitionGuide(tutorial(3, { sourcePlaceId: PLACES[0].id }), { type: "observe", before }, after))
      .toMatchObject({ step: 2, placeId: PLACES[1].id, sourcePlaceId: null, runId: null });
  });
  it("does not treat a different place draft or existing run as this tutorial's creation", () => {
    const wrongDraft = getGuideSnapshot(context({ view: "studio", selectedPlace: PLACES[0], draftPlace: PLACES[1] }));
    expect(getStepGuard(tutorial(3), wrongDraft)).toContain("선택한 장소");
    const created = reviewedContext(); created.run!.brief.placeId = PLACES[1].id;
    expect(getStepGuard(tutorial(4), getGuideSnapshot(created))).toContain("선택한 장소");
  });
  it("waits for the user-created run to finish and then binds to that exact run", () => {
    const beforeContext = reviewedContext(); beforeContext.run!.status = "running"; beforeContext.busy = true;
    const before = getGuideSnapshot(beforeContext);
    expect(getStepGuard(tutorial(4), before)).toContain("진행");
    const after = getGuideSnapshot({ ...beforeContext, busy: false, run: { ...beforeContext.run!, status: "ready_for_approval" } });
    expect(transitionGuide(tutorial(4), { type: "observe", before }, after)).toMatchObject({ step: 5, runId: after.runId });
  });
  it("allows card reading without mandatory edits but blocks unresolved review", () => {
    const current = reviewedContext(); const snapshot = getGuideSnapshot(current);
    expect(transitionGuide(tutorial(5, { runId: snapshot.runId }), { type: "next" }, snapshot).step).toBe(6);
    current.run!.issues = [{ id: "issue", targetId: "card-1", type: "fact", severity: "error", message: "근거 부족", evidenceIds: [], recommendation: "수정", resolved: false }];
    const blocked = getGuideSnapshot(current);
    expect(getStepGuard(tutorial(6), blocked)).toContain("검수");
    expect(transitionGuide(tutorial(6), { type: "next" }, blocked).step).toBe(6);
  });
  it("requires current-version review and explicit current-version approval for download", () => {
    const current = reviewedContext(); current.run!.reviewVersion = 1;
    expect(getStepGuard(tutorial(6), getGuideSnapshot(current))).toContain("검수");
    current.run!.reviewVersion = 2;
    const awaiting = getGuideSnapshot(current);
    expect(getStepTarget(tutorial(7), awaiting)).toBe("approve-panel");
    expect(transitionGuide(tutorial(7), { type: "download-opened" }, awaiting).status).toBe("active");
    current.run!.status = "approved"; current.run!.approval = { version: 2, reviewer: "사용자", at: "2026-09-13" };
    current.run!.artifacts = [{ name: "cards.zip", path: "cards.zip", sha256: "hash", version: 2, reviewVersion: 2, kind: "zip" }];
    const approved = getGuideSnapshot(current);
    expect(getStepTarget(tutorial(7), approved)).toBe("download");
    expect(transitionGuide(tutorial(7), { type: "download-opened" }, approved).status).toBe("completed");
    current.run!.version = 3;
    expect(transitionGuide(tutorial(7), { type: "download-opened" }, getGuideSnapshot(current)).status).toBe("active");
  });
  it("skip and restart are explicit and preserve the application snapshot", () => {
    const snapshot = getGuideSnapshot(reviewedContext()); const original = structuredClone(snapshot);
    const skipped = transitionGuide(tutorial(6), { type: "skip" }, snapshot);
    expect(skipped.status).toBe("skipped");
    expect(transitionGuide(skipped, { type: "restart" }, snapshot)).toEqual({ ...initialGuideState(), status: "active" });
    expect(snapshot).toEqual(original);
  });
});

describe("safe guide restoration", () => {
  it.each(["not json", "null", '{"version":99}', '{"version":1,"tutorial":{"step":999}}'])
    ("handles damaged local data without starting a tour: %s", (raw) => {
      const restored = restoreGuideStorage(raw, getGuideSnapshot(context()));
      expect(restored.tutorial).toEqual(initialGuideState());
      expect(restored.preferences).toEqual({ minimized: false, animationOff: false, invitationDismissed: false });
    });
  it("resumes in paused mode and clamps missing selection/run or invalidated review", () => {
    expect(restoreGuide(tutorial(6), getGuideSnapshot(context()))).toMatchObject({ step: 1, status: "paused", runId: null });
    expect(restoreGuide(tutorial(6), getGuideSnapshot(context({ selectedPlace: PLACES[0], view: "studio" })))).toMatchObject({ step: 4, status: "paused" });
    const current = reviewedContext(); current.run!.reviewVersion = 1;
    expect(restoreGuide(tutorial(7, { runId: current.run!.id }), getGuideSnapshot(current))).toMatchObject({ step: 6, status: "paused" });
  });
  it("does not carry source confirmation or run identity to a replacement place", () => {
    const restored = restoreGuide(tutorial(7, { sourcePlaceId: PLACES[0].id, runId: "old" }), getGuideSnapshot(context({ selectedPlace: PLACES[1], draftPlace: PLACES[1], view: "explore" })));
    expect(restored).toMatchObject({ step: 2, sourcePlaceId: null, runId: null, placeId: PLACES[1].id });
  });
  it("preserves preferences and safely bounded tutorial state", () => {
    const current = reviewedContext();
    const raw = JSON.stringify({ version: 1, tutorial: tutorial(5, { runId: current.run!.id }), preferences: { minimized: true, animationOff: true, invitationDismissed: true } });
    const restored = restoreGuideStorage(raw, getGuideSnapshot(current));
    expect(restored.preferences).toEqual({ minimized: true, animationOff: true, invitationDismissed: true });
    expect(restored.tutorial).toMatchObject({ step: 5, status: "paused" });
  });
});

describe("context advice without model calls", () => {
  it("maps real selection, running, problem card, approval and completed states to useful actions", () => {
    expect(getGuideAdvice(context()).action).toBe("explore");
    expect(getGuideAdvice(context({ view: "explore", selectedPlace: PLACES[0] })).action).toBe("studio");
    expect(getGuideAdvice(context({ busy: true })).mood).toBe("working");
    const current = reviewedContext();
    current.run!.issues = [{ id: "i", targetId: "card-2", type: "fact", severity: "error", message: "근거 부족", evidenceIds: [], recommendation: "확인", resolved: false }];
    expect(getGuideAdvice(current)).toMatchObject({ mood: "error", action: "review", cardId: "card-2" });
    current.run!.issues = [];
    expect(getGuideAdvice(current).action).toBe("approve");
    current.run!.status = "approved"; current.run!.approval = { version: 2, reviewer: "사용자", at: "now" };
    current.run!.artifacts = [{ name: "cards.zip", path: "cards.zip", sha256: "hash", version: 2, reviewVersion: 2, kind: "zip" }];
    expect(getGuideAdvice(current)).toMatchObject({ mood: "success", action: "download" });
  });
});
