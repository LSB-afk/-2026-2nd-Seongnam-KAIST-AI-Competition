import { expect, it } from 'vitest';
import { runAgent } from '../src/lib/agent';
import { DEFAULT_BRIEF, newRun } from '../src/lib/run';
import { searchSources } from '../src/lib/sources';
import { verifyContent } from '../src/lib/verifier';
import type { AgentDeps, Artifact, Brief, Run } from '../src/lib/types';

const story = {
  title: '공원에서 박물관까지',
  stops: [
    { id: 'park', placeId: 'yuldong-park', photoChoice: 'none' as const, note: '가족과 걸었던 기억은 사실 근거가 아닙니다.' },
    { id: 'museum', placeId: 'pangyo-museum', photoChoice: 'place' as const },
  ],
  cardStopIds: ['park', 'museum', 'park', 'museum'] as [string, string, string, string],
};
function makeRun() {
  return newRun({ mode: 'fixture', brief: { ...DEFAULT_BRIEF, placeId: 'yuldong-park', place: '율동공원', story } as Brief });
}
const dependencies: AgentDeps = {
  search: searchSources,
  render: async run => [
    ...[1, 2, 3, 4].map(i => ({ name: `card-${i}.png`, kind: 'png' })),
    { name: 'bundle.zip', kind: 'zip' }, { name: 'script.txt', kind: 'text' }, { name: 'review.json', kind: 'json' },
  ].map(item => ({ ...item, path: item.name, sha256: 'fixture-render', version: run.version, reviewVersion: run.version })) as Artifact[],
  persist: () => {}, signal: new AbortController().signal,
};
it('collects every stop in one budget and reviews four cards against their own place evidence', async () => {
  const run = await runAgent(makeRun(), dependencies);
  expect(run.status).toBe('ready_for_approval');
  expect(run.cards.map(card => (card as typeof card & { placeId: string }).placeId)).toEqual(['yuldong-park', 'pangyo-museum', 'yuldong-park', 'pangyo-museum']);
  expect(run.cards.map(card => (card as typeof card & { stopId: string }).stopId)).toEqual(['park', 'museum', 'park', 'museum']);
  expect(run.searches?.map(search => (search as typeof search & { placeId: string }).placeId)).toEqual(['yuldong-park', 'pangyo-museum']);
  for (const claim of run.claims.filter(claim => claim.kind === 'fact')) {
    const card = run.cards.find(card => card.id === claim.cardId)!;
    for (const id of claim.evidenceIds) {
      const evidence = run.evidence.find(item => item.id === id)!;
      const source = run.sources.find(item => item.id === evidence.sourceId)!;
      expect((source as typeof source & { placeId: string }).placeId).toBe((card as typeof card & { placeId: string }).placeId);
    }
  }
  expect(run.usage.toolCalls).toBe(5);
  expect(run.approval).toBeNull();
  expect(run.cards[3].imagination).toBe(true);
});
it('stops without output when a later stop has no official evidence', async () => {
  const run = await runAgent(makeRun(), { ...dependencies, search: async (run, decision, signal) =>
    (decision.search as { placeId?: string })?.placeId === 'pangyo-museum' ? { sources: [], evidence: [] } : searchSources(run, decision, signal) });
  expect(run.status).toBe('needs_review');
  expect(run.cards).toEqual([]);
  expect(run.artifacts).toEqual([]);
});
it('does not reset the shared tool budget for another place', async () => {
  const run = makeRun(); run.limits.maxToolCalls = 1;
  const result = await runAgent(run, dependencies);
  expect(result.status).toBe('needs_review');
  expect(result.usage.toolCalls).toBe(1);
  expect(result.cards).toEqual([]);
});
it.each(['fixture', 'live'] as const)('rejects cross-stop evidence even when that other stop belongs to the story (%s)', async mode => {
  const run: Run = await runAgent(makeRun(), dependencies);
  run.mode = mode;
  const museum = run.claims.find(claim => claim.cardId === 'card-2')!;
  const first = run.claims.find(claim => claim.cardId === 'card-1')!;
  first.text = museum.text; first.evidenceIds = [...museum.evidenceIds];
  run.cards[0].title = run.cards[0].body = run.cards[0].script = first.text;
  expect(verifyContent(run).some(issue => !issue.resolved && /place|evidence/.test(issue.type))).toBe(true);
});

