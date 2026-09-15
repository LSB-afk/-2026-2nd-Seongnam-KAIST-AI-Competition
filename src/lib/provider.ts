import { cardPlace, storyStopForCard } from "./run";
import { randomUUID } from "node:crypto";
import { getPlace } from "./places";
import { z } from "zod";
import { PROMPT_VERSION, REVIEW_RULES_VERSION, DECISION_PROMPT, COMPOSE_PROMPT, REVIEW_PROMPT } from "./prompts";
import { atomicReviewSchema, validateAtomicReview } from "./verifier";
import type { Card, Claim, Decision, ReviewIssue, Run } from "./types";

export class AgentLimitError extends Error {}
export function getLiveConfig(): {
  configured: boolean;
  reason: string;
  model?: string;
  inputRate?: number;
  outputRate?: number;
  maxCostUsd?: number;
} {
  const names = [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_INPUT_USD_PER_MILLION",
    "ANTHROPIC_OUTPUT_USD_PER_MILLION",
    "MAX_COST_USD",
  ] as const;
  const missing = names.filter((name) => !process.env[name]?.trim());
  if (missing.length)
    return {
      configured: false,
      reason: `live 실행 설정 필요: ${missing.join(", ")}`,
      model: process.env.ANTHROPIC_MODEL,
    };
  const inputRate = Number(process.env.ANTHROPIC_INPUT_USD_PER_MILLION);
  const outputRate = Number(process.env.ANTHROPIC_OUTPUT_USD_PER_MILLION);
  const maxCostUsd = Number(process.env.MAX_COST_USD);
  if (
    ![inputRate, outputRate, maxCostUsd].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return {
      configured: false,
      reason: "입력·출력 단가와 비용 상한은 0보다 큰 유한한 값이어야 합니다.",
    };
  return {
    configured: true,
    reason: "live 설정이 준비되었습니다. 실제 API 연결은 실행 시 확인합니다.",
    model: process.env.ANTHROPIC_MODEL,
    inputRate,
    outputRate,
    maxCostUsd,
  };
}

function apiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(apiSchema);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (
        [
          "$schema",
          "minLength",
          "maxLength",
          "minimum",
          "maximum",
          "exclusiveMinimum",
          "exclusiveMaximum",
          "minItems",
          "maxItems",
          "pattern",
          "format",
        ].includes(key)
      )
        continue;
      result[key] = apiSchema(entry);
    }
    if (result.type === "object") result.additionalProperties = false;
    return result;
  }
  return value;
}

