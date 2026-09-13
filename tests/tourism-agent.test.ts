import { afterEach, expect, it, vi } from 'vitest';
import { createFixtureStory } from '../src/lib/fixture';
import { DEFAULT_BRIEF, newRun } from '../src/lib/run';
import { assertOfficialUrl, fetchOfficialPage, searchSources } from '../src/lib/sources';
import { verifyContent } from '../src/lib/verifier';
import { PLACES } from '../src/lib/places';
import type { Decision } from '../src/lib/types';

afterEach(() => vi.unstubAllGlobals());
const decision: Decision = { action: 'search_sources', targetIds: [], evidenceIds: [], reasonSummary: '선택한 장소 소개 자료', uncertainty: '' };
const parkRun = () => newRun({ mode: 'fixture', brief: { ...DEFAULT_BRIEF, placeId: 'yuldong-park', place: '율동공원', goal: '율동공원 소개' } });

it.each(PLACES)('creates a supported fixture story for $name', async place => {
  const run = newRun({ mode: 'fixture', brief: { ...DEFAULT_BRIEF, placeId: place.id, place: place.name, goal: `${place.name} 소개` } });
  Object.assign(run, await searchSources(run, decision, new AbortController().signal));
  Object.assign(run, createFixtureStory(run));
  expect(run.evidence.length).toBeGreaterThanOrEqual(3);
  expect(JSON.stringify(run.cards)).toContain(place.name);
  if (place.id !== 'pangyo-museum') expect(JSON.stringify([run.cards, run.evidence, run.sources])).not.toMatch(/판교박물관|석실분|발굴조사/);
  expect(verifyContent(run)).toEqual([]);
  expect(run.claims.filter(claim => claim.support === 'supported')).toHaveLength(3);
});

it('rejects redirects from the selected official page to another attraction', async () => {
  const run = parkRun(); run.mode = 'live';
  const mock = vi.fn(async () => new Response('', { status: 302, headers: { location: 'https://museum.seongnam.go.kr/pangyo/contents/content.do?cIdx=57' } }));
  vi.stubGlobal('fetch', mock);
  const result = await searchSources(run, decision, new AbortController().signal);
  expect(mock).toHaveBeenCalledTimes(1);
  expect(result.evidence).toEqual([]);
  expect(result.sources[0].status).toBe('unavailable');
});

it('rejects extra action parameters even on a registered destination URL', () => {
  const park = PLACES.find(place => place.id === 'yuldong-park')!;
  expect(() => assertOfficialUrl(`${park.sourceUrl}?action=delete`, park.id)).toThrow();
  expect(() => assertOfficialUrl(park.sourceUrl, 'central-park')).toThrow();
});

it.each([
  ['yuldong-park', '<main><div class="grid-info"><p>율동공원은 자연호수 공원입니다.</p></div><p>다른 관광지 소개 내용은 제외합니다.</p></main>', '율동공원'],
  ['manggyeongam', '<form><div class="touristInfo slidebox"><div class="con_area">주소 : 경기도 성남시 수정구</div></div><div class="mt15 tourist_con">망경암은 서울을 내려다볼 수 있는 사찰이다.</div><div id="tourist_map_layer">다른 관광지 소개 내용은 제외합니다.</div></form>', '망경암'],
])('extracts %s facts without surrounding attraction lists', async (placeId, html, name) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(html, { headers: { 'content-type': 'text/html' } })));
  const snapshot = await fetchOfficialPage(PLACES.find(place => place.id === placeId)!.sourceUrl, new AbortController().signal);
  expect(snapshot).toContain(name);
  expect(snapshot).not.toContain('다른 관광지');
});

it('rejects mismatched registered place IDs and names', () => {
  expect(() => newRun({ mode: 'fixture', brief: { ...DEFAULT_BRIEF, placeId: 'yuldong-park' } })).toThrow(/장소|관광지/);
});

it('blocks another attraction source from supporting the selected place', async () => {
  const run = parkRun();
  const museum = newRun({ mode: 'fixture' });
  Object.assign(run, await searchSources(museum, decision, new AbortController().signal));
  Object.assign(run, createFixtureStory(museum));
  expect(verifyContent(run).some(issue => /place|evidence/.test(issue.type))).toBe(true);
});

it('restricts crawling and redirects to the selected registered official pages', async () => {
  const run = parkRun(); run.mode = 'live';
  const mock = vi.fn<typeof fetch>(async () => new Response('<main><p>율동공원에서는 호수를 따라 산책할 수 있습니다.</p><a href="https://museum.seongnam.go.kr/pangyo/contents/content.do?cIdx=57">박물관</a><a href="https://127.0.0.1/">산책</a></main>', { headers: { 'content-type': 'text/html' } }));
  vi.stubGlobal('fetch', mock);
  const result = await searchSources(run, decision, new AbortController().signal);
  expect(result.evidence.length).toBeGreaterThan(0);
  expect(mock.mock.calls.every(call => !String(call[0]).includes('museum.') && !String(call[0]).includes('127.0.0.1'))).toBe(true);
  expect(() => assertOfficialUrl(result.sources[0].url, 'yuldong-park')).not.toThrow();
  expect(() => assertOfficialUrl('https://museum.seongnam.go.kr/pangyo/contents/content.do?cIdx=57', 'yuldong-park')).toThrow();
});
