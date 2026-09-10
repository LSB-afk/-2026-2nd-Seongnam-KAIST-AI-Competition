import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvaluationBudget, buildTargetInput, claimMetrics, loadClaimDataset, runMetrics, loadFrozenCorpus, fixedCorpusSearch, evaluationBudgetReason } from '../scripts/evaluation';
import { newRun } from '../src/lib/run';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
function ledgerPath() { const directory = mkdtempSync(join(tmpdir(), 'timestory-eval-')); directories.push(directory); return join(directory, 'budget.json'); }

describe('evaluation data and truthful metrics', () => {
  it('contains balanced draft labels and evidence-family separated holdout cases', () => {
    const { inputs, labels } = loadClaimDataset();
    expect(inputs.length).toBeGreaterThanOrEqual(30);
    for (const split of ['dev', 'holdout']) {
      const selected = inputs.filter((input) => input.split === split);
      const counts = ['supported', 'contradicted', 'insufficient'].map((verdict) => selected.filter((input) => labels.find((label) => label.id === input.id)?.verdict === verdict).length);
      expect(counts[0]).toBeGreaterThan(0); expect(new Set(counts).size).toBe(1);
    }
    const devFamilies = new Set(inputs.filter((input) => input.split === 'dev').map((input) => input.family));
    expect(inputs.filter((input) => input.split === 'holdout').some((input) => devFamilies.has(input.family))).toBe(false);
    expect(labels.every((label) => !label.humanReviewed && label.status === 'draft' && !!label.reason)).toBe(true);
    for (const verdict of ['supported', 'contradicted', 'insufficient']) {
      const counts = ['title', 'body', 'script'].map((field) => inputs.filter((input) => input.field === field && labels.find((label) => label.id === input.id)?.verdict === verdict).length);
      expect(new Set(counts).size).toBe(1);
    }
  });
  it('whitelists target fields so labels, reasons, split, and family cannot leak', () => {
    const input = loadClaimDataset().inputs[0];
    const target = buildTargetInput({ ...input, verdict: 'SECRET_VERDICT', reason: 'SECRET_REASON', humanReviewed: false });
    expect(Object.keys(target).sort()).toEqual(['asOf', 'claim', 'evidence', 'field']);
    expect(JSON.stringify(target)).not.toMatch(/SECRET|humanReviewed|holdout|family|"split"/);
  });
  it('computes confusion, error acceptance and false blocking against draft labels without human claims', () => {
    const labels = [
      { id: 'a', verdict: 'supported' as const, reason: 'draft', status: 'draft' as const, humanReviewed: false as const },
      { id: 'b', verdict: 'contradicted' as const, reason: 'draft', status: 'draft' as const, humanReviewed: false as const },
      { id: 'c', verdict: 'insufficient' as const, reason: 'draft', status: 'draft' as const, humanReviewed: false as const },
    ];
    const metrics = claimMetrics(labels, [{ id: 'a', verdict: 'contradicted' }, { id: 'b', verdict: 'supported' }, { id: 'c', verdict: null }], 'live');
    expect(metrics.confusion.supported.contradicted).toBe(1);
    expect(metrics.accuracy).toBe(0); expect(metrics.responseCoverage).toBeCloseTo(2 / 3);
    expect(metrics.falseBlockRate).toBe(1); expect(metrics.unsupportedAcceptedRate).toBe(0.5);
    expect(metrics.humanApproved).toBeNull(); expect(metrics.humanReviewTimeMs).toBeNull();
    expect(metrics.labelStatus).toBe('draft');
    expect(claimMetrics(labels, [], 'fixture').liveModelQualityMeasured).toBe(false);
  });
  it('reports real run counters and leaves unmeasured correction/human outcomes null', () => {
    const run = newRun({ mode: 'fixture' }); run.status = 'ready_for_approval';
    run.usage.modelCalls = 2; run.usage.costUsd = 0.12;
    const metrics = runMetrics(run);
    expect(metrics.modelCalls).toBe(2); expect(metrics.estimatedCostUsd).toBe(0.12);
    expect(metrics.humanApproved).toBeNull(); expect(metrics.correctionSuccessRate).toBeNull();
    expect(metrics.liveModelQualityMeasured).toBe(false);
  });
  it('gives both strategies identical frozen evidence and measures newly acquired evidence without web', async () => {
    const corpus = loadFrozenCorpus(); const search = fixedCorpusSearch(corpus);
    const a = newRun({ mode: 'live', strategy: 'baseline' }); const b = newRun({ mode: 'live', strategy: 'agent' });
    a.evidence = structuredClone(corpus.evidence.slice(0, 2)); b.evidence = structuredClone(a.evidence);
    const decision = { action: 'search_sources' as const, targetIds: [], evidenceIds: [], reasonSummary: '발굴 기간 확인', uncertainty: '', search: { query: '판교 발굴 기간', targetClaimIds: [], missingInformation: ['발굴 기간'], reason: 'missing' } };
    const one = await search(a, decision, new AbortController().signal); const two = await search(b, decision, new AbortController().signal);
    expect(one.sources).toEqual(two.sources); expect(one.search?.newEvidenceCount).toBe(1); expect(two.search?.newEvidenceCount).toBe(1);
    expect(one.evidence.map(({ id, quote }) => ({ id, quote }))).toEqual(two.evidence.map(({ id, quote }) => ({ id, quote })));
    a.evidence = one.evidence; const repeated = await search(a, decision, new AbortController().signal); expect(repeated.search?.newEvidenceCount).toBe(0);
    expect(corpus.evidence).not.toEqual(one.evidence); // Search annotations do not mutate the captured corpus.
  });
});