/** No implicit retries: decisions, drafting and reviews all pass this durable budget boundary. */
export async function callModel<T>(run: Run, signal: AbortSignal, schema: z.ZodType<T>, system: string, input: string, maxTokens = 2400, onUsage?: () => void): Promise<T> {
  signal.throwIfAborted();
  const config = getLiveConfig();
  if (!config.configured) throw new Error(config.reason);
  if (run.usage.modelCalls >= run.limits.maxModelCalls) throw new AgentLimitError("모델 호출 상한에 도달했습니다.");
  const body = JSON.stringify({ model: config.model, max_tokens: maxTokens, system, messages: [{ role: "user", content: input }], output_config: { format: { type: "json_schema", schema: apiSchema(z.toJSONSchema(schema)) } } });
  const inputBound = Buffer.byteLength(body, "utf8") + 2048;
  const reservedCost = (inputBound * config.inputRate! + maxTokens * config.outputRate!) / 1_000_000;
  const costCap = Math.min(run.limits.maxCostUsd, config.maxCostUsd!);
  if (run.usage.costUsd + reservedCost > costCap) throw new AgentLimitError("다음 모델 호출의 예약 비용이 남은 비용 상한을 초과합니다.");
  run.execution ??= { model: config.model!, promptVersion: PROMPT_VERSION, reviewRulesVersion: REVIEW_RULES_VERSION, sourceSnapshotIds: (run.sources ?? []).map((source) => source.id), apiCalls: 0 };
  run.execution.model = config.model!;
  run.execution.promptVersion = PROMPT_VERSION;
  run.execution.reviewRulesVersion = REVIEW_RULES_VERSION;
  const role = system === DECISION_PROMPT ? "decision" : system === COMPOSE_PROMPT ? "compose" : system === REVIEW_PROMPT ? "review" : "custom";
  const record = { id: randomUUID(), at: new Date().toISOString(), model: config.model!, promptVersion: `${PROMPT_VERSION}/${role}`, status: "reserved" as "reserved" | "succeeded" | "failed", reservedCostUsd: reservedCost, costUsd: reservedCost, inputTokens: undefined as number | undefined, outputTokens: undefined as number | undefined, error: undefined as string | undefined };
  (run.modelCallLog ??= []).push(record);
  run.usage.modelCalls += 1;
  run.usage.costUsd += reservedCost;
  run.usage.costKind = "estimated";
  onUsage?.(); // Crash recovery retains a conservative reservation before any external request.
  let safeFailure = "모델 API 통신 실패. 사용량 미확인 예약 비용을 유지합니다.";
  try {
    signal.throwIfAborted();
    let request: Promise<Response>;
    try {
      request = fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", ...(process.env.ANTHROPIC_WORKSPACE_ID?.trim() ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID.trim() } : {}) }, body, signal });
    } finally {
      run.execution.apiCalls += 1; // Only the actual fetch boundary counts as an attempted API call.
      onUsage?.();
    }
    const response = await request;
    if (!response.ok) { safeFailure = `모델 API 오류 (${response.status}). 사용량 미확인 호출은 예약 비용을 유지합니다.`; throw new Error(safeFailure); }
    safeFailure = "모델 API 응답 JSON을 해석할 수 없어 예약 비용을 유지합니다.";
    const data = await response.json() as { stop_reason?: string; content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } };
    const inputTokens = data.usage?.input_tokens;
    const outputTokens = data.usage?.output_tokens;
    safeFailure = "모델 API 사용량을 확인할 수 없어 예약 비용을 유지합니다.";
    if (typeof inputTokens !== "number" || typeof outputTokens !== "number" || ![inputTokens, outputTokens].every((value) => Number.isSafeInteger(value) && value >= 0)) throw new Error(safeFailure);
    if (data.usage?.cache_creation_input_tokens || data.usage?.cache_read_input_tokens) { safeFailure = "설정하지 않은 캐시 과금이 감지되어 실행을 중단합니다."; throw new Error(safeFailure); }
    run.usage.inputTokens += inputTokens;
    run.usage.outputTokens += outputTokens;
    const actualCost = (inputTokens * config.inputRate! + outputTokens * config.outputRate!) / 1_000_000;
    run.usage.costUsd = Math.max(0, run.usage.costUsd - reservedCost) + actualCost;
    Object.assign(record, { inputTokens, outputTokens, costUsd: actualCost });
    onUsage?.(); // Settle before refusal, truncation or local schema validation can fail.
    if (run.usage.costUsd > costCap) throw new AgentLimitError("API 보고 사용량이 비용 상한을 초과했습니다. 추가 호출을 중단합니다.");
    if (data.stop_reason !== "end_turn") { safeFailure = `모델 응답을 완료하지 못했습니다: ${["refusal", "max_tokens", "stop_sequence", "tool_use", "pause_turn"].includes(data.stop_reason ?? "") ? data.stop_reason : "unknown"}`; throw new Error(safeFailure); }
    const texts = data.content?.filter((block) => block.type === "text");
    safeFailure = "모델의 구조화된 텍스트 응답이 없습니다.";
    if (!texts || texts.length !== 1 || !texts[0].text) throw new Error(safeFailure);
    safeFailure = "모델 구조화 응답의 JSON 또는 스키마 검증에 실패했습니다.";
    const parsed = schema.parse(JSON.parse(texts[0].text));
    record.status = "succeeded";
    onUsage?.();
    return parsed;
  } catch (error) {
    record.status = "failed";
    record.error = signal.aborted ? "모델 API 호출이 취소되거나 시간 상한에 도달했습니다." : error instanceof AgentLimitError ? error.message : safeFailure;
    onUsage?.();
    if (error instanceof AgentLimitError) throw error;
    if (signal.aborted) throw signal.reason;
    throw new Error(record.error);
  }
}

