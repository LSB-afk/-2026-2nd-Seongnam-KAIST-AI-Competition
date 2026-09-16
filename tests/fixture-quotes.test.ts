import { describe, expect, it } from 'vitest';
import { runAgent } from '../src/lib/agent';
import { createFixtureStory, quoteBodyRank } from '../src/lib/fixture';
import { getPlace, PLACES, type Place } from '../src/lib/places';
import { DEFAULT_BRIEF, newRun } from '../src/lib/run';
import { fixtureSources, searchSources } from '../src/lib/sources';
import { verifyContent } from '../src/lib/verifier';
import type { AgentDeps, Artifact, Brief } from '../src/lib/types';

const beacon = getPlace('cheonrimsan-beacon')!;
const garden = getPlace('seongnam-botanical-garden')!;
// 단대전통시장 still has only its name and address as registered quotes.
const market = getPlace('dandae-traditional-market')!;
const quotes = (place: Place) => place.officialQuotes.map(quote => quote.text);
const nameOrAddress = (body: string, place: Place) => body === place.name || place.address.includes(body);
const dependencies: AgentDeps = {
  search: searchSources,
  render: async run => [
    ...[1, 2, 3, 4].map(i => ({ name: `card-${i}.png`, kind: 'png' })),
    { name: 'bundle.zip', kind: 'zip' }, { name: 'script.txt', kind: 'text' }, { name: 'review.json', kind: 'json' },
  ].map(item => ({ ...item, path: item.name, sha256: 'fixture-render', version: run.version, reviewVersion: run.version })) as Artifact[],
  persist: () => {}, signal: new AbortController().signal,
};
function singlePlace(place: Place, purpose?: Brief['purpose']) {
  const run = newRun({ mode: 'fixture', brief: { ...DEFAULT_BRIEF, placeId: place.id, place: place.name, ...(purpose ? { purpose } : {}) } });
  Object.assign(run, fixtureSources(place.id), createFixtureStory(run));
  return run;
}

describe('fixture card bodies', () => {
  it('ranks sentence-like quotes first and bare names or addresses last', () => {
    expect(quoteBodyRank(quotes(getPlace('yuldong-park')!)[0], getPlace('yuldong-park')!)).toBe(0);
    expect(quoteBodyRank('매월 끝자리 4일과 9일, 닷새마다 열리는', getPlace('moran-market')!)).toBe(0);
    expect(quoteBodyRank('제2로 직봉 성남 천림산 봉수 유적', beacon)).toBe(1);
    expect(quoteBodyRank('사적', beacon)).toBe(1);
    expect(quoteBodyRank('달래내로 295', beacon)).toBe(2);
    expect(quoteBodyRank('2002년 10월 30일 : 성남시 식물원 개장', garden)).toBe(0);
    for (const text of quotes(market)) expect(quoteBodyRank(text, market)).toBe(2);
    expect(quoteBodyRank('야탑동 486', getPlace('tancheon-sports-complex')!)).toBe(2);
    expect(quoteBodyRank('중원구 상대원동 39-8번지', getPlace('sagimakgol-park')!)).toBe(2);
  });

  it('uses descriptive 천림산 봉수 유적 quotes on every shared-story card for that stop', async () => {
    const story = {
      title: '식물원에서 봉수대까지',
      stops: [{ id: 'garden', placeId: garden.id, photoChoice: 'none' as const }, { id: 'beacon', placeId: beacon.id, photoChoice: 'none' as const }],
      cardStopIds: ['garden', 'beacon', 'beacon', 'beacon'] as [string, string, string, string],
    };
    const run = await runAgent(newRun({ mode: 'fixture', brief: { ...DEFAULT_BRIEF, placeId: garden.id, place: garden.name, story } as Brief }), dependencies);
    expect(run.status, run.stopReason ?? '').toBe('ready_for_approval');
    const beaconCards = run.cards.slice(1, 3);
    for (const card of beaconCards) {
      expect(quotes(beacon)).toContain(card.body);
      expect(nameOrAddress(card.body, beacon)).toBe(false);
    }
    expect(beaconCards[0].body).not.toBe(beaconCards[1].body);
    expect(run.cards[0].body).toBe('2002년 10월 30일 : 성남시 식물원 개장');
  });

  it.each([undefined, 'place_intro', 'youth_story'] as const)('keeps the 천림산 봉수 유적 lead card off its name and address (purpose %s)', purpose => {
    const run = singlePlace(beacon, purpose);
    expect(verifyContent(run)).toEqual([]);
    expect(quotes(beacon)).toContain(run.cards[0].body);
    expect(nameOrAddress(run.cards[0].body, beacon)).toBe(false);
  });

  it('falls back to evidence-bound registered quotes when a place has no descriptive quote', () => {
    for (const purpose of [undefined, 'place_intro', 'visit_guide', 'youth_story'] as const) {
      const run = singlePlace(market, purpose);
      expect(verifyContent(run)).toEqual([]);
      expect(run.cards.slice(0, 3).map(card => card.body).sort()).toEqual([...quotes(market)].sort());
    }
  });

  it('keeps the sentence lead card for places whose first quote is already a sentence', () => {
    for (const place of PLACES.slice(1, 8)) expect(singlePlace(place).cards[0].body, place.name).toBe(quotes(place)[0]);
  });
});