it('exports the chosen text-only stops and their own photos with story provenance in the actual package', async () => {
  const { renderCards, cardHtml } = await import('../src/lib/render');
  const { readFile, rm } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const { unzipSync, strFromU8 } = await import('fflate');
  const run = await runAgent(makeRun(), dependencies);
  try {
    expect(cardHtml(run, run.cards[1], 1)).toContain('판교박물관');
    const files = await renderCards(run, dependencies.signal);
    const zip = unzipSync(await readFile(files.find(file => file.kind === 'zip')!.path));
    const metadata = JSON.parse(strFromU8(zip['sources.json']));
    expect(metadata.story).toEqual(story);
    expect(metadata.cardScenes.map((scene: { placeId: string }) => scene.placeId)).toEqual(['yuldong-park', 'pangyo-museum', 'yuldong-park', 'pangyo-museum']);
    expect(metadata.images[0]).toMatchObject({ image: null, label: '글로 만나는 장소' });
    expect(metadata.images[2]).toMatchObject({ image: null });
    expect(metadata.images[1]).toMatchObject({ placeId: 'pangyo-museum', kind: 'photo' });
    expect(metadata.images[3]).toMatchObject({ placeId: 'pangyo-museum', kind: 'photo' });
    expect(JSON.parse(strFromU8(zip['review.json'])).outputChecks.imagesChecked).toBe(2);
    expect(Object.keys(zip).filter(name => name.endsWith('.png'))).toHaveLength(4);
  } finally { await rm(resolve('outputs', run.id), { recursive: true, force: true }); }
}, 60000);

