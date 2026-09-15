import { expect, test, type Page } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import type { Run } from '../src/lib/types';
import { mockOsmEmbed } from './helpers/mock-osm';

const panel = (page:Page)=>page.locator('#diorama-place-panel');
async function openCity(page:Page, placeId='pangyo-museum') {
  await page.goto(`/?view=diorama&scene=${placeId}`);
  await expect(page.getByTestId('diorama-stage')).toHaveAttribute('data-status','ready');
  if(await page.getByRole('button',{name:'명소 패널 열기',exact:true}).isVisible())await page.getByRole('button',{name:'명소 패널 열기',exact:true}).click();
}
async function choosePlace(page:Page,name:string) {
  await panel(page).getByRole('button',{name:'둘러보기',exact:true}).click();
  await page.getByRole('searchbox',{name:'명소 검색'}).fill(name);
  await page.getByRole('button',{name:`${name} 장면 보기`,exact:true}).click();
}
async function storyDraft(page:Page) { return page.evaluate(()=>JSON.parse(localStorage.getItem('timestory.city-story.v1')||'{}')); }

test.beforeEach(async({page})=>{
  await mockOsmEmbed(page);
  await page.addInitScript(()=>localStorage.setItem('timestory:tami-guide:v1',JSON.stringify({version:1,tutorial:{version:1,status:'idle',step:0,placeId:null,runId:null,sourcePlaceId:null},preferences:{minimized:true,animationOff:true,invitationDismissed:true}})));
  await page.emulateMedia({reducedMotion:'reduce'});
});

