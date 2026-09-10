import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runAgent } from "../src/lib/agent";
import { newRun } from "../src/lib/run";
import { searchSources } from "../src/lib/sources";
import { renderCards } from "../src/lib/render";
import { checkArtifacts } from "../src/lib/artifacts";
import type { Scenario, Strategy } from "../src/lib/types";
import { runMetrics } from './evaluation';

const scenarios: Scenario[] = [
  "normal",
  "causal",
  "future",
  "mismatch",
  "unavailable",
  "persistent",
];
const results = [];
for (const scenario of scenarios)
  for (const strategy of ["baseline", "agent"] as Strategy[]) {
    const run = newRun({ mode: "fixture", scenario, strategy });
    const started = performance.now();
    const finished = await runAgent(run, {
      search: searchSources,
      render: renderCards,
      persist: () => {},
      signal: AbortSignal.timeout(run.limits.maxDurationMs),
    });
    const verified =
      finished.status === "ready_for_approval" &&
      (await checkArtifacts(finished));
    finished.usage.elapsedMs = Math.round(performance.now() - started);
    const row = {
      ...runMetrics(finished),
      scenario,
      strategy,
      mode: "fixture",
      runId: run.id,
      status: finished.status,
      readyForHumanApproval: verified,
      humanApproved: null,
      humanEdits: null,
      humanReviewTimeMs: null,
      toolCalls: finished.usage.toolCalls,
      searchCalls: finished.events.filter((e) => e.action === "search_sources")
        .length,
      revisions: finished.revisions.length,
      remainingReviewIssues: finished.issues.filter((i) => !i.resolved).length,
      resolvedReviewIssues: finished.issues.filter((i) => i.resolved).length,
      elapsedMs: Math.round(performance.now() - started),
      modelCalls: finished.usage.modelCalls,
      apiCostUsd: finished.usage.costUsd,
      stopReason: finished.stopReason,
    };
    results.push(row);
    console.log(
      `${strategy.padEnd(8)} ${scenario.padEnd(12)} ${row.status.padEnd(20)} tools=${row.toolCalls} ${row.elapsedMs}ms`,
    );
  }
const report = {
  generatedAt: new Date().toISOString(),
  scope:
    "Deterministic fixture integration comparison with real PNG/ZIP rendering. Not evidence of live LLM quality or human productivity.",
  sources: "Same captured museum excerpts and source tool in both strategies.",
  results,
};
await mkdir("outputs/evaluation", { recursive: true });
await writeFile(
  "outputs/evaluation/results.json",
  JSON.stringify(report, null, 2),
);
const columns = Object.keys(results[0]) as (keyof (typeof results)[number])[];
const escape = (value: unknown) =>
  `"${String(value ?? "").replaceAll('"', '""')}"`;
await writeFile(
  "outputs/evaluation/results.csv",
  [
    columns.join(","),
    ...results.map((r) => columns.map((c) => escape(r[c])).join(",")),
  ].join("\n") + "\n",
);
console.log(
  `\nFixture integration report: ${resolve("outputs/evaluation/results.json")}`,
);
if (
  results.some(
    (r) =>
      ["normal", "causal", "future", "mismatch"].includes(r.scenario) &&
      !r.readyForHumanApproval,
  ) ||
  results.some(
    (r) =>
      ["unavailable", "persistent"].includes(r.scenario) &&
      r.readyForHumanApproval,
  )
)
  process.exitCode = 1;