it('preserves the saved story and rejects reuse of a request ID with different stop notes or photos', async () => {
  const { RunStore } = await import('../src/lib/store');
  const { RunService } = await import('../src/lib/service');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'city-story-service-'));
  const store = new RunStore(join(dir, 'runs.sqlite'));
  const service = new RunService(store, { ...dependencies, runner: async run => run, checkArtifacts: async () => true });
  try {
    const input = { mode: 'fixture', brief: makeRun().brief, requestId: 'city-story-request' };
    const run = service.create(input); await service.idle(run.id);
    expect(store.get(run.id)?.brief.story).toEqual(story);
    expect(service.create(input).id).toBe(run.id);
    const changed = structuredClone(input); changed.brief.story!.stops[1].photoChoice = 'none';
    expect(() => service.create(changed)).toThrow(/같은 요청/);
    const note = structuredClone(input); note.brief.story!.stops[1].note = '새로운 구성';
    expect(() => service.create(note)).toThrow(/같은 요청/);
    const wrong = structuredClone(input); wrong.brief.placeId = 'pangyo-museum'; wrong.brief.place = '판교박물관';
    expect(() => service.create({ ...wrong, requestId: 'other-request' })).toThrow();
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

it('uses all three stops without increasing the total tool-call cap', async () => {
  const run = makeRun();
  run.brief.story!.stops.push({ id: 'jobworld', placeId: 'korea-jobworld', photoChoice: 'none' });
  run.brief.story!.cardStopIds = ['park', 'museum', 'jobworld', 'jobworld'];
  const result = await runAgent(run, dependencies);
  expect(result.status).toBe('ready_for_approval');
  expect(result.searches?.map(search => search.placeId)).toEqual(['yuldong-park', 'pangyo-museum', 'korea-jobworld']);
  expect(result.cards[2]).toMatchObject({ placeId: 'korea-jobworld', stopId: 'jobworld', imagination: false });
  expect(result.cards[3]).toMatchObject({ placeId: 'korea-jobworld', stopId: 'jobworld', imagination: true });
  expect(result.usage.toolCalls).toBe(6);
  expect(result.limits.maxToolCalls).toBe(12);
});

it('fetches only the explicitly selected official page for each stop', async () => {
  const run = makeRun();
  run.brief.story!.stops[1].officialUrls = ['https://museum.seongnam.go.kr/pangyo/contents/content.do?cIdx=64'];
  const result = await runAgent(run, dependencies);
  expect(result.status).toBe('ready_for_approval');
  expect(result.sources.filter(source => source.placeId === 'pangyo-museum').map(source => source.url)).toEqual(['https://museum.seongnam.go.kr/pangyo/contents/content.do?cIdx=64']);
  expect(result.cards[1].body).toContain('2003년부터 2008년까지');
  expect(result.cards[1].body).not.toContain('2013');
});

it('cannot reassign or reorder story scenes through a model text update', async () => {
  const { applyStoryUpdate } = await import('../src/lib/lifecycle');
  const run = await runAgent(makeRun(), dependencies);
  const cards = structuredClone(run.cards); cards[0].placeId = 'pangyo-museum'; cards[0].stopId = 'museum'; cards[0].title = '새로운 제목';
  applyStoryUpdate(run, { cards, claims: run.claims }, { action: 'compose_story', targetIds: ['card-1'], evidenceIds: [], reasonSummary: '문구 수정', uncertainty: '', expectedVersion: run.version }, run.updatedAt);
  expect(run.cards[0]).toMatchObject({ placeId: 'yuldong-park', stopId: 'park', title: '새로운 제목' });
  const initial = makeRun();
  expect(() => applyStoryUpdate(initial, { cards: [...cards].reverse(), claims: run.claims }, { action: 'compose_story', targetIds: [], evidenceIds: [], reasonSummary: '잘못된 순서', uncertainty: '' }, initial.updatedAt)).toThrow(/순서|배정/);
});

it('preserves a second stop name during easy-language conversion', async () => {
  const { assertReadingStyleUpdate } = await import('../src/lib/reading-style');
  const input = makeRun(); input.brief.story!.stops[1].placeId = 'korea-jobworld';
  const run = await runAgent(input, dependencies);
  run.readingStyleChange = { status: 'requested', expectedVersion: run.version, targetCardIds: ['card-2'], requestedAt: run.updatedAt } as Run['readingStyleChange'];
  const incoming = { cards: structuredClone(run.cards), claims: structuredClone(run.claims) };
  incoming.cards[1].title = incoming.cards[1].title.replaceAll('한국잡월드', '이곳');
  incoming.cards[1].body = incoming.cards[1].body.replaceAll('한국잡월드', '이곳');
  incoming.cards[1].script = incoming.cards[1].script.replaceAll('한국잡월드', '이곳');
  incoming.claims.filter(claim => claim.cardId === 'card-2').forEach(claim => { claim.text = claim.text.replaceAll('한국잡월드', '이곳'); });
  expect(() => assertReadingStyleUpdate(run, incoming)).toThrow(/장소|조건/);
});

it('keeps identical live shared-page snapshots isolated by place and deduplicates only within each place', async () => {
  const { vi } = await import('vitest');
  const { mergeSearchResult } = await import('../src/lib/lifecycle');
  const input = makeRun();
  input.brief.placeId = 'seongnam-botanical-garden'; input.brief.place = '성남시 식물원';
  input.brief.story!.stops[0].placeId = 'seongnam-botanical-garden';
  input.brief.story!.stops[1].placeId = 'seongnam-culture-house';
  input.mode = 'live';
  vi.stubGlobal('fetch', async () => new Response('<main><p>성남시 식물원의 주소는 은행로 72입니다.</p><p>성남문화의집의 주소는 산성대로215번길 7입니다.</p></main>', { headers: { 'content-type': 'text/html' } }));
  try {
    for (const placeId of ['seongnam-botanical-garden', 'seongnam-culture-house']) {
      const chosen = { action: 'search_sources' as const, targetIds: [], evidenceIds: [], reasonSummary: '공식 자료', uncertainty: '', search: { placeId, query: '공식 소개 자료', targetClaimIds: [], missingInformation: [], reason: '공식 자료' } };
      mergeSearchResult(input, await searchSources(input, chosen, dependencies.signal), chosen, input.updatedAt);
    }
    expect(input.sources).toHaveLength(2);
    expect(new Set(input.sources.map(source => source.id)).size).toBe(2);
    expect(input.sources[0].url).toBe(input.sources[1].url);
    expect(input.sources[0].hash).toBe(input.sources[1].hash);
    expect(input.evidence).toHaveLength(4);
    expect(input.searches?.map(search => search.newEvidenceCount)).toEqual([2, 2]);
    const chosen = { action: 'search_sources' as const, targetIds: [], evidenceIds: [], reasonSummary: '다시 확인', uncertainty: '', search: { placeId: 'seongnam-culture-house', query: '공식 소개 자료', targetClaimIds: [], missingInformation: [], reason: '다시 확인' } };
    const repeated = await searchSources(input, chosen, dependencies.signal);
    expect(repeated.evidence).toEqual([]);
    expect(repeated.search?.newEvidenceCount).toBe(0);
  } finally { vi.unstubAllGlobals(); }
});

it('uses each card’s own photo and allows an explicit image override after choosing no default photo', async () => {
  const { RunStore } = await import('../src/lib/store');
  const { RunService } = await import('../src/lib/service');
  const { defaultPlaceImage } = await import('../src/lib/images');
  const { buildImagePrompt } = await import('../src/lib/image-provider');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'city-story-images-'));
  const store = new RunStore(join(dir, 'runs.sqlite'));
  const service = new RunService(store, { ...dependencies, runner: async run => run, checkArtifacts: async () => true,
    image: { configured: () => false, defaultImage: defaultPlaceImage, getAsset: async () => (await defaultPlaceImage('yuldong-park'))!, buildPrompt: buildImagePrompt, generate: async () => { throw new Error('No external image generation in this test'); } } });
  try {
    const run = await runAgent(makeRun(), dependencies); store.insert(run, 'story-image-test');
    expect(buildImagePrompt(run, run.cards[1]).place).toBe('판교박물관');
    await expect(service.image(run.id, { version: run.version, cardId: 'card-2', operation: 'replace', assetId: 'wrong-place-photo' })).rejects.toThrow(/장소/);
    const edited = await service.image(run.id, { version: run.version, cardId: 'card-2', operation: 'replace', usePlacePhoto: true });
    expect(edited.cards[1]).toMatchObject({ placeId: 'pangyo-museum', stopId: 'museum', image: { placeId: 'pangyo-museum' } });
    expect(edited.cards[0].image).toBeUndefined();
    expect(edited.reviewVersion).toBeNull();
    expect(edited.approval).toBeNull();
    const override = await service.image(run.id, { version: edited.version, cardId: 'card-1', operation: 'replace', usePlacePhoto: true });
    expect(override.cards[0].image?.placeId).toBe('yuldong-park');
    expect(override.brief.story!.stops[0].photoChoice).toBe('none');
    const { applyStoryUpdate } = await import('../src/lib/lifecycle');
    const cards = structuredClone(override.cards); delete cards[0].image;
    applyStoryUpdate(override, { cards, claims: override.claims }, { action: 'compose_story', targetIds: ['card-1'], evidenceIds: [], reasonSummary: '문구 재검토', uncertainty: '' }, override.updatedAt);
    expect(override.cards[0].image?.placeId).toBe('yuldong-park');
    override.issues = verifyContent(override); override.reviewVersion = override.version;
    const { renderCards } = await import('../src/lib/render');
    const { resolve } = await import('node:path');
    try { expect((await renderCards(override, dependencies.signal)).filter(file => file.kind === 'png')).toHaveLength(4); }
    finally { await rm(resolve('outputs', override.id), { recursive: true, force: true }); }
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

it('refuses an explicit search that assigns a claim to another story place', async () => {
  const { searchIntent } = await import('../src/lib/lifecycle');
  const run = await runAgent(makeRun(), dependencies);
  expect(() => searchIntent(run, { action: 'search_sources', targetIds: ['card-2'], evidenceIds: [], reasonSummary: '검색', uncertainty: '',
    search: { placeId: 'yuldong-park', query: '박물관 개관일', targetClaimIds: ['claim-story-2'], missingInformation: ['개관일'], reason: '추가 확인' } })).toThrow(/장소/);
});

it('provides fixed scene/source scope to the live composer while accepting only text from the model', async () => {
  const { vi } = await import('vitest');
  const { composeLive } = await import('../src/lib/provider');
  const { applyStoryUpdate } = await import('../src/lib/lifecycle');
  const run = await runAgent(makeRun(), dependencies);
  const payload = { cards: run.cards.map(({ id, title, body, script, claimIds, imagination }) => ({ id, title, body, script, claimIds, imagination })), claims: run.claims };
  run.mode = 'live'; run.cards = []; run.claims = []; run.version = 0;
  for (const [key, value] of Object.entries({ ANTHROPIC_API_KEY: 'test-secret', ANTHROPIC_MODEL: 'test-model', ANTHROPIC_INPUT_USD_PER_MILLION: '3', ANTHROPIC_OUTPUT_USD_PER_MILLION: '15', MAX_COST_USD: '1' })) vi.stubEnv(key, value);
  let received: { cardPlan: { cardId: string; placeId: string }[]; sources: { placeId: string }[]; brief: Brief } | undefined;
  vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); received = JSON.parse(body.messages[0].content);
    return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(payload) }], usage: { input_tokens: 500, output_tokens: 500 } });
  });
  try {
    const generated = await composeLive(run, dependencies.signal);
    expect(received?.cardPlan.map(scene => scene.placeId)).toEqual(['yuldong-park', 'pangyo-museum', 'yuldong-park', 'pangyo-museum']);
    expect(received?.sources.every(source => ['yuldong-park', 'pangyo-museum'].includes(source.placeId))).toBe(true);
    expect(received?.brief.story?.stops[0].note).toContain('사실 근거가 아닙니다');
    applyStoryUpdate(run, generated, { action: 'compose_story', targetIds: [], evidenceIds: [], reasonSummary: '초안', uncertainty: '' }, run.updatedAt);
    expect(run.cards[1]).toMatchObject({ stopId: 'museum', placeId: 'pangyo-museum' });
    expect(run.usage.modelCalls).toBe(1);
    expect(run.approval).toBeNull();
  } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
});

