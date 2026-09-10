import { describe, expect, it } from 'vitest';
import { runAgent } from '../src/lib/agent';
import { newRun } from '../src/lib/run';
import { fixtureSources } from '../src/lib/sources';
import { createFixtureStory } from '../src/lib/fixture';
import type { AgentDeps, Artifact, Run } from '../src/lib/types';

const deps = (): AgentDeps => ({
  signal: new AbortController().signal,
  persist: () => {},
  search: async () => fixtureSources(),
  render: async run => [
    ...[1,2,3,4].map(n => ({name:`card-${n}.png`,kind:'png'})),
    {name:'script.md',kind:'text'}, {name:'sources.json',kind:'json'}, {name:'review.json',kind:'json'}, {name:'timestory.zip',kind:'zip'},
  ].map(a=>({...a,path:a.name,sha256:'hash',version:run.version,reviewVersion:run.version})) as Artifact[],
});
function draft(): Run {
  const run = newRun({mode:'fixture',scenario:'causal'});
  Object.assign(run, fixtureSources(), createFixtureStory(run));
  run.version=1;
  run.revisions=[{version:1,createdAt:run.createdAt,cards:structuredClone(run.cards),claims:structuredClone(run.claims),reason:'draft'}];
  return run;
}
describe('evidence and revision lifecycle', () => {
  it('retains original snapshots when a targeted search adds another source', async () => {
    const run=draft(); const d=deps();
    d.search=async()=>({sources:[{...run.sources[0],id:'source-new',hash:'newhash',snapshot:'추가 공식 자료'}],evidence:[{id:'evidence-new',sourceId:'source-new',quote:'추가 공식 자료',locator:'body'}]});
    const result=await runAgent(run,d);
    expect(result.sources.map(s=>s.id)).toContain('source-faq');
    expect(result.sources.map(s=>s.id)).toContain('source-new');
    expect(result.evidence.map(e=>e.id)).toContain('evidence-opening');
    expect(result.status).toBe('ready_for_approval');
    expect(result.searches?.[0].newEvidenceCount).toBe(1);
  });
  it('keeps failed and successful reviews tied to immutable snapshots', async () => {
    const result=await runAgent(draft(),deps());
    expect(result.reviews?.map(r=>r.version)).toEqual([1,2]);
    expect(result.reviews?.[0].issues.some(i=>!i.resolved)).toBe(true);
    expect(result.reviews?.[1].issues).toEqual([]);
    expect(result.reviews?.[0].sourceSnapshotIds).toContain('source-faq');
  });
  it('does not consume automatic correction budget for human revisions', async () => {
    const run=draft();run.version=8;run.automaticRevisions=0;
    run.revisions=Array.from({length:8},(_,i)=>({...run.revisions[0],version:i+1,origin:'human'}));
    const result=await runAgent(run,deps());
    expect(result.status).toBe('ready_for_approval');
    expect(result.automaticRevisions).toBe(1);
  });
  it('leaves a correction proposal instead of replacing a protected human card', async () => {
    const run=draft();run.protectedCardIds=['card-3'];
    const before=structuredClone(run.cards[2]);
    const result=await runAgent(run,deps());
    expect(result.status).toBe('needs_review');
    expect(result.cards[2]).toEqual(before);
    expect(result.version).toBe(1);
    expect(result.proposedChanges?.[0].cardId).toBe('card-3');
    expect(result.proposedChanges?.[0].after.body).not.toBe(before.body);
    expect(result.approval).toBeNull();
  });
  it('preserves claim identity while correcting its text', async () => {
    const run=draft();run.claims[2].id='stable-user-claim';run.cards[2].claimIds=['stable-user-claim'];
    const result=await runAgent(run,deps());
    expect(result.status).toBe('ready_for_approval');
    expect(result.cards[2].claimIds).toEqual(['stable-user-claim']);
    expect(result.claims.find(c=>c.id==='stable-user-claim')?.text).toContain('2003');
  });
});

it('fails closed on a source ID collision instead of rewriting historical evidence', async()=>{
  const run=draft(); const original=structuredClone(run.sources[0]);const d=deps();
  d.search=async()=>({sources:[{...original,hash:'overwritten',snapshot:'다른 내용'}],evidence:[]});
  const result=await runAgent(run,d);
  expect(result.status).toBe('needs_review');expect(result.sources[0]).toEqual(original);
  expect(result.stopReason).toContain('덮어쓸');
});

