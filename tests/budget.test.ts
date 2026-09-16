import { describe, expect, it } from "vitest";
import { newRun } from "../src/lib/run";
import { editBlockReason, retryBlockReason, simplifyBlockReason } from "../src/lib/budget";

function runWith(toolCalls: number) {
  const run = newRun({ mode: "fixture" });
  run.usage.toolCalls = toolCalls;
  return run;
}

describe("re-review budget", () => {
  it("allows an edit only while a full re-review still fits in the tool-call limit", () => {
    expect(editBlockReason(runWith(10))).toBeNull();
    expect(editBlockReason(runWith(11))).toContain("1회");
    expect(editBlockReason(runWith(12))).toContain("현재 결과를 그대로 유지");
  });
  it("refuses a re-review that would stop at the limit before producing files", () => {
    expect(retryBlockReason(runWith(10))).toBeNull();
    expect(retryBlockReason(runWith(11))).toContain("새 제작");
  });
  it("needs room for compose, review and render before an easy-reading rewrite", () => {
    expect(simplifyBlockReason(runWith(9))).toBeNull();
    expect(simplifyBlockReason(runWith(10))).toContain("3회");
    const revised = runWith(0);
    revised.automaticRevisions = revised.limits.maxRevisions;
    expect(simplifyBlockReason(revised)).toContain("자동 수정 횟수");
  });
  it("also stops on model-call, cost and duration limits", () => {
    const run = runWith(0);
    run.usage.elapsedMs = run.limits.maxDurationMs;
    expect(editBlockReason(run)).toContain("실행 시간");
    run.usage.elapsedMs = 0;
    run.usage.modelCalls = run.limits.maxModelCalls;
    expect(retryBlockReason(run)).toContain("모델 호출");
  });
});
