import { describe, expect, it } from 'vitest';
import { DEFAULT_BRIEF } from '../src/lib/run';
import { createWorkspace, decodeWorkspace, workspaceFromSearch, workspaceSearch, type DraftState } from '../src/lib/workspace-state';

const draft: DraftState = { brief: DEFAULT_BRIEF, mode: 'fixture', strategy: 'agent', scenario: 'normal', imageChoice: 'photo' };

describe('independent 3D tourism navigation', () => {
  it('opens a direct 3D URL without losing the unfinished creation draft', () => {
    const state = createWorkspace(draft);
    state.draft.brief.goal = '작성 중인 성남 이야기';
    const result = workspaceFromSearch(state, '?view=diorama&scene=central-park&spot=park-pavilion');
    expect(result.view).toBe('diorama');
    expect(result).toHaveProperty('diorama', { placeId: 'central-park', hotspotId: 'park-pavilion' });
    expect(result.draft.brief.goal).toBe('작성 중인 성남 이야기');
    const url = workspaceSearch(result);
    expect(url).toContain('scene=central-park');
    expect(url).toContain('spot=park-pavilion');
    expect(url).not.toContain('작성');
    expect(workspaceFromSearch(createWorkspace(draft), url)).toHaveProperty('diorama', { placeId: 'central-park', hotspotId: 'park-pavilion' });
  });

  it('restores older workspace data while preserving the agent view and reading style', () => {
    const previous = { ...createWorkspace(draft), view: 'agent', draft: { ...draft, brief: { ...DEFAULT_BRIEF, readingStyle: 'easy' } } };
    delete (previous as Record<string, unknown>).diorama;
    const restored = decodeWorkspace(JSON.stringify(previous), draft);
    expect(restored.view).toBe('agent');
    expect(restored.draft.brief.readingStyle).toBe('easy');
    expect(restored).toHaveProperty('diorama', { placeId: 'seongnam', hotspotId: null });
  });

  it('rejects unsupported scene IDs and hotspots belonging to a different place', () => {
    const unknown = workspaceFromSearch(createWorkspace(draft), '?view=diorama&scene=wrong&spot=wrong');
    expect(unknown).toHaveProperty('diorama', { placeId: 'seongnam', hotspotId: null });
    const crossed = workspaceFromSearch(createWorkspace(draft), '?view=diorama&scene=moran-market&spot=park-pavilion');
    expect(crossed).toHaveProperty('diorama', { placeId: 'moran-market', hotspotId: null });
    const restored = decodeWorkspace(JSON.stringify({ ...createWorkspace(draft), diorama: { placeId: 'central-park', hotspotId: 'park-lake' } }), draft);
    expect(restored).toHaveProperty('diorama', { placeId: 'central-park', hotspotId: 'park-lake' });
  });

  it('keeps ordinary exploration selection independent from the 3D selection', () => {
    const result = workspaceFromSearch(createWorkspace(draft), '?view=diorama&place=yuldong-park&scene=moran-market&spot=market-aisle');
    expect(result.explore.selectedId).toBe('yuldong-park');
    expect(result).toHaveProperty('diorama', { placeId: 'moran-market', hotspotId: 'market-aisle' });
    const roundtrip = decodeWorkspace(JSON.stringify(result), draft);
    expect(roundtrip.explore.selectedId).toBe('yuldong-park');
    expect(roundtrip).toHaveProperty('diorama', { placeId: 'moran-market', hotspotId: 'market-aisle' });
  });
});

// The guide must use the scene place even when the ordinary map has a different selection.
it('keeps guide advice on the 3D place and opens the existing studio action', async () => {
  const { getGuideAdvice } = await import('../src/lib/guide');
  const { getPlace } = await import('../src/lib/places');
  const advice = getGuideAdvice({ view: 'diorama', selectedPlace: getPlace('central-park')!, draftPlace: getPlace('pangyo-museum')!, run: null, busy: false, error: '', tab: 'evidence', selectedCardId: '' });
  expect(advice.title).toContain('중앙공원');
  expect(advice.body).toContain('모형');
  expect(advice.action).toBe('studio');
});