it('retains the single-place registered-name requirement for image-less rendering', async () => {
  const { renderCards } = await import('../src/lib/render');
  const { rm } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const run = await runAgent(newRun({ mode: 'fixture', brief: { ...DEFAULT_BRIEF, placeId: 'korea-jobworld', place: '한국잡월드' } }), dependencies);
  run.brief.place = '등록되지 않은 장소';
  try { await expect(renderCards(run, dependencies.signal)).rejects.toThrow(/장소|사진|등록/); }
  finally { await rm(resolve('outputs', run.id), { recursive: true, force: true }); }
}, 60000);

it('reports a malformed selected source URL as invalid evidence without crashing review', async () => {
  const input = makeRun();
  input.brief.story!.stops[1].officialUrls = ['https://museum.seongnam.go.kr/pangyo/contents/content.do?cIdx=64'];
  const run = await runAgent(input, dependencies);
  run.sources.find(source => source.placeId === 'pangyo-museum')!.url = 'malformed';
  expect(() => verifyContent(run)).not.toThrow();
  expect(verifyContent(run).some(issue => issue.type === 'invalid_evidence')).toBe(true);
});

it('does not follow a selected official page redirect into a different unselected official page', async () => {
  const { vi } = await import('vitest');
  const run = makeRun(); run.mode = 'live';
  const selected = 'https://museum.seongnam.go.kr/pangyo/contents/content.do?cIdx=64';
  run.brief.story!.stops[1].officialUrls = [selected];
  const requests: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    requests.push(url);
    return url === selected ? new Response('', { status: 302, headers: { location: 'https://museum.seongnam.go.kr/pangyo/contents/content.do?cIdx=57' } }) : new Response('<main>판교박물관은 2013년 4월 2일 개관하였습니다.</main>', { headers: { 'content-type': 'text/html' } });
  });
  try {
    const result = await searchSources(run, { action: 'search_sources', targetIds: [], evidenceIds: [], reasonSummary: '선택 자료', uncertainty: '', search: { placeId: 'pangyo-museum', query: '공식 소개 자료', targetClaimIds: [], missingInformation: [], reason: '선택 자료' } }, dependencies.signal);
    expect(requests).toEqual([selected]);
    expect(result.evidence).toEqual([]);
    expect(result.sources[0].status).toBe('unavailable');
  } finally { vi.unstubAllGlobals(); }
});
