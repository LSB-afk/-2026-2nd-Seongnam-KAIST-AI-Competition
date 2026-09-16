import type { Run } from "./types";

type BudgetRun = Pick<Run, "usage" | "limits" | "automaticRevisions">;

/** Tool calls a clean re-review needs after a person changes content: verify_content + render_cards. */
export const RE_REVIEW_TOOL_CALLS = 2;
/** Tool calls an easy-reading rewrite needs: compose_story + verify_content + render_cards. */
export const SIMPLIFY_TOOL_CALLS = 3;

function shortfall(run: BudgetRun, toolCalls: number): string | null {
  const left = run.limits.maxToolCalls - run.usage.toolCalls;
  if (left < toolCalls)
    return `남은 도구 호출이 ${Math.max(0, left)}회라 다시 검수하는 데 필요한 ${toolCalls}회를 쓸 수 없습니다.`;
  if (run.usage.modelCalls >= run.limits.maxModelCalls) return "모델 호출 상한에 도달했습니다.";
  if (run.usage.costUsd >= run.limits.maxCostUsd) return "실행 비용 상한에 도달했습니다.";
  if ((run.usage.elapsedMs ?? 0) >= run.limits.maxDurationMs) return "누적 실행 시간 상한에 도달했습니다.";
  return null;
}

/** Why a person's text or photo change must be refused: it would invalidate approval with no budget left to re-review. */
export function editBlockReason(run: BudgetRun): string | null {
  const reason = shortfall(run, RE_REVIEW_TOOL_CALLS);
  return reason && `${reason} 수정하면 다시 승인할 수 없어 현재 결과를 그대로 유지합니다. 더 고치려면 새 제작을 시작하세요.`;
}

/** Why a re-review cannot start: it would stop at the limit before producing reviewed files. */
export function retryBlockReason(run: BudgetRun): string | null {
  const reason = shortfall(run, RE_REVIEW_TOOL_CALLS);
  return reason && `${reason} 새 제작을 시작하세요.`;
}

/** Why an easy-reading rewrite cannot start. */
export function simplifyBlockReason(run: BudgetRun): string | null {
  const reason =
    shortfall(run, SIMPLIFY_TOOL_CALLS) ??
    ((run.automaticRevisions ?? 0) >= run.limits.maxRevisions ? "자동 수정 횟수 상한에 도달했습니다." : null);
  return reason && `${reason} 새 제작을 시작하세요.`;
}
