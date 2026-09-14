import {test,expect,type Page} from '@playwright/test';
import {newRun} from '../src/lib/run';
import type {Run} from '../src/lib/types';
import {mockOsmEmbed} from './helpers/mock-osm';

function fixture(title:string):Run {
 const run=newRun({mode:'fixture'});return {...run,status:'needs_review',version:1,cards:[1,2,3,4].map(n=>({id:`card-${n}`,title:`${title} ${n}`,body:'공식 자료를 확인하며 이야기를 만드는 본문입니다.',script:'공식 자료를 확인합니다.',claimIds:[],imagination:n===4}))};
}
async function setup(page:Page,runs:Run[]=[]){
 await mockOsmEmbed(page);
 await page.route('**/api/map-config',r=>r.fulfill({json:{provider:'naver',configured:false,reason:'테스트: 지도 설정 없음'}}));
 await page.route('**/api/config',r=>r.fulfill({json:{live:{configured:false},image:{configured:false}}}));
 await page.route('**/api/runs',r=>r.fulfill({json:runs}));
 await page.addInitScript(()=>localStorage.setItem('timestory:tami-guide:v1',JSON.stringify({version:1,tutorial:{version:1,status:'idle',step:0,placeId:null,runId:null,sourcePlaceId:null},preferences:{minimized:false,animationOff:true,invitationDismissed:true}})));
}
const nav=(page:Page,name:string)=>page.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name:new RegExp('^'+name)});

test('filters, selected place, saved places and incomplete draft survive reload and browser back',async({page})=>{
 await setup(page);await page.goto('/');await nav(page,'성남 둘러보기').click();
 await page.getByRole('textbox',{name:'관광지 검색',exact:true}).fill('율동');
 await page.locator('.place-result').click();await page.getByRole('button',{name:'♡ 이 장소 저장',exact:true}).click();
 await page.reload();await expect(page.locator('.place-detail h2')).toHaveText('율동공원');
 await expect(page.getByRole('textbox',{name:'관광지 검색',exact:true})).toHaveValue('율동');
 await expect(page.getByRole('button',{name:'♥ 저장한 장소에서 해제',exact:true})).toBeVisible();
 await nav(page,'홈·대시보드').click();await page.goBack();await expect(page.locator('.place-detail h2')).toHaveText('율동공원');
 await nav(page,'저장한 장소').click();await expect(page.locator('.place-result')).toHaveCount(1);
 await page.getByRole('button',{name:/이 장소로 카드뉴스 만들기/}).click();
 const goal=page.getByRole('textbox',{name:'어떤 이야기를 만들까요?',exact:true});await goal.fill('작성 중');
 await page.reload();await expect(goal).toHaveValue('작성 중');await expect(page.getByRole('textbox',{name:'소개할 장소',exact:true})).toHaveValue('율동공원');
 await nav(page,'성남 둘러보기').click();await page.getByRole('button',{name:'검색 조건 초기화',exact:true}).first().click();await expect(page.locator('.place-result')).toHaveCount(8);
 await nav(page,'저장한 장소').click();await page.getByRole('button',{name:'율동공원 저장 해제',exact:true}).click();await expect(page.locator('.place-result')).toHaveCount(0);await page.reload();await expect(page.getByRole('heading',{name:'저장한 장소가 아직 없어요.'})).toBeVisible();
});

test('card drafts stay separate across cards, reload and server version changes',async({page})=>{
 let run=fixture('서버 제목');await setup(page,[run]);await page.route(`**/api/runs/${run.id}`,r=>r.fulfill({json:run}));
 await page.goto(`/?view=studio&run=${run.id}&tab=edit`);
 const title=page.getByLabel('카드 제목',{exact:true});await expect(title).toHaveValue('서버 제목 1');await title.fill('내가 작성 중인 첫 장');
 await page.getByRole('button',{name:/2장 .* 근거 보기/}).click();await title.fill('내가 작성 중인 둘째 장');
 await page.getByRole('button',{name:/1장 .* 근거 보기/}).click();await expect(title).toHaveValue('내가 작성 중인 첫 장');
 await page.getByRole('tab',{name:'문장 근거',exact:true}).click();await page.getByRole('tab',{name:'직접 수정',exact:true}).click();await expect(title).toHaveValue('내가 작성 중인 첫 장');
 await page.reload();await expect(title).toHaveValue('내가 작성 중인 첫 장');
 run={...run,version:2,cards:run.cards.map(c=>({...c,title:'새 서버 버전'}))};await page.reload();await expect(title).toHaveValue('새 서버 버전');
 await page.getByRole('button',{name:'이전 문구를 편집기에 불러오기'}).click();await expect(title).toHaveValue('내가 작성 중인 첫 장');
});

