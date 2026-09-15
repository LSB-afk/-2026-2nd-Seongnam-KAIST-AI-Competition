import { cityStoryBriefSchema } from "./city-story";
import { randomUUID } from "node:crypto";
import { getPlace } from "./places";
import { PURPOSES } from "./purposes";
import { PROMPT_VERSION, REVIEW_RULES_VERSION } from "./prompts";
import type { Run, Mode, Scenario, Strategy, Brief } from "./types";
export const DEFAULT_BRIEF: Brief = {
  placeId: "pangyo-museum",
  place: "판교박물관",
  audience: "청소년",
  readingStyle: "standard",
  goal: "청소년에게 판교박물관을 소개할 카드뉴스 4장을 만들어줘. 마지막 장에는 성남의 미래 문화공간을 상상하는 내용을 넣어줘.",
  cardCount: 4,
  includeFuture: true,
};
export function newRun(options: {
  mode: Mode;
  scenario?: Scenario;
  strategy?: Strategy;
  brief?: Brief;
}): Run {
  const at = new Date().toISOString();
  const brief = structuredClone(options.brief ?? DEFAULT_BRIEF);
  if (brief.story) {
    brief.story = cityStoryBriefSchema.parse(brief.story);
    if (getPlace(brief.placeId ?? brief.place)?.id !== brief.story.stops[0].placeId) throw new Error("대표 장소는 이야기의 첫 장소여야 합니다.");
  }
  brief.readingStyle ??= "standard";
  if (!["standard", "easy"].includes(brief.readingStyle)) throw new Error("지원하지 않는 설명 방식입니다.");
  if (brief.purpose !== undefined && !PURPOSES.some(purpose => purpose.id === brief.purpose)) throw new Error("등록되지 않은 제작 목적입니다.");
  const place = getPlace(brief.placeId ?? brief.place);
  if (!place || (brief.place && getPlace(brief.place)?.id !== place.id)) throw new Error("등록된 관광지 ID와 장소명이 일치해야 합니다.");
  brief.placeId = place.id;
  brief.place = place.name;
  return {
    id: randomUUID(),
    brief,
    submittedReadingStyle: brief.readingStyle,
    mode: options.mode,
    strategy: options.strategy ?? "agent",
    scenario: options.scenario ?? "normal",
    status: "queued",
    createdAt: at,
    updatedAt: at,
    version: 0,
    reviewVersion: null,
    sources: [],
    evidence: [],
    cards: [],
    claims: [],
    issues: [],
    revisions: [],
    events: [],
    artifacts: [],
    usage: {
      toolCalls: 0,
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      costKind: options.mode === "fixture" ? "fixture" : "estimated",
    },
    limits: {
      maxToolCalls: 12,
      maxRevisions: 3,
      maxDurationMs: 180000,
      maxModelCalls: 30,
      maxCostUsd: Number(process.env.MAX_COST_USD) || 0.5,
    },
    approval: null,
    stopReason: null,
    searches: [],
    assessments: [],
    reviews: [],
    automaticRevisions: 0,
    protectedCardIds: [],
    proposedChanges: [],
    modelCallLog: [],
    execution: {
      model: options.mode === "live" ? (process.env.ANTHROPIC_MODEL ?? null) : null,
      promptVersion: PROMPT_VERSION,
      reviewRulesVersion: REVIEW_RULES_VERSION,
      sourceSnapshotIds: [],
      apiCalls: 0,
    },
  };
}

/** The immutable brief, never model output, determines each card's source and photo scope. */
export function storyStopForCard(run: Run, cardId: string) {
  const index = ["card-1", "card-2", "card-3", "card-4"].indexOf(cardId);
  const story = run.brief.story;
  return story && index >= 0 ? story.stops.find(stop => stop.id === story.cardStopIds[index]) : undefined;
}
export function cardPlace(run: Run, cardId: string) {
  const stop = storyStopForCard(run, cardId);
  if (run.brief.story && !stop) throw new Error("이야기 카드의 장소 배정이 없습니다.");
  const place = getPlace(stop?.placeId ?? run.brief.placeId ?? run.brief.place);
  if (!place) throw new Error("등록되지 않은 관광지입니다.");
  return place;
}
export function missingStoryStops(run: Run) {
  return run.brief.story?.stops.filter(stop => !run.evidence.some(evidence =>
    run.sources.some(source => source.id === evidence.sourceId && source.placeId === stop.placeId && source.status === "ok"))) ?? [];
}
