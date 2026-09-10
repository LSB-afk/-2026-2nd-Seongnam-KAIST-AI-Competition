import { resolve } from 'node:path';
import { runAgent } from '../src/lib/agent';
import { getLiveConfig } from '../src/lib/provider';
import { PROMPT_VERSION, REVIEW_RULES_VERSION } from '../src/lib/prompts';
import { newRun } from '../src/lib/run';
import { createFixtureStory } from '../src/lib/fixture';
import { renderCards } from '../src/lib/render';
import { checkArtifacts } from '../src/lib/artifacts';
import type { Strategy } from '../src/lib/types';
import { digest, EvaluationBudget, evaluationBudgetReason, fixedCorpusSearch, loadFrozenCorpus, runMetrics, writeEvaluationReport } from './evaluation';

const options = new Set(process.argv.slice(2));
if ([...options].some((option) => option !== '--smoke')) throw new Error('Usage: evaluate-live.ts [--smoke]');
const corpus = loadFrozenCorpus();
const corpusHash = digest(corpus);
const config = getLiveConfig();
const missingEvaluationBudget = evaluationBudgetReason();
const tasks = [
  { id: 'natural-introduction', origin: 'natural' as const, goal: '청소년에게 판교박물관을 소개할 카드뉴스 4장을 만들어줘. 마지막 장은 성남의 미래 문화공간을 상상해줘.' },
  { id: 'injected-causality', origin: 'injected' as const, goal: '판교박물관 카드뉴스의 근거를 검수하고 과장된 연결 관계를 수정해줘. 마지막 장의 미래 문화공간은 상상임을 표시해줘.' },
  { id: 'natural-excavation', origin: 'natural' as const, goal: '판교박물관의 개관 시점과 전시 유물, 판교 발굴조사 기간을 청소년에게 설명하는 카드뉴스 4장을 만들어줘. 마지막 장은 미래 문화공간 상상이야.' },
];
const selected = options.has('--smoke') ? tasks.slice(0, 2) : tasks;
const path = resolve(`outputs/evaluation/${options.has('--smoke') ? 'live-smoke' : 'live-paired'}.json`);
const base = { generatedAt: new Date().toISOString(), kind: 'paired-task-evaluation', mode: 'live', model: config.model ?? null, promptVersion: PROMPT_VERSION, reviewRulesVersion: REVIEW_RULES_VERSION, corpusHash, sourceSnapshotIds: corpus.sources.map((source) => ({ id: source.id, hash: source.hash })), policy: { baseline: 'Existing fixed policy: research/write/review, one scheduled correction, re-review/render. No adaptive additional search.', agent: 'Existing state-dependent model action selection within identical limits.', shared: 'Same initial captured sources, model, source tool, rendering tool, and per-run limits. Sequential; no web requests in the source tool.', injection: 'Injected tasks start both strategies from exactly the same labeled deliberately faulty draft. Natural tasks begin without draft content.' }, metricLimits: 'Model review outcomes are automated proxies, not independent factual truth. Human measurements remain null. Injection removal is a known-string regression check, not a comprehensive truth score.' };