test('a late run response cannot replace a newer navigation selection',async({page})=>{
 const a=fixture('늦은 작업'),b=fixture('선택한 작업');await setup(page,[a,b]);
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let requested=false;
 await page.route(`**/api/runs/${a.id}`,async r=>{requested=true;await held;await r.fulfill({json:a}).catch(()=>{});});
 await page.route(`**/api/runs/${b.id}`,r=>r.fulfill({json:b}));
 await page.goto(`/?view=studio&run=${a.id}`);await expect.poll(()=>requested).toBe(true);
 await page.evaluate(id=>{history.pushState(history.state,'',`?view=studio&run=${id}`);dispatchEvent(new PopStateEvent('popstate'));},b.id);
 await expect(page.locator('.card-grid')).toContainText('선택한 작업 1');release();
 await expect(page.locator('.card-grid')).not.toContainText('늦은 작업');await expect(page).toHaveURL(new RegExp(b.id));
});

test('history filters persist and missing map configuration keeps the list usable',async({page})=>{
 const a=fixture('검색 대상'),b={...fixture('다른 제목'),status:'approved' as const};await setup(page,[a,b]);await page.goto('/');
 await nav(page,'제작 기록').click();await page.getByRole('searchbox').fill('검색 대상');
 await expect(page.locator('.history-row')).toHaveCount(1);
 await page.reload();await expect(page.getByRole('searchbox')).toHaveValue('검색 대상');
 await nav(page,'성남 둘러보기').click();await expect(page.locator('.map-frame')).toContainText('OpenStreetMap · 기본 지도');await expect(page.locator('.place-result')).toHaveCount(8);
 await page.locator('.place-result').first().click();await expect(page.locator('.place-detail')).toBeVisible();
});

test('a failed saved-run lookup can be retried without changing the selection',async({page})=>{
 const run=fixture('복원 성공');await setup(page,[run]);let failing=true;
 await page.route(`**/api/runs/${run.id}`,r=>failing?r.fulfill({status:503,json:{error:'일시적인 조회 실패'}}):r.fulfill({json:run}));
 await page.goto(`/?view=studio&run=${run.id}`);await expect(page.locator('.error-banner[role=alert]')).toContainText('일시적인 조회 실패');failing=false;
 await page.getByRole('button',{name:'작업 다시 불러오기',exact:true}).click();await expect(page.locator('.card-grid')).toContainText('복원 성공 1');
});

test('double submit makes one request and a late creation response preserves the current screen',async({page})=>{
 const run=fixture('새 작업');await setup(page);let requests=0;let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/runs',async r=>{if(r.request().method()==='POST'){requests++;await held;await r.fulfill({json:run});}else await r.fulfill({json:[]});});
 await page.goto('/?view=studio');await expect(page.locator('[data-tour=create-run]')).toBeEnabled();
 await page.locator('.brief-panel form').evaluate(form=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
 await expect.poll(()=>requests).toBe(1);await nav(page,'홈·대시보드').click();release();
 await expect(page.getByRole('heading',{name:'성남을 만나고, 나만의 이야기로.'})).toBeVisible();
 await expect.poll(async()=>page.evaluate(()=>JSON.parse(localStorage.getItem('timestory.workspace.v1')!).runId)).toBe(run.id);
 await expect(page).toHaveURL(/view=dashboard/);expect(requests).toBe(1);
});

test('mobile map and list controls scroll into reach and Korean title words stay intact',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page);await page.goto('/?view=explore');
 await expect(page.locator('.explorer-page')).toBeVisible();await page.evaluate(async()=>{await document.fonts.ready;});
 const wordLines=await page.locator('.page-heading h1').evaluate(heading=>{const node=heading.firstChild!;const start=node.textContent!.indexOf('만날까요?');const range=document.createRange();range.setStart(node,start);range.setEnd(node,start+'만날까요?'.length);return range.getClientRects().length;});expect(wordLines).toBe(1);
 await page.getByRole('button',{name:'지도',exact:true}).click();
 await expect.poll(async()=>{const box=await page.locator('.explorer-toolbar').boundingBox();return !!box&&box.y>=154&&box.y<200;}).toBe(true);
 await expect(page.locator('.osm-map-viewport iframe')).toBeVisible();await page.getByRole('button',{name:'목록',exact:true}).click();
 await expect(page.locator('.place-result').first()).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
});
