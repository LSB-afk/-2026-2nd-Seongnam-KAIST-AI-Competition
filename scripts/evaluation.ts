import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { Run, SourceResult, AgentDeps } from '../src/lib/types';

export const verdicts = ['supported', 'contradicted', 'insufficient'] as const;
export type Verdict = typeof verdicts[number];
const documentSchema = z.object({ id: z.string(), text: z.string(), recordedAt: z.string(), origin: z.literal('synthetic_evaluation') }).strict();
const inputSchema = z.object({ id: z.string(), split: z.enum(['dev', 'holdout']), family: z.string(), category: z.string(), asOf: z.string(), field: z.enum(['title', 'body', 'script']), claim: z.string(), evidence: z.array(documentSchema) }).strict();
const labelSchema = z.object({ id: z.string(), verdict: z.enum(verdicts), reason: z.string(), status: z.literal('draft'), humanReviewed: z.literal(false) }).strict();
export type ClaimInput = z.infer<typeof inputSchema>;
export type DraftLabel = z.infer<typeof labelSchema>;
export interface Prediction { id: string; verdict: Verdict | null; }
export const fixtureDirectory = resolve('tests/fixtures/evaluation');
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function evaluationBudgetReason(value = process.env.EVAL_MAX_COST_USD): string | null {
  return value?.trim() && Number.isFinite(Number(value)) && Number(value) > 0 ? null : 'live 평가 설정 필요: EVAL_MAX_COST_USD (> 0)';
}

export function loadClaimDataset() {
  const inputs = z.array(inputSchema).parse(JSON.parse(readFileSync(resolve(fixtureDirectory, 'claim-inputs.json'), 'utf8')));
  const labels = z.array(labelSchema).parse(JSON.parse(readFileSync(resolve(fixtureDirectory, 'claim-labels.draft.json'), 'utf8')));
  if (new Set(inputs.map((input) => input.id)).size !== inputs.length || new Set(labels.map((label) => label.id)).size !== labels.length || inputs.length !== labels.length || inputs.some((input) => !labels.some((label) => label.id === input.id))) throw new Error('Evaluation case and label IDs do not match uniquely.');
  return { inputs, labels, hash: digest({ inputs, labels }) };
}

/** Construct explicitly, never spread input objects into the target model's prompt. */
export function buildTargetInput(input: ClaimInput & Record<string, unknown>) {
  return { asOf: input.asOf, field: input.field, claim: input.claim, evidence: input.evidence.map(({ id, text, recordedAt, origin }) => ({ id, text, recordedAt, origin })) };
}

const ratio = (numerator: number, denominator: number) => denominator ? numerator / denominator : null;
export function claimMetrics(labels: DraftLabel[], predictions: Prediction[], mode: 'fixture' | 'live') {
  const confusion = Object.fromEntries(verdicts.map((actual) => [actual, Object.fromEntries(verdicts.map((predicted) => [predicted, 0]))])) as Record<Verdict, Record<Verdict, number>>;
  const byId = new Map(predictions.map((prediction) => [prediction.id, prediction.verdict]));
  let correct = 0, answered = 0, falseBlocks = 0, unsupportedAccepted = 0;
  for (const label of labels) {
    const prediction = byId.get(label.id);
    if (!prediction) continue;
    answered += 1; confusion[label.verdict][prediction] += 1;
    if (label.verdict === prediction) correct += 1;
    if (label.verdict === 'supported' && prediction !== 'supported') falseBlocks += 1;
    if (label.verdict !== 'supported' && prediction === 'supported') unsupportedAccepted += 1;
  }
  return { mode, liveModelQualityMeasured: mode === 'live' && answered > 0, labelStatus: 'draft', humanReviewed: false, cases: labels.length, answered, unanswered: labels.length - answered, responseCoverage: ratio(answered, labels.length), accuracy: ratio(correct, labels.length), answeredAccuracy: ratio(correct, answered), confusion, falseBlockRate: ratio(falseBlocks, labels.filter((label) => label.verdict === 'supported').length), unsupportedAcceptedRate: ratio(unsupportedAccepted, labels.filter((label) => label.verdict !== 'supported').length), humanApproved: null, humanEdits: null, humanReviewTimeMs: null };
}

