import { randomUUID } from "node:crypto";
import { getPlace } from "./places";
import { PURPOSES } from "./purposes";
import { PROMPT_VERSION, REVIEW_RULES_VERSION } from "./prompts";
import type { Run, Mode, Scenario, Strategy, Brief } from "./types";
export const DEFAULT_BRIEF: Brief = {
  placeId: "pangyo-museum",
  place: "판교박물관",
  audience: "청소년",
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
  const brief = { ...(options.brief ?? DEFAULT_BRIEF) };
  if (brief.purpose !== undefined && !PURPOSES.some(purpose => purpose.id === brief.purpose)) throw new Error("등록되지 않은 제작 목적입니다.");
  const place = getPlace(brief.placeId ?? brief.place);
  if (!place || (brief.place && getPlace(brief.place)?.id !== place.id)) throw new Error("등록된 관광지 ID와 장소명이 일치해야 합니다.");
  brief.placeId = place.id;
  brief.place = place.name;
  return {
    id: randomUUID(),
    brief,
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
