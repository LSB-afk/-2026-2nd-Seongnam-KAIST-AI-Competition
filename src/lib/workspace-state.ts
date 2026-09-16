import { cityStoryBriefSchema } from './city-story';
import { normaliseDiorama, type DioramaSelection } from './diorama/data';
import { getPlace, PLACES, type Place } from './places';
import type { Brief, Mode, Run, Scenario, Strategy } from './types';

export type WorkspaceView = 'dashboard' | 'explore' | 'saved' | 'studio' | 'history' | 'agent' | 'diorama';
export type ReviewTab = 'evidence' | 'changes' | 'edit' | 'image';
export type PlaceTheme = 'all' | 'history' | 'nature' | 'art' | 'market';
export type MapViewport = { lat: number; lng: number; zoom: number };
export type ExploreState = { query: string; district: string; category: string; theme: PlaceTheme; selectedId: string | null; mobileView: 'list' | 'map'; mapView?: MapViewport };
export type DraftState = { brief: Brief; mode: Mode; strategy: Strategy; scenario: Scenario; imageChoice: 'photo' | 'ai' };
export type EditDraft = { runId: string; version: number; cardId: string; title: string; body: string };
export type CreateRequest = { brief: Brief; mode: Mode; strategy: Strategy; scenario: Scenario; requestId: string };
/** A creation POST that may still be in flight, kept verbatim so a reload can resend it to the idempotent server. */
export type PendingCreate = { runId: string | null; body: CreateRequest };
export type WorkspaceState = { version: 1; storyId: string | null; storyPreview: boolean; view: WorkspaceView; diorama: DioramaSelection; explore: ExploreState; savedIds: string[]; draft: DraftState; runId: string | null; selectedCardId: string; tab: ReviewTab; editDrafts: EditDraft[]; historyQuery: string; historyStatus: string; pendingCreate: PendingCreate | null };
export const WORKSPACE_STORAGE_KEY = 'timestory.workspace.v1';
export const PLACE_THEMES: { id: Exclude<PlaceTheme,'all'>; label: string; types: Place['type'][] }[] = [
  {id:'history',label:'역사·문화유산',types:['박물관','문화유산']},
  {id:'nature',label:'공원·산책',types:['공원']},
  {id:'art',label:'예술·전시',types:['문화예술']},
  {id:'market',label:'전통시장',types:['전통시장']},
];
const VIEWS: WorkspaceView[] = ['dashboard','explore','saved','studio','history','agent','diorama'];
const TABS: ReviewTab[] = ['evidence','changes','edit','image'];
const STATUSES = ['all','queued','running','needs_review','ready_for_approval','approved','failed','cancelled'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): Record<string,unknown> => value && typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const string = (value: unknown, fallback = '', max = 100) => typeof value==='string' && value.length<=max ? value : fallback;
function oneOf<T extends string>(value:unknown, values: readonly T[], fallback:T):T { return values.includes(value as T) ? value as T : fallback; }
export function defaultExplore(): ExploreState { return {query:'',district:'전체 지역',category:'전체 유형',theme:'all',selectedId:null,mobileView:'list'}; }
export function createWorkspace(draft: DraftState): WorkspaceState { return {version:1,storyId:null,storyPreview:false,view:'dashboard',diorama:normaliseDiorama(null),explore:defaultExplore(),savedIds:[],draft:{...draft,brief:{...draft.brief}},runId:null,selectedCardId:'',tab:'evidence',editDrafts:[],historyQuery:'',historyStatus:'all',pendingCreate:null}; }
export function filterPlaces(filters: ExploreState, savedIds?: string[]): Place[] {
  const theme = PLACE_THEMES.find(t=>t.id===filters.theme);
  const q=filters.query.trim().toLocaleLowerCase();
  return PLACES.filter(place=>(!savedIds||savedIds.includes(place.id)) && (filters.district==='전체 지역'||filters.district===place.district) && (filters.category==='전체 유형'||filters.category===place.type) && (!theme||theme.types.includes(place.type)) && `${place.name} ${place.description} ${place.address}`.toLocaleLowerCase().includes(q));
}
export function normaliseExplore(value:unknown):ExploreState {
  const raw=record(value);
  const base:ExploreState={query:string(raw.query,'',100),district:oneOf(raw.district,['전체 지역','수정구','중원구','분당구'],'전체 지역'),category:oneOf(raw.category,['전체 유형',...new Set(PLACES.map(p=>p.type))],'전체 유형'),theme:oneOf(raw.theme,['all','history','nature','art','market'],'all'),selectedId:getPlace(string(raw.selectedId))?.id||null,mobileView:oneOf(raw.mobileView,['list','map'],'list')};
  const view=record(raw.mapView);
  if(typeof view.lat==='number'&&Number.isFinite(view.lat)&&view.lat>=31&&view.lat<=44&&typeof view.lng==='number'&&Number.isFinite(view.lng)&&view.lng>=123&&view.lng<=133&&typeof view.zoom==='number'&&Number.isInteger(view.zoom)&&view.zoom>=5&&view.zoom<=20) base.mapView={lat:view.lat,lng:view.lng,zoom:view.zoom};
  if(base.selectedId&&!filterPlaces(base).some(p=>p.id===base.selectedId))base.selectedId=null;
  return base;
}
export function toggleSavedPlace(ids: string[], id: string): string[] { if(!getPlace(id))return ids;return ids.includes(id)?ids.filter(item=>item!==id):[...ids,id]; }
export function matchingEditDraft(drafts:EditDraft[],runId:string,version:number,cardId:string):EditDraft|null { return drafts.find(d=>d.runId===runId&&d.version===version&&d.cardId===cardId)||null; }
export function upsertEditDraft(drafts:EditDraft[],draft:EditDraft):EditDraft[] { return [...drafts.filter(d=>d.runId!==draft.runId||d.cardId!==draft.cardId),draft].slice(-24); }
export function decodeWorkspace(raw:string|null,draft:DraftState):WorkspaceState {
  const base=createWorkspace(draft);
  if(!raw||raw.length>65536)return base;
  try {
    const value=record(JSON.parse(raw));if(value.version!==1)return base;
    const savedDraft=record(value.draft), brief=record(savedDraft.brief);
    const place=getPlace(string(brief.placeId)||string(brief.place))||getPlace(draft.brief.placeId||draft.brief.place)||PLACES[0];
    const purpose=oneOf(brief.purpose,['place_intro','visit_guide','youth_story'],'youth_story');
    const restoredBrief:Brief={place:place.name,placeId:place.id,audience:string(brief.audience,draft.brief.audience,40),goal:string(brief.goal,draft.brief.goal,1000),cardCount:4,includeFuture:true,readingStyle:oneOf(brief.readingStyle,['standard','easy'] as const,'standard'),...(brief.purpose?{purpose}:draft.brief.purpose?{purpose:draft.brief.purpose}:{})};
    const story=cityStoryBriefSchema.safeParse(brief.story);
    if(story.success&&story.data.stops[0].placeId===place.id)restoredBrief.story=story.data;
    const editDrafts:EditDraft[]=Array.isArray(value.editDrafts)?value.editDrafts.slice(-24).flatMap(v=>{const d=record(v);return UUID.test(string(d.runId))&&Number.isInteger(d.version)&&Number(d.version)>=0&&/^card-[1-4]$/.test(string(d.cardId))&&typeof d.title==='string'&&d.title.length<=80&&typeof d.body==='string'&&d.body.length<=500?[{runId:String(d.runId),version:Number(d.version),cardId:String(d.cardId),title:d.title,body:d.body}]:[];}):[];
    // The request body is resent unchanged: the server only returns the existing run for identical conditions.
    const pending=record(value.pendingCreate),request=record(pending.body);
    const pendingCreate:PendingCreate|null=UUID.test(string(request.requestId))&&record(request.brief)===request.brief&&oneOf(request.mode,['fixture','live'],'fixture')===request.mode&&oneOf(request.strategy,['agent','baseline'],'agent')===request.strategy&&oneOf(request.scenario,['normal','causal','future','mismatch','unavailable','persistent'],'normal')===request.scenario?{runId:UUID.test(string(pending.runId))?String(pending.runId):null,body:request as CreateRequest}:null;
    return {...base,storyId:UUID.test(string(value.storyId))?String(value.storyId):null,storyPreview:value.storyPreview===true,pendingCreate,view:oneOf(value.view,VIEWS,'dashboard'),diorama:normaliseDiorama(value.diorama),explore:normaliseExplore(value.explore),savedIds:[...new Set(Array.isArray(value.savedIds)?value.savedIds.filter((id):id is string=>typeof id==='string'&&!!getPlace(id)):[])],draft:{brief:restoredBrief,mode:oneOf(savedDraft.mode,['fixture','live'],'fixture'),strategy:oneOf(savedDraft.strategy,['agent','baseline'],'agent'),scenario:oneOf(savedDraft.scenario,['normal','causal','future','mismatch','unavailable','persistent'],'normal'),imageChoice:oneOf(savedDraft.imageChoice,['photo','ai'],'photo')},runId:UUID.test(string(value.runId))?String(value.runId):null,selectedCardId:/^card-[1-4]$/.test(string(value.selectedCardId))?String(value.selectedCardId):'',tab:oneOf(value.tab,TABS,'evidence'),editDrafts,historyQuery:string(value.historyQuery,'',100),historyStatus:oneOf(value.historyStatus,STATUSES,'all')};
  } catch { return base; }
}
const ROUTE_KEYS=['view','place','district','category','theme','q','run','card','tab','lat','lng','zoom','display','scene','spot','story','preview'];
export function workspaceSearch(state:WorkspaceState):string {
  const p=new URLSearchParams();p.set('view',state.view);
  const f=state.explore;
  if(state.view==='diorama'&&state.storyId)p.set('story',state.storyId);
  if(state.view==='diorama'&&state.storyPreview&&state.runId)p.set('preview','story');
  if(state.view==='diorama'){p.set('scene',state.diorama.placeId);if(state.diorama.hotspotId)p.set('spot',state.diorama.hotspotId);}
  if(f.selectedId)p.set('place',f.selectedId);
  if(f.query)p.set('q',f.query);
  if(f.district!=='전체 지역')p.set('district',f.district);
  if(f.category!=='전체 유형')p.set('category',f.category);
  if(f.theme!=='all')p.set('theme',f.theme);
  if(f.mobileView==='map')p.set('display','map');
  if(f.mapView){p.set('lat',f.mapView.lat.toFixed(5));p.set('lng',f.mapView.lng.toFixed(5));p.set('zoom',String(f.mapView.zoom));}
  if(state.runId)p.set('run',state.runId);
  if(state.selectedCardId)p.set('card',state.selectedCardId);
  if(state.tab!=='evidence')p.set('tab',state.tab);
  return `?${p.toString()}`;
}
export function workspaceFromSearch(state:WorkspaceState,search:string,restoreWhenEmpty=false):WorkspaceState {
  const p=new URLSearchParams(search);
  if(!ROUTE_KEYS.some(k=>p.has(k))&&restoreWhenEmpty)return state;
  const mapView=p.has('lat')&&p.has('lng')&&p.has('zoom')?{lat:Number(p.get('lat')),lng:Number(p.get('lng')),zoom:Number(p.get('zoom'))}:undefined;
  return {...state,storyId:p.get('view')==='diorama'&&UUID.test(p.get('story')||'')?p.get('story'):null,storyPreview:p.get('view')==='diorama'&&p.get('preview')==='story'&&UUID.test(p.get('run')||''),view:oneOf(p.get('view'),VIEWS,'dashboard'),diorama:p.get('view')==='diorama'?normaliseDiorama({placeId:p.get('scene'),hotspotId:p.get('spot')}):state.diorama,explore:normaliseExplore({query:p.get('q')||'',district:p.get('district'),category:p.get('category'),theme:p.get('theme'),selectedId:p.get('place'),mobileView:p.get('display'),mapView}),runId:UUID.test(p.get('run')||'')?p.get('run'):null,selectedCardId:/^card-[1-4]$/.test(p.get('card')||'')?p.get('card')!:'',tab:oneOf(p.get('tab'),TABS,'evidence')};
}
export function shouldAcceptRun(current:Run|null,incoming:Run):boolean {
  if(!current)return true;
  if(current.id!==incoming.id||incoming.version<current.version)return false;
  if(incoming.version>current.version)return true;
  const currentAt=Date.parse(current.updatedAt),incomingAt=Date.parse(incoming.updatedAt);
  if(Number.isFinite(currentAt)&&Number.isFinite(incomingAt)&&incomingAt<currentAt)return false;
  if(current.status==='approved'&&incoming.status!=='approved'&&incomingAt<=currentAt)return false;
  return true;
}