test('three selected places preserve their sources, pictures and camera through approval and shared 3D playback',async({page,request})=>{
  test.setTimeout(150000);
  await openCity(page);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.getByRole('button',{name:'+ 내 이야기에 담기',exact:true}).click();
  await expect(page.getByRole('button',{name:'이 구성으로 카드뉴스 만들기'})).toBeDisabled();
  await page.getByRole('button',{name:'판교박물관 이야기 설정 펼치기'}).click();
  await page.getByRole('textbox',{name:'판교박물관 이야기 메모'}).fill('비공개 이야기 메모: 친구와 도시를 걸었던 날');
  await page.getByRole('button',{name:'판교박물관 현재 지도 구도 저장'}).click();
  expect((await storyDraft(page)).stops[0].camera.zoom).toBeGreaterThan(0);
  await choosePlace(page,'중앙공원');
  await page.getByRole('button',{name:'+ 내 이야기에 담기',exact:true}).click();
  await choosePlace(page,'모란민속5일장');
  await page.getByRole('button',{name:'+ 내 이야기에 담기',exact:true}).click();
  await page.getByRole('button',{name:'모란민속5일장 순서 앞으로'}).click();
  await page.getByRole('button',{name:'중앙공원 이야기 설정 펼치기'}).click();
  await page.getByRole('checkbox',{name:'중앙공원 등록 사진 사용'}).uncheck();
  expect((await storyDraft(page)).stops.map((stop:{placeId:string})=>stop.placeId)).toEqual(['pangyo-museum','moran-market','central-park']);
  await page.getByRole('button',{name:'이 구성으로 카드뉴스 만들기'}).click();
  await expect(page.getByRole('textbox',{name:'이야기로 연결할 장소'})).toHaveValue('판교박물관 · 모란민속5일장 · 중앙공원');
  await page.reload();
  await expect(page.getByRole('textbox',{name:'이야기로 연결할 장소'})).toHaveValue('판교박물관 · 모란민속5일장 · 중앙공원');
  const created=page.waitForResponse(response=>response.url().endsWith('/api/runs')&&response.request().method()==='POST');
  await page.locator('[data-tour=create-run]').click();
  const initial=await(await created).json() as Run;
  let run:Run=initial;
  await expect.poll(async()=>{run=await(await request.get(`/api/runs/${initial.id}`)).json();return run.status;},{timeout:80000}).toBe('ready_for_approval');
  expect(run.cards.map(card=>card.placeId)).toEqual(['pangyo-museum','moran-market','central-park','central-park']);
  expect(run.cards[0].image?.placeId).toBe('pangyo-museum');expect(run.cards[1].image?.placeId).toBe('moran-market');expect(run.cards[2].image).toBeUndefined();
  expect((await request.post('/api/stories',{data:{runId:run.id,version:run.version}})).status()).toBe(409);
  const cropped=await request.post(`/api/runs/${run.id}/image`,{data:{version:run.version,cardId:'card-1',operation:'crop',crop:{x:.2,y:.8,zoom:1.4}}});
  expect(cropped.ok()).toBe(true);run=await cropped.json();await page.reload();
  await page.getByRole('button',{name:'수정 내용 재검수',exact:true}).click();
  await page.getByRole('textbox',{name:'확인 담당자'}).fill('도시 이야기 검토자');
  await page.getByRole('button',{name:'최종 결과 승인',exact:true}).click();
  await page.getByRole('button',{name:'공유 링크·QR 만들기',exact:true}).click();
  const link=page.getByRole('textbox',{name:'공유 이야기 주소'});await expect(link).toBeVisible();
  const url=await link.inputValue();
  await expect(page.getByRole('img',{name:'3D 이야기 공유 QR 코드'})).toBeVisible();
  const id=new URL(url).pathname.split('/').at(-1);
  const snapshot=await(await request.get(`/api/stories/${id}`)).json();
  expect(JSON.stringify(snapshot)).not.toContain('비공개 이야기 메모');expect(JSON.stringify(snapshot)).not.toContain('도시 이야기 검토자');
  expect(snapshot).not.toHaveProperty('runId');expect(snapshot.cards[0].image.crop).toEqual({x:.2,y:.8,zoom:1.4});
  expect(snapshot.stops[0].camera).toEqual(run.brief.story!.stops[0].camera);
  const sharedRequests:string[]=[];page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))sharedRequests.push(new URL(request.url()).pathname);});
  await page.goto(url);
  await expect(page.getByTestId('diorama-stage')).toHaveAttribute('data-status','ready');
  await expect(page.getByRole('region',{name:'성남의 기억·생활·쉼'})).toBeVisible();
  await expect(page.locator('.city-story-image-frame img')).toHaveCSS('object-position','20% 80%');
  expect(sharedRequests.some(path=>path==='/api/runs'||path.startsWith('/api/runs/'))).toBe(false);
  await expect(page.getByRole('group',{name:'도시 체험 선택'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'이야기 자동 재생',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'다음 이야기 카드',exact:true}).click();
  await expect(page).toHaveURL(/scene=moran-market/);
  await expect(page.locator('.city-story-playing-card')).toContainText('모란민속5일장');
  await page.getByRole('button',{name:'다음 이야기 카드',exact:true}).click();
  await page.getByRole('button',{name:'다음 이야기 카드',exact:true}).click();
  await expect(page.locator('.city-story-playing-card')).toContainText('AI 상상');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.getByRole('button',{name:'이야기 자동 재생',exact:true}).click();
  await expect(page.getByRole('button',{name:'이야기 일시정지',exact:true})).toBeVisible();
  await page.mouse.move(500,400);await page.mouse.down();await page.mouse.move(570,440,{steps:6});await page.mouse.up();
  await expect(page.getByRole('button',{name:'이야기 자동 재생',exact:true})).toBeVisible();
  await expect(page.locator('.diorama-webgl canvas')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('time lens preserves record dates and detective reports contain only successfully checked evidence',async({page})=>{
  await openCity(page);
  await panel(page).getByRole('button',{name:'시간·탐정',exact:true}).click();
  await page.getByRole('tab',{name:'그때',exact:true}).click();
  await expect(page.getByRole('tabpanel')).toContainText('2013-04-02');
  await expect(page.getByRole('tabpanel')).toContainText('2014-11-13');
  await page.getByRole('tab',{name:'지금',exact:true}).click();
  await expect(page.getByRole('tabpanel')).toContainText('오늘 촬영한 사진이나 실시간 화면이 아니에요');
  const detective=page.getByRole('region',{name:'타미 탐정단'});
  await detective.getByRole('radio').first().check();
  await detective.getByRole('button',{name:'선택한 근거 확인하기'}).click();
  await expect(detective.getByRole('button',{name:'내 탐험 보고서 내려받기'})).toBeDisabled();
  await detective.getByRole('radio',{name:/30분/}).check();
  await detective.getByRole('button',{name:'선택한 근거 확인하기'}).click();
  const download=page.waitForEvent('download');await detective.getByRole('button',{name:'내 탐험 보고서 내려받기'}).click();
  const path=await(await download).path();const report=await readFile(path!,'utf8');
  expect(report).toContain('판교박물관');expect(report).toContain('https://museum.seongnam.go.kr/');expect(report).toContain('30분');
  await page.getByRole('tab',{name:'만약',exact:true}).click();
  await page.getByRole('textbox',{name:'만약, 이 장소가…'}).fill('청소년이 별을 관찰하는 문화공간이라면');
  await page.getByRole('button',{name:'이 상상으로 카드 만들기'}).click();
  await expect(page.getByRole('textbox',{name:'어떤 이야기를 만들까요?'})).toHaveValue(/청소년이 별을 관찰하는 문화공간이라면/);
});

test('personal memories require local review before reuse, strip image metadata, and can be withdrawn and deleted',async({page})=>{
  await openCity(page);
  await panel(page).getByRole('button',{name:'기억',exact:true}).click();
  const memory=page.getByRole('region',{name:'시민 기억 지도'});
  await memory.getByRole('textbox',{name:'판교박물관에서의 내 기억'}).fill('친구와 함께 처음 박물관을 찾아갔던 날이 기억나요.');
  await memory.getByRole('checkbox',{name:/사용할 권리가 있고/}).first().check();
  await memory.getByRole('checkbox',{name:/이야기 메모로 활용하는 데 동의/}).first().check();
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNXEAAAAASUVORK5CYII=','base64');
  await memory.getByLabel('함께 보관할 사진',{exact:false}).setInputFiles({name:'memory.png',mimeType:'image/png',buffer:png});
  await expect(memory.getByRole('img',{name:'보관할 개인 사진 미리보기'})).toBeVisible();
  await memory.getByRole('button',{name:'비공개 초안으로 보관'}).click();
  await expect(memory.getByRole('button',{name:'이야기 메모로 사용'})).toBeDisabled();
  await memory.getByRole('button',{name:'이 기기에서 검토 완료'}).click();
  await memory.getByRole('button',{name:'이야기 메모로 사용'}).click();
  const draft=await storyDraft(page);expect(draft.stops[0].note).toContain('[개인 기억 · 공식 근거 아님]');expect(JSON.stringify(draft)).not.toContain('data:image');
  await panel(page).getByRole('button',{name:'기억',exact:true}).click();
  await memory.getByRole('button',{name:'활용 철회',exact:true}).click();
  await expect(memory.getByRole('button',{name:'이야기 메모로 사용'})).toBeDisabled();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('timestory.city-memories.v1')||'{}').records[0].photo)).toBeNull();
  await memory.getByRole('button',{name:'기억 삭제'}).click();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('timestory.city-memories.v1')||'{}').records)).toEqual([]);
});

