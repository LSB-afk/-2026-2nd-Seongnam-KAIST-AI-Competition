import { test, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import type { Run } from "../src/lib/types";
import { PLACES } from "../src/lib/places";

test("initial settings and history failures recover without losing the draft", async ({ page }) => {
  let failing = true;
  for (const endpoint of ["config", "runs"]) {
    await page.route(`**/api/${endpoint}`, (route) => failing
      ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporary unavailable" }) })
      : route.continue());
  }
  await page.goto("/");
  await expect(page.locator(".initial-load-error[role=alert]")).toContainText("제작 기록을 불러오지 못했습니다");
  await expect(page.getByRole("status")).toContainText("저장된 기록을 확인하지 못했습니다");
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: /카드뉴스/ }).click();
  const goal = page.getByRole("textbox", { name: "어떤 이야기를 만들까요?" });
  const draft = "가족과 함께 즐길 수 있는 성남 관광 이야기를 만들어 주세요.";
  await goal.fill(draft);
  failing = false;
  await page.getByRole("button", { name: "설정과 기록 다시 불러오기" }).click();
  await expect(page.locator(".initial-load-error[role=alert]")).toHaveCount(0);
  await expect(goal).toHaveValue(draft);
  await expect(page.getByRole("button", { name: "실제 AI", exact: true })).toBeEnabled();
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: "대시보드", exact: true }).click();
  await expect(page.locator(".history-panel")).toContainText(/\d+개 작업/);
});

