import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_BRIEF, newRun } from '../src/lib/run';
import { createFixtureStory } from '../src/lib/fixture';
import { fixtureSources } from '../src/lib/sources';
import { verifyContent } from '../src/lib/verifier';
import { getPlace, PLACES } from '../src/lib/places';
import { goalForPurpose, PURPOSES, type CreationPurpose } from '../src/lib/purposes';
import { composeLive } from '../src/lib/provider';
import { RunStore } from '../src/lib/store';
import { RunService } from '../src/lib/service';
import { handle } from '../src/lib/http';
import { DEMO_EXAMPLE } from '../src/lib/demo-example';
import { applyStoryUpdate } from '../src/lib/lifecycle';

const purposes = ['place_intro', 'visit_guide', 'youth_story'] as const;
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const brief = (purpose?: typeof purposes[number]) => ({ ...DEFAULT_BRIEF, ...(purpose ? { purpose } : {}) });
function serviceFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'timestory-purpose-'));
  const store = new RunStore(join(dir, 'runs.sqlite'));
  const service = new RunService(store, { runner: async run => run, search: async () => ({ sources: [], evidence: [] }), render: async () => [], checkArtifacts: async () => true });
  cleanups.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { service, store };
}

describe('creation purpose', () => {
  it('builds distinct purpose goals with the chosen place and existing audience choices', () => {
    const place = getPlace('yuldong-park')!;
    expect(PURPOSES.map(purpose => purpose.audience)).toEqual(['성남 시민', '가족 관람객', '청소년']);
    const goals = PURPOSES.map(purpose => goalForPurpose(place, purpose.id));
    expect(new Set(goals).size).toBe(3);
    expect(goals.every(goal => goal.includes(place.name) && goal.includes('4장') && goal.includes('상상'))).toBe(true);
    expect(goalForPurpose(place, 'visit_guide')).toContain('임의로 채우지');
  });
  it('changes the actual prepared card composition and wording for each purpose', () => {
    const stories = purposes.map(purpose => createFixtureStory(newRun({ mode: 'fixture', brief: brief(purpose) })));
    expect(new Set(stories.map(story => story.cards.map(card => card.body).join('|'))).size).toBe(3);
    expect(new Set(stories.map(story => story.cards.slice(0, 3).map(card => card.body).join('|'))).size).toBe(3);
    expect(new Set(stories.map(story => story.cards.map(card => card.title).join('|'))).size).toBe(3);
  });

  it('preserves the original fixture when purpose is omitted', () => {
    const run = newRun({ mode: 'fixture', brief: brief() });
    expect(run.brief).not.toHaveProperty('purpose');
    const story = createFixtureStory(run);
    expect(story.cards.map(card => card.title)).toEqual(['판교의 시간을 만나볼까?', '돌방에 남은 이야기', '땅속에서 찾은 시간', '우리가 상상하는 다음 장']);
    expect(story.cards[0].body).toBe('판교박물관은 2013년 4월 2일에 문을 열었어요.');
  });

  it('rejects invalid purposes before direct run creation or default goal construction', () => {
    const purpose = 'constructor' as CreationPurpose;
    expect(() => newRun({ mode: 'fixture', brief: { ...brief(), purpose } })).toThrow('제작 목적');
    expect(() => goalForPurpose(getPlace('pangyo-museum')!, purpose)).toThrow('제작 목적');
  });

  it.each(PLACES.flatMap(place => purposes.map(purpose => ({ place, purpose }))))('keeps reviewed facts for $place.name / $purpose', ({ place, purpose }) => {
    const run = newRun({ mode: 'fixture', brief: { ...brief(purpose), placeId: place.id, place: place.name } });
    Object.assign(run, fixtureSources(place.id), createFixtureStory(run));
    expect(run.brief.placeId).toBe(place.id);
    expect(run.cards).toHaveLength(4);
    expect(run.cards[3].imagination).toBe(true);
    expect(run.cards[3].body).toContain('상상 장면');
    expect(verifyContent(run)).toEqual([]);
    expect(JSON.stringify(run.cards)).not.toMatch(/무료|상시|24시간|09:00/);
    if (place.id !== 'pangyo-museum') expect(JSON.stringify(run.cards)).not.toContain('판교박물관');
  });

  it('accepts purpose in the API and persists it to the run', async () => {
    const { service, store } = serviceFixture();
    const run = service.create({ mode: 'fixture', brief: brief('youth_story'), requestId: 'purpose-api-1' });
    await service.idle(run.id);
    expect(store.get(run.id)?.brief).toMatchObject({ purpose: 'youth_story', placeId: 'pangyo-museum' });
  });

  it.each(purposes)('keeps human edits protected during a purpose-specific correction: %s', purpose => {
    const run = newRun({ mode: 'fixture', scenario: 'causal', brief: brief(purpose) });
    Object.assign(run, fixtureSources(), createFixtureStory(run));
    run.version = 1;
    run.issues = verifyContent(run);
    run.protectedCardIds = ['card-3'];
    const before = structuredClone(run.cards);
    const story = createFixtureStory(run);
    const applied = applyStoryUpdate(run, story, { action: 'compose_story', targetIds: ['card-3'], evidenceIds: [], reasonSummary: '근거 없는 연결만 수정', uncertainty: '', expectedVersion: 1 }, run.createdAt);
    expect(applied).toBe(false);
    expect(run.cards).toEqual(before);
    expect(run.version).toBe(1);
    expect(run.proposedChanges?.[0].after.body).not.toBe(before[2].body);
    expect(run.status).toBe('needs_review');
  });

  it('returns HTTP 400 for an unregistered purpose', async () => {
    const { service } = serviceFixture();
    const response = await handle(() => service.create({ mode: 'fixture', brief: { ...brief(), purpose: 'make_anything' }, requestId: 'invalid-purpose-1' }));
    expect(response.status).toBe(400);
  });

  it('deduplicates identical purposes and conflicts when only purpose differs', async () => {
    const { service, store } = serviceFixture();
    const input = { mode: 'fixture', brief: brief('place_intro'), requestId: 'purpose-dedupe-1' };
    const first = service.create(input);
    await service.idle(first.id);
    expect(service.create(input).id).toBe(first.id);
    const conflict = await handle(() => service.create({ ...input, brief: brief('visit_guide') }));
    expect(conflict.status).toBe(409);
    expect(store.list()).toHaveLength(1);
  });

  it('keeps omitted purpose separate from an explicit purpose on the same request key', async () => {
    const { service } = serviceFixture();
    const input = { mode: 'fixture', brief: brief(), requestId: 'purpose-legacy-1' };
    const run = service.create(input);
    await service.idle(run.id);
    expect(service.create(input).id).toBe(run.id);
    const conflict = await handle(() => service.create({ ...input, brief: brief('place_intro') }));
    expect(conflict.status).toBe(409);
  });

  it('passes selected purpose and edited audience/goal to the actual live compose request', async () => {
    for (const [name, value] of Object.entries({ ANTHROPIC_API_KEY: 'test-secret', ANTHROPIC_MODEL: 'test-model', ANTHROPIC_INPUT_USD_PER_MILLION: '1', ANTHROPIC_OUTPUT_USD_PER_MILLION: '1', MAX_COST_USD: '1' })) vi.stubEnv(name, value);
    const run = newRun({ mode: 'live', brief: { ...brief('visit_guide'), audience: '성남 시민', goal: '직접 고른 방문 준비 주제를 담아 주세요.' } });
    const story = createFixtureStory(run);
    const mock = vi.fn<typeof fetch>(async () => Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(story) }], usage: { input_tokens: 1, output_tokens: 1 } }));
    vi.stubGlobal('fetch', mock);
    await composeLive(run, new AbortController().signal);
    const payload = JSON.parse(mock.mock.calls[0][1]!.body as string);
    const context = JSON.parse(payload.messages[0].content);
    expect(context.brief).toMatchObject({ purpose: 'visit_guide', audience: '성남 시민', goal: run.brief.goal });
    expect(payload.system).toContain('visit_guide');
    expect(payload.system).toContain('미확인 운영시간');
  });

  it('publishes four real reviewed fixture PNGs with original image rights and hashes', () => {
    const metadata = JSON.parse(readFileSync('public/examples/metadata.json', 'utf8'));
    expect(metadata).toMatchObject({ mode: 'fixture', purpose: 'youth_story', placeId: 'pangyo-museum', apiCalls: 0, modelCalls: 0, costUsd: 0, networkRequests: 0, humanApproved: false, reviewStatus: 'ready_for_approval' });
    expect(metadata.reviewVersion).toBe(metadata.version);
    expect(Date.parse(metadata.reviewedAt)).not.toBeNaN();
    expect(DEMO_EXAMPLE.images).toHaveLength(4);
    for (const card of metadata.cards) {
      const bytes = readFileSync(`public${card.image}`);
      expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1080, 1080]);
      const digest = createHash('sha256').update(bytes).digest('hex');
      expect(digest).toBe(card.sha256);
      expect(digest).toBe(card.originalArtifactSha256);
      expect(card.sourceImage).toMatchObject({ placeId: 'pangyo-museum', kind: 'photo', author: '대한민국역사박물관', license: 'KOGL Type 1' });
      expect(createHash('sha256').update(readFileSync(`public${card.sourceImage.src}`)).digest('hex')).toBe(card.sourceImage.sha256);
    }
    const sources = JSON.parse(readFileSync(`public${DEMO_EXAMPLE.sourceManifestUrl}`, 'utf8'));
    const review = JSON.parse(readFileSync(`public${DEMO_EXAMPLE.reviewManifestUrl}`, 'utf8'));
    expect(sources.images).toHaveLength(4);
    expect(review.outputChecks).toMatchObject({ imagesLoaded: true, fontsLoaded: true, overflow: false });
  });
});
