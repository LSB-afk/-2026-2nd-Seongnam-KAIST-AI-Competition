import { z } from 'zod';
import { getPlace, type Place } from './places';

const vector = z.tuple([z.number().finite().min(-20000).max(20000),z.number().finite().min(-20000).max(20000),z.number().finite().min(-20000).max(20000)]);
export const storyCameraSchema = z.object({position:vector,target:vector,zoom:z.number().finite().min(0.55).max(100)}).strict().refine(value=>value.position.some((n,i)=>Math.abs(n-value.target[i])>0.01),'카메라 위치와 시선은 달라야 합니다.');
export type StoryCameraView = z.infer<typeof storyCameraSchema>;
export function officialStoryUrls(place:Place):string[] {
  return [...new Set([place.sourceUrl,place.descriptionSourceUrl,place.operationsSourceUrl,...place.officialQuotes.map(item=>item.sourceUrl)].filter((url):url is string=>!!url))];
}
export const storyStopSchema = z.object({
  id:z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),
  placeId:z.string().refine(id=>!!getPlace(id),'등록된 장소를 선택하세요.'),
  note:z.string().max(500).optional(),
  photoChoice:z.enum(['place','none']),
  officialUrls:z.array(z.url().max(1500)).min(1).max(12).optional(),
  camera:storyCameraSchema.optional(),
}).strict().superRefine((stop,ctx)=>{
  const place=getPlace(stop.placeId);
  if(place&&stop.officialUrls?.some(url=>!officialStoryUrls(place).includes(url)))ctx.addIssue({code:'custom',path:['officialUrls'],message:'이 장소에 등록된 공식 자료만 선택할 수 있습니다.'});
});
export type StoryStop=z.infer<typeof storyStopSchema>;
const uniqueStops=(stops:StoryStop[])=>new Set(stops.map(s=>s.id)).size===stops.length&&new Set(stops.map(s=>s.placeId)).size===stops.length;
export const cityStoryBriefSchema=z.object({
  title:z.string().trim().min(1).max(80),
  stops:z.array(storyStopSchema).min(2).max(3),
  cardStopIds:z.tuple([z.string(),z.string(),z.string(),z.string()]),
}).strict().superRefine((story,ctx)=>{
  if(!uniqueStops(story.stops))ctx.addIssue({code:'custom',path:['stops'],message:'서로 다른 장소를 담으세요.'});
  if(story.cardStopIds.some(id=>!story.stops.some(stop=>stop.id===id))||story.stops.some(stop=>!story.cardStopIds.slice(0,3).includes(stop.id)))ctx.addIssue({code:'custom',path:['cardStopIds'],message:'사실 카드에 모든 선택 장소를 포함하세요.'});
});
export type CityStoryBrief=z.infer<typeof cityStoryBriefSchema>;
const draftSchema=z.object({version:z.literal(1),title:z.string().max(80),audience:z.string().max(40),stops:z.array(storyStopSchema).max(3).refine(uniqueStops)}).strict();
export type CityStoryDraft=z.infer<typeof draftSchema>;
export const CITY_STORY_STORAGE_KEY='timestory.city-story.v1';
export function createCityStoryDraft():CityStoryDraft {return {version:1,title:'성남의 기억·생활·쉼',audience:'청소년',stops:[]};}
export function decodeCityStoryDraft(raw:string|null):CityStoryDraft {
  return restoreCityStoryDraft(raw).draft;
}
export function restoreCityStoryDraft(raw:string|null):{draft:CityStoryDraft;error:string|null} {
  if(!raw)return {draft:createCityStoryDraft(),error:null};
  try {
    if(raw.length>32000)throw new Error('size');
    return {draft:draftSchema.parse(JSON.parse(raw)),error:null};
  }catch{return {draft:createCityStoryDraft(),error:'저장된 이야기를 읽지 못했어요. 기존 원본은 덮어쓰지 않았어요.'};}
}
export function storyBriefFromDraft(draft:CityStoryDraft):CityStoryBrief {
  const ids=draft.stops.map(stop=>stop.id),last=ids.at(-1)||'';
  return cityStoryBriefSchema.parse({title:draft.title,stops:draft.stops,cardStopIds:[ids[0]||'',ids[1]||'',ids[2]||last,last]});
}