describe('persisted total evaluation budget', () => {
  it('requires an explicit positive total budget instead of silently enabling paid calls', () => {
    for (const value of ['', '0', '-1', 'Infinity', 'abc']) expect(evaluationBudgetReason(value)).toContain('EVAL_MAX_COST_USD');
    expect(evaluationBudgetReason('1')).toBeNull();
  });
  it('reserves a whole pair atomically and blocks spending beyond total cap', () => {
    const ledger = new EvaluationBudget(ledgerPath(), 1);
    try {
      expect(() => ledger.reserveBatch([{ key: 'a', capUsd: 0.6 }, { key: 'b', capUsd: 0.6 }])).toThrow(/budget/i);
      expect(ledger.snapshot().entries).toHaveLength(0);
      ledger.reserveBatch([{ key: 'a', capUsd: 0.4 }, { key: 'b', capUsd: 0.4 }]);
      expect(() => ledger.reserveBatch([{ key: 'c', capUsd: 0.3 }])).toThrow(/budget/i);
    } finally { ledger.close(); }
  });
  it('retains interrupted reservations across restart without permitting implicit replay', () => {
    const path = ledgerPath(); const first = new EvaluationBudget(path, 1);
    first.reserveBatch([{ key: 'pending', capUsd: 0.8 }]); first.checkpoint('pending', { costUsd: 0.03, modelCalls: 1 }); first.close();
    const resumed = new EvaluationBudget(path, 1);
    try {
      expect(resumed.snapshot().committedUsd).toBe(0.8);
      expect(() => resumed.reserveBatch([{ key: 'pending', capUsd: 0.1 }])).toThrow(/exists/i);
      expect(() => resumed.reserveBatch([{ key: 'next', capUsd: 0.3 }])).toThrow(/budget/i);
      expect(resumed.entry('pending')?.checkpoint).toEqual({ costUsd: 0.03, modelCalls: 1 });
    } finally { resumed.close(); }
  });
  it('settles known run usage, persists results, and rejects concurrent writers', () => {
    const path = ledgerPath(); const ledger = new EvaluationBudget(path, 1);
    try {
      expect(() => new EvaluationBudget(path, 1)).toThrow(/running|lock/i);
      ledger.reserveBatch([{ key: 'done', capUsd: 0.8 }]);
      ledger.finish('done', 0.12, { status: 'failed', humanApproved: null });
      expect(ledger.snapshot().committedUsd).toBe(0.12);
      expect(ledger.entry('done')?.result).toEqual({ status: 'failed', humanApproved: null });
      expect(() => ledger.checkpoint('done', {})).toThrow(/finished/i);
    } finally { ledger.close(); }
  });
});