export function runMetrics(run: Run, options: { initialEvidenceProvided?: boolean } = {}) {
  const assessments = run.assessments ?? [];
  const searches = run.searches ?? [];
  const additionalSearches = options.initialEvidenceProvided ? searches : searches.slice(1);
  const reviewed = assessments.length > 0 && run.reviewVersion === run.version;
  return { runId: run.id, mode: run.mode, strategy: run.strategy, status: run.status, liveModelQualityMeasured: false, readyForHumanApproval: run.status === 'ready_for_approval', humanApproved: null, humanEdits: null, humanReviewTimeMs: null, correctionSuccessRate: null, independentlyVerifiedUnsupportedFinalRate: null, modelReportedUnsupportedFinalRate: reviewed ? ratio(assessments.filter((assessment) => assessment.verdict !== 'supported').length, assessments.length) : null, additionalSearchWithNewEvidenceRate: ratio(additionalSearches.filter((search) => search.newEvidenceCount > 0).length, additionalSearches.length), additionalSearchNewEvidenceCount: additionalSearches.reduce((sum, search) => sum + search.newEvidenceCount, 0), toolCalls: run.usage.toolCalls, modelCalls: run.usage.modelCalls, apiCalls: run.execution?.apiCalls ?? null, searchCalls: run.events.filter((event) => event.action === 'search_sources').length, automaticRevisions: run.automaticRevisions ?? null, contentVersions: run.version, inputTokens: run.usage.inputTokens, outputTokens: run.usage.outputTokens, estimatedCostUsd: run.usage.costUsd, costKind: run.usage.costKind, elapsedMs: run.usage.elapsedMs ?? null, remainingReviewIssues: run.issues.filter((issue) => !issue.resolved).length, stopReason: run.stopReason };
}

interface Reservation { key: string; capUsd: number; metadata?: unknown; }
interface LedgerEntry extends Reservation { status: 'reserved' | 'finished'; reservedAt: string; chargedUsd: number; checkpoint?: unknown; result?: unknown; finishedAt?: string; }
interface Ledger { version: 1; maxUsd: number; entries: LedgerEntry[]; }

/** One process owns the evaluation ledger; unfinished runs keep their FULL reservation. */
export class EvaluationBudget {
  private data: Ledger;
  private lockPath: string;
  private closed = false;
  constructor(private path: string, maxUsd: number) {
    if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error('EVAL_MAX_COST_USD must be a positive finite budget.');
    mkdirSync(dirname(path), { recursive: true }); this.lockPath = `${path}.lock`;
    if (existsSync(this.lockPath)) {
      const owner = JSON.parse(readFileSync(this.lockPath, 'utf8')) as { pid: number };
      let dead = false;
      try { process.kill(owner.pid, 0); } catch (error) { dead = (error as NodeJS.ErrnoException).code === 'ESRCH'; }
      if (!dead) throw new Error('An evaluation is already running (budget lock).');
      unlinkSync(this.lockPath);
    }
    const lock = openSync(this.lockPath, 'wx', 0o600);
    writeFileSync(lock, JSON.stringify({ pid: process.pid })); fsyncSync(lock); closeSync(lock);
    try {
      this.data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Ledger : { version: 1, maxUsd, entries: [] };
      if (this.data.version !== 1 || this.data.maxUsd !== maxUsd) throw new Error('Existing evaluation budget differs; retain its original EVAL_MAX_COST_USD.');
      if (!Array.isArray(this.data.entries) || this.data.entries.some((entry) => !Number.isFinite(entry.chargedUsd) || entry.chargedUsd < 0)) throw new Error('Invalid evaluation budget ledger.');
      this.save();
    } catch (error) { unlinkSync(this.lockPath); throw error; }
  }
  private save() {
    if (this.closed) throw new Error('Budget ledger is closed.');
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    const file = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(file, JSON.stringify(this.data, null, 2)); fsyncSync(file); } finally { closeSync(file); }
    renameSync(temporary, this.path);
    const directory = openSync(dirname(this.path), 'r'); try { fsyncSync(directory); } finally { closeSync(directory); }
  }
  snapshot() { return structuredClone({ ...this.data, committedUsd: this.data.entries.reduce((sum, entry) => sum + entry.chargedUsd, 0) }); }
  entry(key: string) { return structuredClone(this.data.entries.find((entry) => entry.key === key)); }
  reserveBatch(reservations: Reservation[]) {
    const keys = new Set<string>();
    for (const item of reservations) {
      if (!item.key || keys.has(item.key) || this.entry(item.key)) throw new Error('Evaluation reservation already exists; implicit replay is forbidden.');
      if (!Number.isFinite(item.capUsd) || item.capUsd <= 0) throw new Error('Invalid reservation budget.'); keys.add(item.key);
    }
    const nextTotal = this.snapshot().committedUsd + reservations.reduce((sum, item) => sum + item.capUsd, 0);
    if (nextTotal > this.data.maxUsd + 1e-10) throw new Error('Total evaluation budget cannot cover the next reservation.');
    this.data.entries.push(...reservations.map((item) => ({ ...item, status: 'reserved' as const, reservedAt: new Date().toISOString(), chargedUsd: item.capUsd })));
    this.save();
  }
  checkpoint(key: string, checkpoint: unknown) {
    const entry = this.data.entries.find((entry) => entry.key === key);
    if (!entry || entry.status !== 'reserved') throw new Error('Missing or finished evaluation reservation.');
    entry.checkpoint = structuredClone(checkpoint); this.save();
  }
  finish(key: string, costUsd: number, result: unknown) {
    const entry = this.data.entries.find((entry) => entry.key === key);
    if (!entry || entry.status !== 'reserved') throw new Error('Missing or finished evaluation reservation.');
    if (!Number.isFinite(costUsd) || costUsd < 0) throw new Error('Invalid settled evaluation cost.');
    entry.status = 'finished'; entry.chargedUsd = costUsd; entry.result = result; entry.finishedAt = new Date().toISOString(); this.save();
    if (costUsd > entry.capUsd) throw new Error('Reported cost exceeded reserved budget; no further evaluations may run.');
  }
  close() { if (!this.closed) { this.closed = true; unlinkSync(this.lockPath); } }
}