const short = z.string().min(1).max(1000);
const id = z.string().min(1).max(100);
const ids = z.array(id).max(40);
export const decisionSchema = z
  .object({
    action: z.enum([
      "search_sources",
      "compose_story",
      "verify_content",
      "render_cards",
      "finish",
      "escalate",
    ]),
    targetIds: ids,
    evidenceIds: ids,
    reasonSummary: short,
    uncertainty: z.string().max(1000),
    blockedReason: z.string().max(1000),
    expectedVersion: z.number().int().nonnegative(),
    search: z.object({
    placeId: z.string().max(100).optional(), query: short, targetClaimIds: ids, missingInformation: z.array(short).min(1).max(12), reason: short }).strict().nullable(),
  })
  .strict();
const claimSchema = z
  .object({
    id,
    cardId: id,
    text: z.string().min(1).max(1500),
    kind: z.enum(["fact", "analogy", "imagination"]),
    evidenceIds: ids,
    support: z.enum([
      "supported",
      "insufficient",
      "contradicted",
      "not_applicable",
    ]),
  })
  .strict();
const cardSchema = z
  .object({
    id,
    title: z.string().min(1).max(100),
    body: z.string().min(1).max(1500),
    script: z.string().min(1).max(2500),
    claimIds: ids,
    imagination: z.boolean(),
  })
  .strict();
export const storySchema = z
  .object({
    cards: z.array(cardSchema).length(4),
    claims: z.array(claimSchema).min(4).max(32),
  })
  .strict();
export const reviewSchema = atomicReviewSchema;