it('blocks repeated searches without new evidence before consuming the remaining tool cap', async()=>{
  const run=draft();run.scenario='persistent';run.limits.maxToolCalls=30;run.limits.maxRevisions=10;
  const result=await runAgent(run,deps());
  expect(result.status).toBe('needs_review');expect(result.stopReason).toContain('같은 검색');
  expect(result.usage.toolCalls).toBeLessThan(30);
  expect(result.searches?.filter(s=>s.newEvidenceCount===0)).toHaveLength(2);
});

it('ignores unrelated card changes in a model partial patch and keeps its claim IDs', async()=>{
  const {applyStoryUpdate}=await import('../src/lib/lifecycle');
  const run=draft();run.mode='live';run.status='running';
  const before=structuredClone(run.cards[0]);
  const story=structuredClone({cards:run.cards,claims:run.claims});
  story.cards[0].title='관계없는 전체 재작성';
  story.cards[2].claimIds=['renamed-by-model'];
  story.claims[2].id='renamed-by-model';story.claims[2].text='새로 검수할 설명';
  story.cards[2].body=story.claims[2].text;story.cards[2].script=story.claims[2].text;
  applyStoryUpdate(run,story,{action:'compose_story',targetIds:['card-3'],evidenceIds:[],reasonSummary:'대상만 수정',uncertainty:'',expectedVersion:1},run.createdAt);
  expect(run.cards[0]).toEqual(before);
  expect(run.cards[2].claimIds).toEqual(['claim-excavation']);
});

it('rejects a stale model patch without changing content', async()=>{
  const {applyStoryUpdate}=await import('../src/lib/lifecycle');const run=draft();
  expect(()=>applyStoryUpdate(run,{cards:[],claims:[]},{action:'compose_story',targetIds:[],evidenceIds:[],reasonSummary:'old',uncertainty:'',expectedVersion:0},run.createdAt)).toThrow('버전');
  expect(run.version).toBe(1);expect(run.cards).toHaveLength(4);
});

it('does not widen a selected card correction to a different unresolved issue', async()=>{
  const {applyStoryUpdate}=await import('../src/lib/lifecycle');const run=draft();run.mode='live';run.status='running';
  const before=structuredClone(run.cards[1]);
  run.issues=[{id:'other',targetId:'card-2',type:'missing_evidence',severity:'error',message:'별도 문제',evidenceIds:[],recommendation:'확인',resolved:false}];
  const story=structuredClone({cards:run.cards,claims:run.claims});story.cards[1].title='지정하지 않은 변경';
  applyStoryUpdate(run,story,{action:'compose_story',targetIds:['card-1'],evidenceIds:[],reasonSummary:'1장만 수정',uncertainty:'',expectedVersion:1},run.createdAt);
  expect(run.cards[1]).toEqual(before);
});

it('preserves unchanged claim identity when a partial patch adds a new fact', async()=>{
  const {applyStoryUpdate}=await import('../src/lib/lifecycle');const run=draft();run.mode='live';run.status='running';
  const story=structuredClone({cards:run.cards,claims:run.claims});
  story.claims[0].id='regenerated-id';story.cards[0].claimIds=['regenerated-id','new-fact'];
  story.claims.push({...story.claims[0],id:'new-fact',text:'확인할 추가 사실'});
  story.cards[0].body+=' 확인할 추가 사실';story.cards[0].script+=' 확인할 추가 사실';
  applyStoryUpdate(run,story,{action:'compose_story',targetIds:['card-1'],evidenceIds:[],reasonSummary:'사실 추가',uncertainty:'',expectedVersion:1},run.createdAt);
  expect(run.cards[0].claimIds).toEqual(['claim-opening','new-fact']);
});

function multiClaimDraft() {
  const run = draft(); run.mode = 'live'; run.status = 'running';
  const other = { ...run.claims[0], id: 'claim-same-card-untargeted', text: '백제·고구려 시대 석실분을 소개합니다.', evidenceIds: ['evidence-exhibit'] };
  run.claims.push(other);
  run.cards[0].claimIds.push(other.id);
  run.cards[0].body += `\n${other.text}`;
  run.cards[0].script = run.cards[0].body;
  return run;
}
function targetedClaimStory(run: Run) {
  const story = structuredClone({ cards: run.cards, claims: run.claims });
  const before = run.claims[0].text;
  story.claims[0].text = '판교박물관은 2013년 4월 2일 개관했어요.';
  story.cards[0].body = story.cards[0].body.replace(before, story.claims[0].text);
  story.cards[0].script = story.cards[0].script.replace(before, story.claims[0].text);
  return story;
}

