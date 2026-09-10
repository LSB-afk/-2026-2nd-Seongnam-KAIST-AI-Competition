import { mkdir, writeFile } from 'node:fs/promises';
import { newRun } from '../src/lib/run';
import { searchSources } from '../src/lib/sources';
import { mergeSearchResult } from '../src/lib/lifecycle';
import type { Decision } from '../src/lib/types';

// Public source retrieval only. This command never invokes a model or demonstrates AI judgement.
const query = process.argv.slice(2).join(' ').trim() || '판교박물관 관람료';
if (query.length > 1000) throw new Error('검색어는 1000자 이하여야 합니다.');
const run = newRun({ mode: 'live' });
function decision(searchQuery: string): Decision { return {
  action: 'search_sources', targetIds: [], evidenceIds: [],
  reasonSummary: '공식 자료 탐색 연결 확인', uncertainty: '후보 문장의 실제 지지 여부는 별도 검수 필요',
  expectedVersion: 0,
  search: { query: searchQuery, targetClaimIds: [], missingInformation: [searchQuery], reason: '공식 사이트에서 요청한 정보를 찾을 수 있는지 확인' },
}; }
const first = decision('판교박물관 개관일');
mergeSearchResult(run, await searchSources(run, first, AbortSignal.timeout(15000)), first, new Date().toISOString());
const initialEvidenceCount = run.evidence.length;
const followup = decision(query);
const result = await searchSources(run, followup, AbortSignal.timeout(15000));
const search = mergeSearchResult(run, result, followup, new Date().toISOString());
const report = { checkedAt: new Date().toISOString(), mode: 'source_probe', apiCalls: 0, modelJudgement: 'not_run', initialEvidenceCount, totalEvidenceCount: run.evidence.length, sources: run.sources, evidence: run.evidence, searches: run.searches, search };
await mkdir('outputs/evaluation', { recursive: true });
await writeFile('outputs/evaluation/source-probe.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ mode: report.mode, apiCalls: 0, modelJudgement: report.modelJudgement, initialEvidenceCount, totalEvidenceCount: report.totalEvidenceCount, visitedPages: search.visitedPages, newEvidenceCount: search.newEvidenceCount, evidence: result.evidence.map(({quote, sourceId}) => ({quote, url: run.sources.find(source => source.id === sourceId)?.url})), errors: search.errors }, null, 2));
if (!search.newEvidenceCount) process.exitCode = 1;