function context(run: Run) {
  const currentIds = new Set([
    "run",
    ...run.cards.map((card) => card.id),
    ...run.claims.map((claim) => claim.id),
    ...run.evidence.map((evidence) => evidence.id),
  ]);
  const pendingIssues = run.issues
    .filter((issue) => !issue.resolved)
    .map((issue) => {
      if (currentIds.has(issue.targetId)) return issue;
      const oldClaim = [...run.revisions]
        .reverse()
        .flatMap((revision) => revision.claims)
        .find((claim) => claim.id === issue.targetId);
      const targetId =
        oldClaim && run.cards.some((card) => card.id === oldClaim.cardId)
          ? oldClaim.cardId
          : "run";
      return {
        ...issue,
        targetId,
        message: `[이전 버전 대상 ${issue.targetId}; 재검수 전 미해결] ${issue.message}`,
        evidenceIds: issue.evidenceIds.filter((id) =>
          run.evidence.some((evidence) => evidence.id === id),
        ),
      };
    });
  return {
    brief: { ...run.brief, readingStyle: run.readingStyleChange?.status === "requested" ? "easy" : run.brief.readingStyle ?? "standard" },
    readingStyleChange: run.readingStyleChange,
    readingStyleOriginal: run.readingStyleChange?.status === "applied"
      ? run.revisions.find(revision => revision.version === run.readingStyleChange!.expectedVersion)
      : undefined,
    selectedPlaces: run.brief.story?.stops.map(stop => getPlace(stop.placeId)),
    cardPlan: run.brief.story ? ["card-1", "card-2", "card-3", "card-4"].map(id => ({ cardId: id, placeId: cardPlace(run, id).id, stopId: storyStopForCard(run, id)!.id, imagination: id === "card-4" })) : undefined,
    selectedPlace: getPlace(run.brief.placeId ?? run.brief.place ?? ""),
    goal: run.brief?.goal,
    searches: run.searches ?? [],
    protectedCardIds: run.protectedCardIds ?? [],
    assessments: run.assessments ?? [],
    automaticRevisions: run.automaticRevisions ?? 0,
    version: run.version,
    reviewVersion: run.reviewVersion,
    evidence: run.evidence,
    sources: run.sources.map(({ id, placeId, title, url, status, retrievedAt, publishedAt, modifiedAt }) => ({
      placeId,
      id,
      title,
      url,
      status, retrievedAt, publishedAt, modifiedAt,
    })),
    cards: run.cards,
    claims: run.claims,
    issues: pendingIssues,
    usage: run.usage,
    limits: run.limits,
    recentEvents: run.events.slice(-5),
    artifacts: run.artifacts.map(({ name, version, reviewVersion }) => ({
      name,
      version,
      reviewVersion,
    })),
  };
}
function rejectModelResult(run: Run, message: string, onUsage?: () => void): never {
  const record = run.modelCallLog?.at(-1);
  if (record) { record.status = "failed"; record.error = message; onUsage?.(); }
  throw new Error(message);
}
export async function decideLive(run: Run, signal: AbortSignal, onUsage?: () => void): Promise<Decision> {
  const result = await callModel(run, signal, decisionSchema, DECISION_PROMPT, JSON.stringify(context(run)), 1400, onUsage);
  if (result.expectedVersion !== run.version) rejectModelResult(run, "모델 결정이 현재 콘텐츠 버전과 일치하지 않습니다.", onUsage);
  if ((result.action === "search_sources") !== (result.search !== null)) rejectModelResult(run, "검색 행동에는 구체적인 검색 의도가 필요하며 다른 행동에는 search=null이어야 합니다.", onUsage);
  if (result.search?.targetClaimIds.some((id) => !run.claims.some((claim) => claim.id === id))) rejectModelResult(run, "검색 대상 Claim ID가 현재 버전에 없습니다.", onUsage);
  return result;
}
export async function composeLive(run: Run, signal: AbortSignal, onUsage?: () => void): Promise<{ cards: Card[]; claims: Claim[] }> {
  return callModel(run, signal, storySchema, COMPOSE_PROMPT, JSON.stringify(context(run)), 3600, onUsage);
}
export async function verifyLive(run: Run, signal: AbortSignal, onUsage?: () => void): Promise<ReviewIssue[]> {
  // Failed/incomplete review must never leave a previous supported verdict active.
  run.assessments = [];
  for (const claim of run.claims) if (claim.kind === "fact") claim.support = "insufficient";
  const raw = await callModel(run, signal, reviewSchema, REVIEW_PROMPT, JSON.stringify(context(run)), 9000, onUsage);
  let review: ReturnType<typeof validateAtomicReview>;
  try { review = validateAtomicReview(run, raw); }
  catch (error) { rejectModelResult(run, error instanceof Error ? error.message : "원자 검수 결과의 무결성 검증 실패", onUsage); }
  run.assessments = review.assessments;
  for (const claim of run.claims) {
    const assessments = review.assessments.filter((assessment) => assessment.claimId === claim.id);
    if (assessments.some((assessment) => assessment.verdict === "contradicted")) claim.support = "contradicted";
    else if (assessments.some((assessment) => assessment.verdict === "insufficient")) claim.support = "insufficient";
    else if (claim.kind === "fact") {
      claim.support = assessments.length ? "supported" : "insufficient";
      if (!assessments.length) review.issues.push({ id: `${run.version}:${claim.id}:model_unsupported`, targetId: claim.id, type: "model_unsupported", severity: "error", message: "등록된 사실에 대한 독립 원자 검수가 없습니다.", evidenceIds: claim.evidenceIds, recommendation: "제목·본문·대본의 사실을 다시 추출하고 원문과 대조하세요.", resolved: false });
    } else claim.support = "not_applicable";
  }
  return review.issues;
}