it('rejects changing an untargeted claim inside the same targeted card', async () => {
  const { applyStoryUpdate } = await import('../src/lib/lifecycle');
  const run = multiClaimDraft(); const before = structuredClone(run);
  const story = targetedClaimStory(run);
  const other = story.claims.find(claim => claim.id === 'claim-same-card-untargeted')!;
  const oldText = other.text; other.text = '백만 개의 유물을 보유합니다.';
  story.cards[0].body = story.cards[0].body.replace(oldText, other.text);
  story.cards[0].script = story.cards[0].script.replace(oldText, other.text);
  expect(() => applyStoryUpdate(run, story, { action: 'compose_story', targetIds: ['claim-opening'], evidenceIds: [], reasonSummary: '개관 문장만 수정', uncertainty: '', expectedVersion: 1 }, run.createdAt)).toThrow(/지정하지|대상|범위/);
  expect(run.cards).toEqual(before.cards); expect(run.claims).toEqual(before.claims); expect(run.version).toBe(1);
});

it('rejects an unrelated title change when only a body claim was targeted', async () => {
  const { applyStoryUpdate } = await import('../src/lib/lifecycle');
  const run = multiClaimDraft(); const story = targetedClaimStory(run);
  story.cards[0].title = '모델이 멋대로 바꾼 제목';
  expect(() => applyStoryUpdate(run, story, { action: 'compose_story', targetIds: ['claim-opening'], evidenceIds: [], reasonSummary: '개관 문장만 수정', uncertainty: '', expectedVersion: 1 }, run.createdAt)).toThrow(/지정하지|대상|범위/);
  expect(run.version).toBe(1);
});

it('allows a localized target-claim correction while preserving every unrelated fragment', async () => {
  const { applyStoryUpdate } = await import('../src/lib/lifecycle');
  const run = multiClaimDraft(); const otherBefore = structuredClone(run.claims.at(-1)); const titleBefore = run.cards[0].title;
  const story = targetedClaimStory(run);
  applyStoryUpdate(run, story, { action: 'compose_story', targetIds: ['claim-opening'], evidenceIds: [], reasonSummary: '개관 문장만 수정', uncertainty: '', expectedVersion: 1 }, run.createdAt);
  expect(run.cards[0].title).toBe(titleBefore);
  expect(run.claims.find(claim => claim.id === 'claim-same-card-untargeted')).toEqual(otherBefore);
  expect(run.cards[0].body).toBe(`${story.claims[0].text}\n${otherBefore!.text}`);
  expect(run.version).toBe(2);
});

it('allows full-card changes only when the card itself is explicitly targeted', async () => {
  const { applyStoryUpdate } = await import('../src/lib/lifecycle');
  const run = multiClaimDraft(); const story = targetedClaimStory(run); story.cards[0].title = '개관과 전시 안내';
  applyStoryUpdate(run, story, { action: 'compose_story', targetIds: ['card-1'], evidenceIds: [], reasonSummary: '첫 카드 구성 수정', uncertainty: '', expectedVersion: 1 }, run.createdAt);
  expect(run.cards[0].title).toBe('개관과 전시 안내');
});

it('requires explicit card scope for adding claims during a claim-only patch', async () => {
  const { applyStoryUpdate } = await import('../src/lib/lifecycle');
  const run = multiClaimDraft(); const story = targetedClaimStory(run);
  story.claims.push({ ...story.claims[0], id: 'extra-fact', text: '추가 주장' });
  story.cards[0].claimIds.push('extra-fact'); story.cards[0].body += '추가 주장'; story.cards[0].script += '추가 주장';
  expect(() => applyStoryUpdate(run, story, { action: 'compose_story', targetIds: ['claim-opening'], evidenceIds: [], reasonSummary: '개관 문장만 수정', uncertainty: '', expectedVersion: 1 }, run.createdAt)).toThrow('카드 단위');
  expect(run.version).toBe(1);
});

it('does not retain an earlier human proposal when another claim patch violates scope', async () => {
  const { applyStoryUpdate } = await import('../src/lib/lifecycle');
  const run = multiClaimDraft(); run.protectedCardIds = ['card-1']; const before = structuredClone(run);
  const story = targetedClaimStory(run); story.cards[2].title = '허용되지 않은 제목 변경';
  expect(() => applyStoryUpdate(run, story, { action: 'compose_story', targetIds: ['claim-opening', 'claim-excavation'], evidenceIds: [], reasonSummary: '지정 문장 수정', uncertainty: '', expectedVersion: 1 }, run.createdAt)).toThrow(/대상|구간/);
  expect(run).toEqual(before);
});
