import { describe, expect, it } from 'vitest';
import { DEFAULT_BRIEF, newRun } from '../src/lib/run';
import { PLACE_THEMES, createWorkspace, decodeWorkspace, workspaceFromSearch, workspaceSearch, filterPlaces, toggleSavedPlace, matchingEditDraft, upsertEditDraft, shouldAcceptRun, type DraftState } from '../src/lib/workspace-state';
import { PLACES } from '../src/lib/places';

const draft: DraftState = { brief: DEFAULT_BRIEF, mode: 'fixture', strategy: 'agent', scenario: 'normal', imageChoice: 'photo' };
describe('browser workspace persistence', () => {
  it('restores the agent page and preserves the selected run and unfinished text across navigation', () => {
    const state = createWorkspace(draft);
    state.runId = '33333333-3333-4333-8333-333333333333';
    state.draft.brief.goal = '아직 쓰고 있는 소개';
    const restored = workspaceFromSearch(state, `?view=agent&run=${state.runId}`);
    expect(restored.view).toBe('agent');
    expect(restored.runId).toBe(state.runId);
    expect(restored.draft.brief.goal).toBe('아직 쓰고 있는 소개');
    expect(decodeWorkspace(JSON.stringify(restored), draft).view).toBe('agent');
    expect(workspaceSearch(restored)).toContain('view=agent');
  });
  it('restores easy-reading preferences locally without including the brief in the URL', () => {
    const raw = { ...createWorkspace(draft), draft: { ...draft, brief: { ...DEFAULT_BRIEF, readingStyle: 'easy' } } };
    const restored = decodeWorkspace(JSON.stringify(raw), draft);
    expect(restored.draft.brief).toHaveProperty('readingStyle', 'easy');
    expect(workspaceSearch(restored)).not.toContain('readingStyle');
    raw.draft.brief.readingStyle = 'forged';
    expect(decodeWorkspace(JSON.stringify(raw), draft).draft.brief).toHaveProperty('readingStyle', 'standard');
  });
  it('restores valid local drafts and favourites, without trusting unknown place IDs', () => {
    const restored = decodeWorkspace(JSON.stringify({ ...createWorkspace(draft), savedIds: ['yuldong-park','wrong','yuldong-park'], draft: {...draft,brief:{...DEFAULT_BRIEF,goal:'작성 중인 소개 문구',placeId:'yuldong-park',place:'wrong'}} }), draft);
    expect(restored.savedIds).toEqual(['yuldong-park']);
    expect(restored.draft.brief.place).toBe('율동공원');
    expect(restored.draft.brief.goal).toBe('작성 중인 소개 문구');
  });
  it('handles corrupt, oversized and incompatible storage without crashing', () => {
    for(const raw of ['{broken', 'x'.repeat(100000), JSON.stringify({version:9}), 'null']) expect(decodeWorkspace(raw,draft)).toEqual(createWorkspace(draft));
  });
  it('retains incomplete draft text without treating it as a valid creation request', () => {
    const value=createWorkspace(draft);value.draft.brief.goal='';
    expect(decodeWorkspace(JSON.stringify(value),draft).draft.brief.goal).toBe('');
  });
  it('round trips route, selected place, filters and viewport without leaking draft text', () => {
    const value=createWorkspace(draft);value.view='explore';value.explore={...value.explore,query:'율동',district:'분당구',category:'공원',theme:'nature',selectedId:'yuldong-park',mapView:{lat:37.37,lng:127.15,zoom:13}};
    const search=workspaceSearch(value);expect(search).not.toContain(DEFAULT_BRIEF.goal);
    const restored=workspaceFromSearch(createWorkspace(draft),search);
    expect(restored.view).toBe('explore');expect(restored.explore).toEqual(value.explore);
  });
  it('rejects forged route fields and clears selection outside the registered result set', () => {
    const value=workspaceFromSearch(createWorkspace(draft),'?view=admin&place=wrong&district=서울&category=anything&run=https://evil.test&lat=Infinity&lng=0&zoom=100');
    expect(value.view).toBe('dashboard');expect(value.runId).toBeNull();expect(value.explore.selectedId).toBeNull();expect(value.explore.mapView).toBeUndefined();
    const filtered=workspaceFromSearch(createWorkspace(draft),'?view=explore&place=yuldong-park&district=수정구');expect(filtered.explore.selectedId).toBeNull();
  });
  it('restores a persisted view on fresh entry but empty history location goes home',()=>{
    const value=createWorkspace(draft);value.view='saved';
    expect(workspaceFromSearch(value,'',true).view).toBe('saved');expect(workspaceFromSearch(value,'').view).toBe('dashboard');
  });
  it('filters themes, region and saved IDs together and toggles only registered places',()=>{
    const value=createWorkspace(draft);value.explore.theme='history';
    const result=filterPlaces(value.explore);expect(result.length).toBeGreaterThan(1);expect(result.every(p=>p.type==='박물관'||p.type==='문화유산')).toBe(true);
    value.explore.theme='all';value.explore.district='분당구';expect(filterPlaces(value.explore,['yuldong-park','bongguksa']).map(p=>p.id)).toEqual(['yuldong-park']);
    expect(toggleSavedPlace(['yuldong-park'],'yuldong-park')).toEqual([]);expect(toggleSavedPlace([],'forged')).toEqual([]);expect(PLACES.length).toBeGreaterThanOrEqual(39);
  });
  it('every offered theme contains registered places',()=>{for(const theme of PLACE_THEMES){const value=createWorkspace(draft);value.explore.theme=theme.id;expect(filterPlaces(value.explore).length).toBeGreaterThan(0);}});
  it('binds unsaved edits to the exact server version and keeps other card drafts',()=>{
    const edit={runId:'a',version:2,cardId:'card-1',title:'내 제목',body:'아직 저장하지 않은 내용'};
    const edits=upsertEditDraft([],edit);const both=upsertEditDraft(edits,{...edit,cardId:'card-2'});
    expect(matchingEditDraft(both,'a',2,'card-1')).toEqual(edit);expect(matchingEditDraft(both,'a',3,'card-1')).toBeNull();expect(matchingEditDraft(both,'b',2,'card-1')).toBeNull();expect(both).toHaveLength(2);
  });
  it('restores the city-story preview after a reload but never enters it on ordinary 3D navigation',()=>{
    const runId='33333333-3333-4333-8333-333333333333';
    const preview=workspaceFromSearch(createWorkspace(draft),`?view=diorama&scene=central-park&run=${runId}&preview=story`);
    expect(preview.storyPreview).toBe(true);
    expect(workspaceSearch(preview)).toContain('preview=story');
    expect(workspaceFromSearch(createWorkspace(draft),workspaceSearch(preview)).storyPreview).toBe(true);
    expect(workspaceFromSearch(decodeWorkspace(JSON.stringify(preview),draft),'',true).storyPreview).toBe(true);
    expect(workspaceFromSearch(preview,`?view=diorama&scene=central-park&run=${runId}`).storyPreview).toBe(false);
    expect(workspaceFromSearch(createWorkspace(draft),'?view=diorama&scene=central-park&preview=story').storyPreview).toBe(false);
    expect(workspaceFromSearch(createWorkspace(draft),`?view=studio&run=${runId}&preview=story`).storyPreview).toBe(false);
    expect(workspaceSearch({...preview,view:'studio'})).not.toContain('preview');
  });
  it('keeps an in-flight creation request verbatim so a reload resends the same idempotent request',()=>{
    const body={brief:{...DEFAULT_BRIEF,goal:'새로고침 직전에 보낸 제작 요청'},mode:'fixture' as const,strategy:'agent' as const,scenario:'normal' as const,requestId:'44444444-4444-4444-8444-444444444444'};
    const state={...createWorkspace(draft),pendingCreate:{runId:null,body}};
    const restored=decodeWorkspace(JSON.stringify(state),draft);
    expect(restored.pendingCreate).toEqual({runId:null,body});
    expect(JSON.stringify(restored.pendingCreate?.body)).toBe(JSON.stringify(body));
    expect(workspaceFromSearch(restored,'?view=studio').pendingCreate).toEqual(restored.pendingCreate);
    expect(workspaceSearch(restored)).not.toContain(body.requestId);
    const withRun=decodeWorkspace(JSON.stringify({...state,pendingCreate:{runId:'33333333-3333-4333-8333-333333333333',body}}),draft);
    expect(withRun.pendingCreate?.runId).toBe('33333333-3333-4333-8333-333333333333');
    for(const pendingCreate of [{runId:null,body:{...body,requestId:'forged'}},{runId:null,body:{...body,mode:'admin'}},{runId:null,body:{...body,brief:'text'}},{runId:null},'broken'])
      expect(decodeWorkspace(JSON.stringify({...state,pendingCreate}),draft).pendingCreate).toBeNull();
    expect(createWorkspace(draft).pendingCreate).toBeNull();
  });
  it('does not regress the current run when polls or mutations resolve late',()=>{
    const current=newRun({mode:'fixture'});current.version=2;current.updatedAt='2026-09-13T08:00:02Z';current.status='approved';
    expect(shouldAcceptRun(current,{...current,id:'other'})).toBe(false);
    expect(shouldAcceptRun(current,{...current,version:1,updatedAt:'2026-09-13T08:00:03Z'})).toBe(false);
    expect(shouldAcceptRun(current,{...current,updatedAt:'2026-09-13T08:00:01Z',status:'running'})).toBe(false);
    expect(shouldAcceptRun(current,{...current,status:'running'})).toBe(false);
    expect(shouldAcceptRun(current,{...current,version:3,status:'needs_review'})).toBe(true);
  });
});
