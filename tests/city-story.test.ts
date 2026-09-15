import { describe, expect, it } from 'vitest';
import { cityStoryBriefSchema, createCityStoryDraft, decodeCityStoryDraft, restoreCityStoryDraft, storyBriefFromDraft, type CityStoryDraft } from '../src/lib/city-story';
import { PLACES } from '../src/lib/places';
import { createWorkspace, decodeWorkspace, workspaceFromSearch, workspaceSearch } from '../src/lib/workspace-state';
import { DEFAULT_BRIEF } from '../src/lib/run';

const stops = ['pangyo-museum', 'moran-market', 'central-park'].map(placeId => ({id:placeId,placeId,photoChoice:'place' as const}));
const draft = (): CityStoryDraft => ({...createCityStoryDraft(),title:'성남의 기억·생활·쉼',stops});
describe('city story boundaries',()=>{
  it('covers every selected stop with facts and anchors imagination at the last stop',()=>{
    expect(storyBriefFromDraft(draft()).cardStopIds).toEqual(['pangyo-museum','moran-market','central-park','central-park']);
    expect(storyBriefFromDraft({...draft(),stops:stops.slice(0,2)}).cardStopIds).toEqual(['pangyo-museum','moran-market','moran-market','moran-market']);
  });
  it('rejects unknown places, skipped places and duplicated stops',()=>{
    const valid=storyBriefFromDraft(draft());
    expect(cityStoryBriefSchema.safeParse({...valid,stops:[stops[0],stops[0]]}).success).toBe(false);
    expect(cityStoryBriefSchema.safeParse({...valid,stops:[...stops.slice(0,2),{...stops[2],placeId:'forged'}]}).success).toBe(false);
    expect(cityStoryBriefSchema.safeParse({...valid,cardStopIds:['pangyo-museum','pangyo-museum','pangyo-museum','central-park']}).success).toBe(false);
  });
  it('accepts only the chosen place’s registered sources and safe camera snapshots',()=>{
    const valid=storyBriefFromDraft(draft());
    const withStop=(value:object)=>({...valid,stops:[{...stops[0],...value},...stops.slice(1)]});
    expect(cityStoryBriefSchema.safeParse(withStop({officialUrls:[PLACES[0].sourceUrl]})).success).toBe(true);
    expect(cityStoryBriefSchema.safeParse(withStop({officialUrls:['https://attacker.test']})).success).toBe(false);
    expect(cityStoryBriefSchema.safeParse(withStop({camera:{position:[1,2,3],target:[0,0,0],zoom:2}})).success).toBe(true);
    for(const camera of [{position:[0,0,0],target:[0,0,0],zoom:2},{position:[Infinity,2,3],target:[0,0,0],zoom:2},{position:[1,2,3],target:[0,0,0],zoom:1000}]) expect(cityStoryBriefSchema.safeParse(withStop({camera})).success).toBe(false);
  });
  it('restores incomplete private drafts but rejects corrupt storage',()=>{
    const value={...draft(),title:'',stops:[{...stops[0],note:'공식 근거가 아닌 개인 메모',camera:{position:[1,2,3],target:[0,0,0],zoom:2}}]};
    expect(decodeCityStoryDraft(JSON.stringify(value))).toEqual(value);
    for(const raw of ['{bad','x'.repeat(50000),JSON.stringify({...value,version:9})]) expect(decodeCityStoryDraft(raw)).toEqual(createCityStoryDraft());
  });
  it('keeps story briefs locally while shared URLs carry only an opaque story ID',()=>{
    const defaults={brief:DEFAULT_BRIEF,mode:'fixture' as const,strategy:'agent' as const,scenario:'normal' as const,imageChoice:'photo' as const};
    const state=createWorkspace(defaults),story=storyBriefFromDraft(draft());
    const persisted={...state,draft:{...defaults,brief:{...DEFAULT_BRIEF,story}}};
    expect(decodeWorkspace(JSON.stringify(persisted),defaults).draft.brief).toHaveProperty('story',story);
    const routed=workspaceFromSearch(state,'?view=diorama&story=33333333-3333-4333-8333-333333333333');
    expect(routed).toHaveProperty('storyId','33333333-3333-4333-8333-333333333333');
    expect(workspaceSearch(routed)).toContain('story=33333333-3333-4333-8333-333333333333');
    expect(workspaceSearch({...routed,...persisted})).not.toContain('기억');
    expect(workspaceFromSearch(state,'?view=diorama&story=forged')).toHaveProperty('storyId',null);
  });
  it('reports invalid saved camera data so the caller can preserve the original notes',()=>{
    const raw=JSON.stringify({...draft(),stops:[{...stops[0],note:'남겨야 할 메모',camera:{position:[1,2,3],target:[0,0,0],zoom:0}},stops[1]]});
    expect(restoreCityStoryDraft(raw).error).toBeTruthy();
    expect(restoreCityStoryDraft(null).error).toBeNull();
    expect(restoreCityStoryDraft(JSON.stringify(draft())).draft.stops).toHaveLength(3);
  });
});