for(const width of [1440,1024,390])test(`city story and sourced food remain usable at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await openCity(page,'central-park');
  await expect(page.locator('[data-city-place=central-park] img').first()).toBeVisible();
  await panel(page).getByRole('button',{name:'먹거리',exact:true}).click();
  await expect(page.getByRole('heading',{name:'중앙공원 주변 먹거리'})).toBeVisible();
  await expect(page.locator('.city-food-list')).toContainText('평양면옥');
  await expect(page.locator('.city-food-list')).toContainText('한국관광공사 소개');
  await page.getByRole('button',{name:'성남 전체',exact:true}).click();
  await expect(page.locator('.city-food-list')).toContainText('2026 성남 힙스토어 선정');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)).toBe(false);
  await mkdir('outputs/seongnam-city-story-development',{recursive:true});
  await page.screenshot({path:`outputs/seongnam-city-story-development/food-${width}.png`});
  await panel(page).getByRole('button',{name:'둘러보기',exact:true}).click();
  await panel(page).getByRole('button',{name:/^명소 52$/}).click();
  await page.getByRole('button',{name:'+ 내 이야기에 담기',exact:true}).click();
  await expect(page.getByRole('heading',{name:'내 도시 이야기'})).toBeVisible();
  await page.screenshot({path:`outputs/seongnam-city-story-development/story-${width}.png`});
  await page.getByRole('button',{name:'명소 패널 접기',exact:true}).click();
  await expect(panel(page)).toBeHidden();
  await expect(page.getByRole('button',{name:'지도 이동 모드',exact:true})).toBeVisible();
});

test('invalid stored story remains recoverable until the user explicitly replaces it',async({page})=>{
  const raw=JSON.stringify({version:1,title:'보존할 제목',audience:'청소년',stops:[{id:'pangyo-museum',placeId:'pangyo-museum',photoChoice:'place',note:'보존할 개인 메모',camera:{position:[1,2,3],target:[0,0,0],zoom:0}}]});
  await page.addInitScript(value=>localStorage.setItem('timestory.city-story.v1',value),raw);
  await openCity(page);
  await expect(page.getByRole('button',{name:'보관 원본 내려받기'})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('timestory.city-story.v1'))).toBe(raw);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'보관 원본 내려받기'}).click();
  expect(await readFile((await(await download).path())!,'utf8')).toBe(raw);
  await page.getByRole('button',{name:'현재 이야기로 보관함 교체'}).click();
  expect((await storyDraft(page)).stops).toEqual([]);
});
