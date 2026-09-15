import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import type { Run } from "../src/lib/types";
import { mockOsmEmbed } from "./helpers/mock-osm";
import { newRun } from "../src/lib/run";

const nav = (page: Page, name: string) => page.getByRole("navigation", {name:"주 메뉴"}).getByRole("button", {name, exact:true});
test.beforeEach(async ({page}) => {
  await mockOsmEmbed(page);
  await page.addInitScript(() => localStorage.setItem("timestory:tami-guide:v1", JSON.stringify({version:1,tutorial:{version:1,status:"idle",step:0,placeId:null,runId:null,sourcePlaceId:null},preferences:{minimized:true,animationOff:true,invitationDismissed:true}})));
});

test("stale claim support is not displayed as a current verified result", async ({page}) => {
  const run = newRun({mode:'fixture'});
  run.version=2;run.reviewVersion=null;run.status='needs_review';
  run.cards=[{id:'card-1',title:'편집한 제목',body:'판교박물관의 이야기',script:'판교박물관의 이야기',claimIds:['claim-1'],imagination:false}];
  run.claims=[{id:'claim-1',cardId:'card-1',text:'판교박물관의 이야기',kind:'fact',support:'supported',evidenceIds:[]}];
  await page.route(`**/api/runs/${run.id}`,route=>route.fulfill({json:run}));
  await page.goto(`/?view=studio&run=${run.id}`);
  await expect(page.locator('.evidence-detail h3')).toHaveText('현재 버전 재검수 필요',{timeout:3000});
  await expect(page.getByRole('region',{name:'문장별 세부 검수'})).toContainText('현재 v2의 재검수가 필요합니다');
});

test("agent navigation restores drafts, explains actual skills and opens Tami settings", async ({page}) => {
  await page.goto('/?view=studio');
  await page.getByRole('textbox',{name:'어떤 이야기를 만들까요?',exact:true}).fill('청소년에게 알려 주고 싶은 성남의 이야기');
  await page.getByLabel('설명 방식').selectOption('easy');
  await nav(page,'AI 에이전트').click();
  await expect(page.getByRole('heading',{name:'이야기의 시작부터, 근거를 확인하는 순간까지.'})).toBeVisible();
  await expect(page.locator('.agent-skill')).toHaveCount(6);
  await page.locator('.agent-skill').filter({hasText:'제작 단계 마무리'}).locator('summary').click();
  await expect(page.locator('.agent-skill[open]')).toContainText('에이전트의 실행 완료는 담당자 승인이 아닙니다');
  await page.reload();
  await expect(nav(page,'AI 에이전트')).toHaveAttribute('aria-current','page');
  await nav(page,'카드뉴스 작업실').click();
  await expect(page.getByLabel('설명 방식')).toHaveValue('easy');
  await expect(page.getByRole('textbox',{name:'어떤 이야기를 만들까요?',exact:true})).toHaveValue('청소년에게 알려 주고 싶은 성남의 이야기');
  await page.goBack();await expect(page.locator('.agent-center')).toBeVisible();
  await page.locator('.sidebar-help').getByRole('button',{name:'타미 설정',exact:true}).click();
  await expect(page.locator('.tami-settings')).toHaveAttribute('open','');
  await expect(page.getByLabel('움직임 끄기')).toBeVisible();
});