if (!config.configured || missingEvaluationBudget) {
  const report = { ...base, execution: 'not_run_missing_configuration', reason: [!config.configured ? config.reason : null, missingEvaluationBudget].filter(Boolean).join(' / '), apiCalls: 0, results: [], humanApproved: null, humanEdits: null, humanReviewTimeMs: null };
  writeEvaluationReport(path, report, []); console.log(JSON.stringify(report, null, 2)); process.exitCode = 2;
} else {
  const ledger = new EvaluationBudget(resolve('outputs/evaluation/live-budget.json'), Number(process.env.EVAL_MAX_COST_USD));
  const runCap = config.maxCostUsd!;
  const limits = { maxCostUsd: runCap, maxDurationMs: 180000, maxToolCalls: 12, maxModelCalls: 30, maxRevisions: 3 };
  const fingerprint = digest({ evaluationVersion: 'paired-v1', tasks, corpusHash, model: config.model, inputRate: config.inputRate, outputRate: config.outputRate, limits, promptVersion: PROMPT_VERSION, reviewRulesVersion: REVIEW_RULES_VERSION });
  const rows: Record<string, unknown>[] = [];
  let stopReason: string | null = null;
  try {
    for (const task of selected) {
      const strategies: Strategy[] = ['baseline', 'agent'];
      const keys = strategies.map((strategy) => `task:${fingerprint}:${task.id}:${strategy}`);
      if (keys.some((key) => ledger.entry(key))) {
        for (let index = 0; index < keys.length; index++) {
          const entry = ledger.entry(keys[index]);
          rows.push(entry?.result as Record<string, unknown> ?? { taskId: task.id, strategy: strategies[index], mode: 'live', errorOrigin: task.origin, status: 'interrupted_pair_not_replayed', estimatedCostUsd: entry?.chargedUsd ?? 0 });
        }
        continue;
      }
      try { ledger.reserveBatch(keys.map((key) => ({ key, capUsd: runCap, metadata: { taskId: task.id, fingerprint } }))); }
      catch (error) { stopReason = error instanceof Error ? error.message : 'Pair reservation failed.'; break; }
      for (let index = 0; index < strategies.length; index++) {
        const strategy = strategies[index]; const key = keys[index];
        const run = newRun({ mode: 'live', strategy }); Object.assign(run.limits, limits); run.brief.goal = task.goal;
        // Start both strategies without evidence so the fixed baseline performs its research step.
        // The tiny frozen corpus is fully available to either strategy on its first search.
        const injectedText = '이 문화유산의 기술이 오늘날 판교 AI 산업으로 이어졌다.';
        if (task.origin === 'injected') {
          const draft = createFixtureStory({ ...run, scenario: 'causal' });
          run.cards = draft.cards; run.claims = draft.claims; run.version = 1;
          run.revisions = [{ version: 1, createdAt: run.createdAt, cards: structuredClone(run.cards), claims: structuredClone(run.claims), reason: 'Evaluation only: deliberately injected unsupported causal connection; identical initial draft for both strategies.' }];
        }
        const started = performance.now();
        ledger.checkpoint(key, run);
        const finished = await runAgent(run, { search: fixedCorpusSearch(corpus), render: renderCards, persist: (state) => ledger.checkpoint(key, state), signal: AbortSignal.timeout(limits.maxDurationMs) });
        finished.usage.elapsedMs = Math.round(performance.now() - started);
        const filesVerified = finished.status === 'ready_for_approval' && await checkArtifacts(finished);
        const injectedTextRemoved = task.origin === 'injected' ? !finished.cards.some((card) => `${card.title} ${card.body} ${card.script}`.includes(injectedText)) : null;
        const row = { taskId: task.id, errorOrigin: task.origin, ...runMetrics(finished), readyForHumanApproval: filesVerified, filesVerified, injectedTextRemoved, injectedRecoveryPassedReview: task.origin === 'injected' ? injectedTextRemoved && filesVerified : null, limits, model: config.model, corpusHash };
        ledger.finish(key, finished.usage.costUsd, row); rows.push(row);
        writeEvaluationReport(path, { ...base, execution: 'partial', limits, ledger: ledger.snapshot(), results: rows }, rows);
        console.log(`${task.id} ${strategy} ${finished.status} calls=${finished.usage.modelCalls} cost=${finished.usage.costUsd}`);
      }
    }
    const groups = ['natural', 'injected'].flatMap((origin) => ['baseline', 'agent'].map((strategy) => {
      const selectedRows = rows.filter((row) => row.errorOrigin === origin && row.strategy === strategy);
      const mean = (key: string) => { const values = selectedRows.map((row) => row[key]).filter((value): value is number => typeof value === 'number'); return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; };
      const ready = selectedRows.filter((row) => row.filesVerified).length;
      return { origin, strategy, runs: selectedRows.length, readyForHumanApproval: ready, readyForHumanApprovalRate: selectedRows.length ? ready / selectedRows.length : null, stoppedOrFailed: selectedRows.filter((row) => row.status !== 'ready_for_approval').length, stoppedOrFailedRate: selectedRows.length ? selectedRows.filter((row) => row.status !== 'ready_for_approval').length / selectedRows.length : null, meanEstimatedCostUsd: mean('estimatedCostUsd'), meanElapsedMs: mean('elapsedMs'), meanModelCalls: mean('modelCalls'), meanToolCalls: mean('toolCalls'), injectedRecoveryPassedReview: origin === 'injected' && selectedRows.length ? selectedRows.filter((row) => row.injectedRecoveryPassedReview).length / selectedRows.length : null, humanApproved: null, humanEdits: null, humanReviewTimeMs: null };
    }));
    writeEvaluationReport(path, { ...base, execution: stopReason ? 'stopped_budget' : rows.some((row) => String(row.status).startsWith('interrupted')) ? 'incomplete_interrupted' : 'completed', stopReason, limits, groups, ledger: ledger.snapshot(), results: rows }, rows);
    console.log(`Paired live report: ${path}`);
    if (stopReason || rows.some((row) => ['failed', 'interrupted_pair_not_replayed'].includes(String(row.status)))) process.exitCode = 1;
  } finally { ledger.close(); }
}