export function loadFrozenCorpus(): SourceResult {
  const corpus = JSON.parse(readFileSync(resolve(fixtureDirectory, 'museum-corpus.json'), 'utf8')) as SourceResult;
  for (const source of corpus.sources) if (createHash('sha256').update(source.snapshot).digest('hex') !== source.hash) throw new Error('Frozen source hash mismatch.');
  for (const evidence of corpus.evidence) {
    const source = corpus.sources.find((source) => source.id === evidence.sourceId);
    if (!source || source.snapshot.slice(evidence.start, evidence.end) !== evidence.quote) throw new Error('Frozen evidence position mismatch.');
  }
  return corpus;
}

/** Both strategies receive the same initial snapshot and the same deterministic corpus search. */
export function fixedCorpusSearch(corpus: SourceResult): AgentDeps['search'] {
  const frozen = structuredClone(corpus);
  return async (run, decision, signal) => {
    signal.throwIfAborted();
    const id = `eval-search-${run.id}-${run.events.filter((event) => event.action === 'search_sources').length}`;
    const evidence = structuredClone(frozen.evidence).map((item) => ({ ...item, searchId: id, targetClaimIds: decision.search?.targetClaimIds ?? decision.targetIds }));
    const newEvidence = evidence.filter((item) => !run.evidence.some((old) => old.id === item.id));
    return { sources: structuredClone(frozen.sources), evidence, search: { id, at: new Date().toISOString(), version: run.version, query: decision.search?.query ?? run.brief.goal, targetClaimIds: decision.search?.targetClaimIds ?? decision.targetIds, missingInformation: decision.search?.missingInformation ?? [], reason: decision.reasonSummary, visitedPages: frozen.sources.length, newEvidenceCount: newEvidence.length, evidenceIds: evidence.map((item) => item.id), resolvedClaimIds: [], remainingInformation: decision.search?.missingInformation ?? [], errors: [] } };
  };
}

export function writeEvaluationReport(path: string, report: Record<string, unknown>, rows: Record<string, unknown>[]) {
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(report, null, 2));
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value: unknown) => `"${(typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')).replaceAll('"', '""')}"`;
  writeFileSync(path.replace(/\.json$/, '.csv'), [columns.join(','), ...rows.map((row) => columns.map((column) => escape(row[column])).join(','))].join('\n') + '\n');
}