test("easy rewrite preserves photos, re-reviews a new version and exports approved cards", async ({page}) => {
  test.setTimeout(120000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const created=await page.request.post('/api/runs',{data:{mode:'fixture',requestId:`agent-easy-${Date.now()}`}});
  expect(created.ok()).toBe(true);
  const initial:Run=await created.json();
  let before:Run=initial;
  await expect.poll(async()=>{before=await (await page.request.get(`/api/runs/${initial.id}`)).json();return before.status;},{timeout:60000}).toBe('ready_for_approval');
  await page.goto(`/?view=agent&run=${before.id}`);
  await expect(page.locator('.agent-current')).toContainText('판교박물관의 이야기');
  await expect(page.locator('.agent-event-list>li')).toHaveCount(before.events.length);
  await expect(page.locator('.agent-current')).toContainText('저장된 응답 데모');
  await expect(page.locator('.agent-current')).toContainText('AI 검수 통과 · 승인 대기');
  await page.getByRole('button',{name:'문장과 근거 확인 →',exact:true}).click();
  await page.getByRole('tab',{name:'직접 수정',exact:true}).click();
  await page.locator('.reading-transform summary').click();
  await page.getByRole('button',{name:'쉬운 설명으로 바꾸고 재검수',exact:true}).click();
  let after:Run=before;
  await expect.poll(async()=>{after=await (await page.request.get(`/api/runs/${before.id}`)).json();return `${after.version}:${after.status}`;},{timeout:60000}).toBe(`${before.version+1}:ready_for_approval`);
  expect(after.brief.readingStyle).toBe('easy');expect(after.approval).toBeNull();
  expect(after.cards.map(card=>card.image)).toEqual(before.cards.map(card=>card.image));
  expect(after.cards[1].body).toContain('돌로 방을 만든 무덤');
  expect(after.cards[1].body).toContain('일부');
  expect(after.cards[0].body).toContain('2013년 4월 2일');
  expect(after.reviewVersion).toBe(after.version);
  await expect(page.locator('.reading-transform')).toContainText('쉬운 설명을 적용한 카드뉴스');
  await page.getByRole('tab',{name:'문장 근거',exact:true}).click();
  await page.getByRole('button',{name:/2장 .* 근거 보기/}).click();
  const review=page.getByRole('region',{name:'문장별 세부 검수'});
  await expect(review).toContainText('돌로 방을 만든 무덤');
  await expect(review).toContainText('자료 수집일은 원문의 발행·수정일과 다릅니다');
  await review.getByRole('button',{name:'본문 편집으로 이동',exact:true}).first().click();
  await expect(page.getByRole('textbox',{name:'카드 본문',exact:true})).toBeFocused();
  await page.getByLabel('확인 담당자').fill('통합 검증 담당자');
  await page.getByRole('button',{name:'최종 결과 승인',exact:true}).click();
  await expect(page.locator('.status-chip[role=status]')).toHaveText('담당자 승인 완료');
  const downloaded=page.waitForEvent('download');
  await page.getByRole('link',{name:'카드뉴스 패키지 다운로드',exact:false}).click();
  const download=await downloaded;
  await mkdir('outputs/focused-agent',{recursive:true});
  await download.saveAs('outputs/focused-agent/easy-timestory.zip');
  const response=await page.request.get(`/api/runs/${before.id}/files/timestory.zip`);
  expect(response.ok()).toBe(true);
  const files=unzipSync(new Uint8Array(await response.body()));
  const pngs=Object.entries(files).filter(([name])=>name.endsWith('.png'));
  expect(pngs).toHaveLength(4);
  for(const [name,bytes] of pngs){const data=Buffer.from(bytes);expect(data.readUInt32BE(16)).toBe(1080);expect(data.readUInt32BE(20)).toBe(1080);await writeFile(`outputs/focused-agent/${name.split('/').at(-1)}`,bytes);}
  await nav(page,'AI 에이전트').click();
  await expect(page.locator('.agent-current')).toContainText('담당자 승인 완료');
  for(const width of [1440,1024,390]){
    await page.setViewportSize({width,height:width===390?844:1000});
    await expect(nav(page,'AI 에이전트')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    await page.screenshot({path:`outputs/focused-agent/final-agent-${width}.png`,fullPage:true});
  }
  await nav(page,'카드뉴스 작업실').click();
  await page.getByRole('tab',{name:'문장 근거',exact:true}).click();
  await page.screenshot({path:'outputs/focused-agent/final-review-390.png',fullPage:true});
  expect(errors).toEqual([]);
  await writeFile('outputs/focused-agent/verification.json',JSON.stringify({runId:after.id,version:after.version,reviewVersion:after.reviewVersion,apiCalls:after.execution?.apiCalls,errors,pngs:pngs.length},null,2));
});