test("causal error recovery, evidence, approval, download and edited-version re-review", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: /카드뉴스/ }).click();
  await expect(
    page.getByRole("heading", { name: "도시의 이야기를, 근거 있는 콘텐츠로." }),
  ).toBeVisible();
  const liveMode = page.getByRole("button", { name: "실제 AI", exact: true });
  const demoMode = page.getByRole("button", { name: "데모", exact: true });
  await expect(liveMode).toBeEnabled({ timeout: 3000 });
  await liveMode.click();
  await expect(liveMode).toHaveAttribute("aria-pressed", "true");
  await expect(demoMode).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText(/\.env\.local/)).toBeVisible();
  await expect(page.getByRole("button", { name: "AI 연결 설정 필요" })).toBeDisabled();
  await demoMode.click();
  await expect(demoMode).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "카드뉴스 제작하기" })).toBeEnabled();
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/api/runs") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "카드뉴스 제작하기" }).click();
  const response = await created;
  expect(response.ok()).toBe(true);
  const initial: Run = await response.json();
  await expect(page.locator(".status-chip[role=status]")).toHaveText("검수 통과 · 승인 대기", {
    timeout: 60000,
  });
  const run: Run = await page.request
    .get(`/api/runs/${initial.id}`)
    .then((r) => r.json());
  expect(run.version).toBe(2);
  expect(run.events.filter((e) => e.action === "search_sources").length).toBe(
    2,
  );
  expect(run.claims.some((c) => c.text.includes("AI 산업으로 이어"))).toBe(
    false,
  );
  expect(
    run.issues.some((i) => i.resolved && i.type === "unsupported_relation"),
  ).toBe(true);
  await expect(page.locator(".evidence-detail blockquote")).toContainText("2013년 4월 2일");
  expect(run.execution?.apiCalls).toBe(0);
  expect(run.searches?.map((search) => search.newEvidenceCount)).toEqual([3, 0]);
  expect(run.reviews?.map((review) => review.version)).toEqual([1, 2]);
  expect(run.assessments?.length).toBeGreaterThan(0);
  await expect(page.getByRole("region", { name: "문장별 세부 검수" })).toContainText("근거가 지지함");
  await page.getByRole("button", { name: /3장 .* 근거 보기/ }).click();
  await page.getByRole("tab", { name: "수정 내역" }).click();
  await expect(page.locator(".before")).toContainText("AI 산업으로 이어졌다");
  await expect(page.locator(".after")).toContainText("2003년부터 2008년");
  await page.getByLabel("확인 담당자").fill("시연 담당자");
  await page.getByRole("button", { name: "최종 결과 승인" }).click();
  await expect(page.locator(".status-chip[role=status]")).toHaveText("담당자 승인 완료");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "카드뉴스 패키지 다운로드" }).click();
  const download = await downloadEvent;
  const archive = unzipSync(await readFile((await download.path())!));
  expect(Object.keys(archive).filter((n) => n.endsWith(".png"))).toHaveLength(
    4,
  );
  expect(JSON.parse(strFromU8(archive["review.json"])).mode).toBe("fixture");
  for (let i = 1; i <= 4; i++) {
    const buffer = Buffer.from(archive[`card-${i}.png`]);
    expect(buffer.readUInt32BE(16)).toBe(1080);
    expect(buffer.readUInt32BE(20)).toBe(1080);
  }
  await mkdir("outputs", { recursive: true });
  await page.screenshot({
    path: "outputs/e2e-studio-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /3장 .* 근거 보기/ }).click();
  await page.getByRole("tab", { name: "직접 수정" }).click();
  await page
    .getByLabel("카드 제목", { exact: true })
    .fill("땅속에서 만나는 시간");
  await page.getByRole("button", { name: "수정 저장" }).click();
  await expect(page.locator(".status-chip[role=status]")).toHaveText("담당자 검토 필요");
  const edited: Run = await page.request
    .get(`/api/runs/${initial.id}`)
    .then((r) => r.json());
  expect(edited.version).toBe(3);
  expect(edited.approval).toBeNull();
  expect(edited.reviewVersion).toBeNull();
  expect(edited.artifacts).toHaveLength(0);
  await page.getByRole("button", { name: "수정 내용 재검수" }).click();
  await expect(page.locator(".status-chip[role=status]")).toHaveText("검수 통과 · 승인 대기", {
    timeout: 60000,
  });
  const reviewed: Run = await page.request
    .get(`/api/runs/${initial.id}`)
    .then((r) => r.json());
  expect(reviewed.cards[2].title).toBe("땅속에서 만나는 시간");
  expect(
    reviewed.artifacts.every((a) => a.version === 3 && a.reviewVersion === 3),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("tourism dashboard, geographic filters and photo edits lead to a versioned package",async({page,request})=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.route("https://tile.openstreetmap.org/**",route=>route.fulfill({contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4u0AAAAASUVORK5CYII=","base64")}));
  await page.goto("/");
  const records:Run[]=await request.get("/api/runs").then(r=>r.json());
  await expect(page.locator(".dashboard-stats > div").first()).toContainText(String(records.length));
  await page.getByRole("button",{name:"성남의 장소 탐색하기"}).click();
  await expect(page.locator(".place-result")).toHaveCount(8);
  await expect(page.locator(".map-tiles img").first()).toHaveAttribute("src",/tile\.openstreetmap\.org\/7\//);
  await page.getByRole("button",{name:/성남 (둘러보기|확대)/}).click();
  await expect(page.locator(".map-tiles img").first()).toHaveAttribute("src",/\/12\//);
  await page.getByLabel("지역 필터").selectOption("수정구");await expect(page.locator(".place-result")).toHaveCount(2);
  await page.getByLabel("지역 필터").selectOption("전체 지역");await page.getByLabel("유형 필터").selectOption("공원");await expect(page.locator(".place-result")).toHaveCount(2);
  await page.getByRole("textbox",{name:"관광지 검색",exact:true}).fill("율동");await expect(page.locator(".place-result")).toHaveCount(1);
  await page.getByRole("button",{name:"율동공원 지도에서 선택"}).click();
  await expect(page.locator(".place-result")).toHaveAttribute("aria-pressed","true");
  await expect(page.getByRole("region",{name:"율동공원 상세 정보"})).toBeVisible();
  await page.getByRole("button",{name:"이 장소로 카드뉴스 만들기"}).click();
  await expect(page.getByLabel("소개할 장소")).toHaveValue("율동공원");
  await page.getByText("시연·비교 설정",{exact:true}).click();await page.getByLabel("테스트 상황").selectOption("normal");
  const created=page.waitForResponse(r=>r.url().endsWith("/api/runs")&&r.request().method()==="POST");
  await page.getByRole("button",{name:"카드뉴스 제작하기"}).click();const first:Run=await (await created).json();
  await expect(page.locator(".status-chip[role=status]")).toHaveText("검수 통과 · 승인 대기");
  const before:Run=await request.get(`/api/runs/${first.id}`).then(r=>r.json());
  expect(before.brief.placeId).toBe("yuldong-park");expect(JSON.stringify([before.cards,before.evidence])).not.toMatch(/판교박물관|석실분/);expect(before.cards.every(c=>c.image?.placeId==="yuldong-park")).toBe(true);
  await page.getByLabel("확인 담당자").fill("관광 담당자");await page.getByRole("button",{name:"최종 결과 승인"}).click();
  await page.getByRole("tab",{name:"사진 편집"}).click();
  await page.getByLabel("사진 가로 초점").fill("0.2");await page.getByLabel("사진 확대 비율").fill("1.5");await page.getByRole("button",{name:"사진 구도 저장"}).click();
  await expect(page.locator(".status-chip[role=status]")).toHaveText("담당자 검토 필요");
  const cropped:Run=await request.get(`/api/runs/${first.id}`).then(r=>r.json());expect(cropped.version).toBe(before.version+1);expect(cropped.approval).toBeNull();expect(cropped.cards[0].body).toBe(before.cards[0].body);expect(cropped.cards.slice(1)).toEqual(before.cards.slice(1));expect(cropped.cards[0].image?.crop).toEqual({x:.2,y:.5,zoom:1.5});
  expect((await request.get(`/api/runs/${first.id}/files/timestory.zip`)).status()).toBe(409);
  await page.getByRole("button",{name:"수정 내용 재검수"}).click();await expect(page.locator(".status-chip[role=status]")).toHaveText("검수 통과 · 승인 대기");
  await page.getByRole("tab",{name:"사진 편집"}).click();await page.getByText("사진 바꾸기",{exact:true}).click();await page.getByLabel("사진 촬영자").fill("골뱅이 (CC BY-SA 3.0)");await page.getByLabel("이 사진의 사용·수정 권한을 확인했습니다.").check();
  await page.getByLabel("직접 사진 업로드").setInputFiles("public/places/yuldong-park.jpg");await expect(page.locator(".status-chip[role=status]")).toHaveText("담당자 검토 필요");
  const uploaded:Run=await request.get(`/api/runs/${first.id}`).then(r=>r.json());expect(uploaded.cards[0].image?.kind).toBe("upload");expect(uploaded.cards[0].body).toBe(before.cards[0].body);expect(uploaded.cards.slice(1)).toEqual(before.cards.slice(1));
  await page.getByRole("button",{name:"수정 내용 재검수"}).click();await expect(page.locator(".status-chip[role=status]")).toHaveText("검수 통과 · 승인 대기");
  await page.getByLabel("확인 담당자").fill("관광 담당자");await page.getByRole("button",{name:"최종 결과 승인"}).click();
  const file=page.waitForEvent("download");await page.getByRole("link",{name:"카드뉴스 패키지 다운로드"}).click();const downloaded=await file;const zip=unzipSync(await readFile((await downloaded.path())!));
  const sources=JSON.parse(strFromU8(zip["sources.json"]));expect(sources.images[0].kind).toBe("upload");expect(sources.images[0].placeId).toBe("yuldong-park");
  await writeFile("outputs/e2e-tourism-card-1.png",zip["card-1.png"]);await writeFile("outputs/e2e-tourism-card-4.png",zip["card-4.png"]);
  await page.getByRole("tab",{name:"사진 편집"}).click();await page.getByText("AI 이미지로 새롭게 표현하기",{exact:true}).click();await expect(page.getByRole("button",{name:"이 카드 이미지 생성"})).toBeDisabled();
  expect((await request.post(`/api/runs/${first.id}/image`,{data:{version:uploaded.version,cardId:"card-1",operation:"generate"}})).status()).toBe(503);
  await page.screenshot({path:"outputs/e2e-tourism-studio-1440.png",fullPage:true});
  await page.getByRole("navigation",{name:"주 메뉴"}).getByRole("button",{name:/관광지 탐색/}).click();await expect(page.getByRole("textbox",{name:"관광지 검색",exact:true})).toHaveValue("율동");
  await page.getByRole("textbox",{name:"관광지 검색",exact:true}).fill("존재하지않는장소");await expect(page.getByText("조건에 맞는 장소가 없어요.")).toBeVisible();await page.getByRole("button",{name:"검색 조건 초기화"}).click();await expect(page.locator(".place-result")).toHaveCount(PLACES.length);
  expect(errors).toEqual([]);
});

test("responsive place details, keyboard map, tile failure and retry remain usable",async({page})=>{
  await page.route("https://tile.openstreetmap.org/**",route=>route.abort());
  await page.goto("/");await page.getByRole("button",{name:"성남의 장소 탐색하기"}).click();
  await expect(page.getByText("지도 일부를 불러오지 못했습니다.")).toBeVisible();await expect(page.locator(".place-result")).toHaveCount(8);await page.getByRole("button",{name:"지도 다시 불러오기"}).click();
  for(const width of [1440,1024,390]) {
    await page.setViewportSize({width,height:900});await page.evaluate(()=>document.fonts.ready);
    if(width===390)await page.getByRole("button",{name:"목록",exact:true}).click();
    const selected=page.locator(".place-result").filter({hasText:"봉국사 대광명전"});await selected.click();
    await expect(page.getByRole(width<=1024?"dialog":"region",{name:"봉국사 대광명전 상세 정보"})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    await page.screenshot({path:`outputs/e2e-tourism-explore-${width}.png`,fullPage:true});
    await page.getByRole("button",{name:"장소 상세 닫기",exact:true}).last().press("Escape");await expect(selected).toBeFocused();
  }
  await page.getByRole("button",{name:"지도",exact:true}).click();const map=page.getByRole("region",{name:/성남 관광지 지도/});await expect(page.locator(".map-tiles img").first()).toHaveAttribute("src",/\/15\//);await map.focus();await map.press("+");await expect(page.locator(".map-tiles img").first()).toHaveAttribute("src",/\/16\//);await map.press("ArrowRight");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});

test("unavailable sources produce an explicit handoff without invented artifacts", async ({
  request,
}) => {
  const response = await request.post("/api/runs", {
    data: {
      mode: "fixture",
      scenario: "unavailable",
      requestId: crypto.randomUUID(),
    },
  });
  expect(response.ok()).toBe(true);
  const initial: Run = await response.json();
  await expect
    .poll(async () => {
      const r: Run = await request
        .get(`/api/runs/${initial.id}`)
        .then((r) => r.json());
      return r.status;
    })
    .toBe("needs_review");
  const r: Run = await request
    .get(`/api/runs/${initial.id}`)
    .then((r) => r.json());
  expect(r.evidence).toHaveLength(0);
  expect(r.artifacts).toHaveLength(0);
  expect(r.stopReason).toContain("거짓 판정이 아니며");
});

test("API rejects cross-origin mutations, invalid input, and unconfigured live execution", async ({
  request,
}) => {
  const cross = await request.post("/api/runs", {
    headers: { Origin: "https://untrusted.example" },
    data: { mode: "fixture", requestId: crypto.randomUUID() },
  });
  expect(cross.status()).toBe(403);
  const invalid = await request.post("/api/runs", {
    data: { mode: "fixture", requestId: "x" },
  });
  expect(invalid.status()).toBe(400);
  const live = await request.post("/api/runs", {
    data: { mode: "live", requestId: crypto.randomUUID() },
  });
  expect(live.status()).toBe(503);
});

test("mobile workspace has no horizontal overflow and usable form", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: /카드뉴스/ }).click();
  await expect(
    page.getByRole("button", { name: "카드뉴스 제작하기" }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.screenshot({
    path: "outputs/e2e-studio-mobile.png",
    fullPage: true,
  });
});

test("protected human text yields a reviewable proposal, explicit edit and current-version package", async ({ page, request }) => {
  const response = await request.post('/api/runs', { data: { mode:'fixture', scenario:'normal', requestId:crypto.randomUUID() } });
  const initial: Run = await response.json();
  await expect.poll(async()=> (await request.get(`/api/runs/${initial.id}`).then(r=>r.json())).status).toBe('ready_for_approval');
  await page.goto('/');
  await page.getByLabel('이전 작업 열기').selectOption(initial.id);
  await expect(page.locator(".status-chip[role=status]")).toHaveText('검수 통과 · 승인 대기');
  await page.getByRole('button',{name:/1장 .* 근거 보기/}).click();
  await page.getByRole('tab',{name:'직접 수정'}).click();
  await page.getByRole('textbox',{name:'카드 본문',exact:true}).fill('판교박물관은 2015년에 개관했어요.');
  await page.getByRole('button',{name:'수정 저장'}).click();
  await page.getByRole('button',{name:'수정 내용 재검수'}).click();
  await expect.poll(async()=>{
    const run:Run=await request.get(`/api/runs/${initial.id}`).then(r=>r.json());
    return run.proposedChanges?.length ?? 0;
  }).toBe(1);
  await expect(page.locator(".status-chip[role=status]")).toHaveText('담당자 검토 필요');
  const proposed:Run=await request.get(`/api/runs/${initial.id}`).then(r=>r.json());
  expect(proposed.version).toBe(2);
  expect(proposed.cards[0].body).toContain('2015');
  expect(proposed.proposedChanges?.[0].after.body).toContain('2013');
  expect(proposed.automaticRevisions).toBe(0);
  expect((await request.post(`/api/runs/${initial.id}/edit`,{data:{version:1,cardId:'card-1',title:'오래된 요청',body:'오래된 버전 요청'}})).status()).toBe(409);
  expect((await request.get(`/api/runs/${initial.id}/files/timestory.zip`)).status()).toBe(409);
  await page.getByRole('tab',{name:'수정 내역'}).click();
  const protection=page.getByRole('region',{name:'담당자 문구 보호와 수정 제안'});
  await expect(protection).toContainText('아직 적용되지 않음');
  await protection.getByRole('button',{name:'제안을 편집창에 불러오기'}).click();
  await expect(page.getByRole('textbox',{name:'카드 본문',exact:true})).toHaveValue(/2013/);
  await page.getByRole('button',{name:'수정 저장'}).click();
  await page.getByRole('button',{name:'수정 내용 재검수'}).click();
  await expect(page.locator(".status-chip[role=status]")).toHaveText('검수 통과 · 승인 대기');
  const final:Run=await request.get(`/api/runs/${initial.id}`).then(r=>r.json());
  expect(final.version).toBe(3);
  expect(final.cards[0].claimIds).toEqual(initial.cards[0]?.claimIds ?? ['claim-opening']);
  expect(final.artifacts.every(a=>a.version===3&&a.reviewVersion===3)).toBe(true);
  expect(final.reviews?.some(r=>r.version===2&&r.issues.length>0)).toBe(true);
  await page.setViewportSize({width:390,height:844});
  await page.locator('.trace-section > summary').filter({hasText:'검색과 근거 수집'}).click();
  await page.locator('.trace-section > summary').filter({hasText:'실행 방식과 사용량'}).click();
  await expect(page.locator('.run-trace')).toContainText('실제 모델 API 시도');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.screenshot({path:'outputs/e2e-studio-trace-mobile.png',fullPage:true});
});
