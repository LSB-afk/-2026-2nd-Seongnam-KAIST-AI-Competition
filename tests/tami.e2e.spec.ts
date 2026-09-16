import { test, expect, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { newRun } from "../src/lib/run";
import { GUIDE_STORAGE_KEY } from "../src/lib/guide";
import type { Run } from "../src/lib/types";

/** Mock NAVER only. Creation, review, approval and ZIP use the real fixture backend. */
async function mockNaverMap(page: Page) {
  const sdk = await readFile("tests/fixtures/naver-maps-mock.js", "utf8");
  await page.route("**/api/map-config", (route) => route.fulfill({ json: { provider: "naver", configured: true, clientId: "test-public-key" } }));
  await page.route("**/openapi/v3/maps.js*", (route) => route.fulfill({ contentType: "application/javascript", body: sdk }));
}
async function step(page: Page, value: number) {
  await expect(page.locator(".tami-step-count strong")).toHaveText(String(value), { timeout: 60_000 });
}
async function targetAboveSheet(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  // Approval changes layout; wait for the RAF measurement to catch up before capturing it.
  await expect.poll(() => page.evaluate(async (targetName) => {
    let maximumOffset = 0;
    for (let frame = 0; frame < 6; frame++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const target = document.querySelector(`[data-tour="${targetName}"]`)?.getBoundingClientRect();
      const panel = document.querySelector(".tami-panel")?.getBoundingClientRect();
      const outline = document.querySelector(`[data-tami-target="${targetName}"]`)?.getBoundingClientRect();
      if (!target || !panel || !outline || target.top < 0 || target.bottom >= panel.top) return Infinity;
      maximumOffset = Math.max(maximumOffset,
        Math.abs(outline.top - (target.top - 3)), Math.abs(outline.left - (target.left - 3)),
        Math.abs(outline.bottom - (target.bottom + 3)), Math.abs(outline.right - (target.right + 3)),
      );
    }
    return maximumOffset;
  }, name), { message: `${name} must be above the sheet with its outline aligned` }).toBeLessThanOrEqual(4);
}

test("mobile Tami guides all eight steps without automatic creation or approval", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockNaverMap(page);
  const errors: string[] = [];
  const writes: { path: string; mode?: string }[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.method() === "POST") writes.push({ path: new URL(request.url()).pathname, mode: (request.postDataJSON() as { mode?: string })?.mode });
  });
  await mkdir("outputs", { recursive: true });
  const spriteResponse = page.waitForResponse((response) => new URL(response.url()).searchParams.get("url") === "/tami/tami-sprites.png");
  await page.goto("/");
  await expect(page.locator(".tami-invitation")).toBeVisible();
  const sprite = await spriteResponse;
  expect(sprite.ok()).toBe(true);
  const spriteBytes = (await sprite.body()).byteLength;
  expect(spriteBytes).toBeLessThan(250_000);
  expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "안내 로봇 타미", exact: true }).click();
  await expect(page.locator(".tami-panel")).toBeVisible();
  for (const name of ["장소 찾기", "카드뉴스 만들기 안내", "하던 작업 이어가기"])
    await expect(page.getByRole("button", { name, exact: true })).toBeAttached();
  await page.getByRole("button", { name: "사용법 시작", exact: true }).click();
  await step(page, 1);
  await expect(page.getByRole("button", { name: "다음", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "관광 탐색 열기", exact: true }).click();
  await expect(page.locator(".tami-target-outline.is-located")).toBeVisible();
  await step(page, 1);
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await step(page, 2);
  await expect(page.getByRole("button", { name: "다음", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "장소 목록 보기", exact: true }).click();
  await page.locator('[data-tour="place-results"]').getByRole("button").first().click();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await step(page, 3);
  await expect(page.locator('.place-detail[role="dialog"][aria-modal="true"] .tami-guide')).toHaveCount(1);

  // Closing only help preserves the underlying modal and returns keyboard focus.
  await page.getByRole("button", { name: "타미 안내 닫기" }).focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".tami-panel")).toHaveCount(0);
  await expect(page.locator('.place-detail[role="dialog"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "타미 사용법 열기" })).toBeFocused();
  await page.getByRole("button", { name: "타미 사용법 열기" }).click();
  await page.getByRole("button", { name: "3단계부터 이어하기", exact: true }).click();
  await step(page, 3);
  await page.getByRole("button", { name: "이전", exact: true }).click();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await step(page, 2); // The selection already exists; it must not bounce forward.
  await page.getByRole("button", { name: "장소 목록 보기", exact: true }).click();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await step(page, 3);
  await expect(page.getByRole("button", { name: "다음", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "공식 정보 위치 보기", exact: true }).click();
  await expect(page.locator('[data-tour="official-source"]')).toBeFocused();
  await targetAboveSheet(page, "official-source");
  const sourceBox = await page.locator('[data-tour="official-source"]').boundingBox();
  await page.screenshot({ path: "outputs/tami-mobile-source.png" });
  const popup = page.waitForEvent("popup");
  await page.locator('[data-tour="official-source"]').click();
  await (await popup).close();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await step(page, 4);
  await page.getByRole("button", { name: "선택한 장소로 제작 화면 열기", exact: true }).click();
  await page.locator('[data-tour="create-from-place"]').click();
  await step(page, 5);
  const goal = page.getByRole("textbox", { name: "어떤 이야기를 만들까요?", exact: true });
  const audience = page.getByRole("combobox", { name: /누구에게 전할까요/ });
  const customGoal = "가족 관람객에게 판교박물관의 공식 정보를 바탕으로 카드뉴스를 만들어 주세요. 마지막 장은 상상으로 구분해 주세요.";
  await goal.fill(customGoal);
  await audience.selectOption("가족 관람객");
  const beforeGuideUrl = page.url();
  await page.getByRole("button", { name: "제작 입력 보기", exact: true }).click();
  await expect(goal).toHaveValue(customGoal);
  await expect(audience).toHaveValue("가족 관람객");
  expect(page.url()).toBe(beforeGuideUrl);
  expect(writes).toHaveLength(0);
  await expect(page.getByRole("button", { name: "데모", exact: true })).toHaveAttribute("aria-pressed", "true");
  const created = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/runs" && response.request().method() === "POST");
  await page.locator('[data-tour="create-run"]').click();
  const initial: Run = await (await created).json();
  expect(initial.mode).toBe("fixture");
  expect(initial.brief.goal).toBe(customGoal);
  expect(initial.brief.audience).toBe("가족 관람객");
  await step(page, 6);
  expect(writes).toEqual([{ path: "/api/runs", mode: "fixture" }]);
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await step(page, 7);
  await page.getByRole("button", { name: "검수 결과 보기", exact: true }).click();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await step(page, 8);
  await page.getByRole("button", { name: "승인 위치 보기", exact: true }).click();
  await page.getByLabel("확인 담당자", { exact: true }).fill("타미 안내 검증");
  expect(writes).toHaveLength(1);
  await page.getByRole("button", { name: "최종 결과 승인", exact: true }).click();
  await expect(page.getByText("✓ 담당자 승인 완료", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "다운로드 위치 보기", exact: true }).click();
  await targetAboveSheet(page, "download");
  const downloadBox = await page.locator('[data-tour="download"]').boundingBox();
  const guideBox = await page.locator(".tami-panel").boundingBox();
  await page.screenshot({ path: "outputs/tami-mobile-approved.png" });
  const downloadEvent = page.waitForEvent("download");
  await page.locator('[data-tour="download"]').click();
  const download = await downloadEvent;
  expect(await download.failure()).toBeNull();
  await download.saveAs("outputs/tami-package.zip");
  const files = unzipSync(await readFile("outputs/tami-package.zip"));
  expect(Object.keys(files).filter((name) => /^card-[1-4]\.png$/.test(name))).toHaveLength(4);
  await expect(page.getByRole("heading", { name: "사용법을 모두 살펴봤어요" })).toBeVisible();
  await page.screenshot({ path: "outputs/tami-mobile-complete.png" });
  const final: Run = await page.request.get(`/api/runs/${initial.id}`).then((response) => response.json());
  expect(final.execution?.apiCalls).toBe(0);
  expect(final.usage.modelCalls).toBe(0);
  expect(final.approval?.version).toBe(final.version);
  expect(writes.map((entry) => entry.path)).toEqual(["/api/runs", `/api/runs/${initial.id}/approve`]);
  expect(errors).toEqual([]);
  await writeFile("outputs/tami-journey.json", JSON.stringify({
    viewport: { width: 390, height: 844 }, stepsCompleted: 8, runId: initial.id,
    sdk: "mock; no live NAVER validation", creationMode: "fixture", postsBeforeCreation: 0,
    postsBeforeApproval: 1, writes, modelCalls: final.usage.modelCalls, apiCalls: final.execution?.apiCalls,
    sourceBox, downloadBox, guideBox, modalPortal: true, escapeFocusRestored: true,
    downloadedPngCount: 4, downloadFailure: null, consoleErrors: errors,
    characterClickable: true, quickActionsPresent: true, draftPreservedByGuide: true,
    sprite: { path: new URL(sprite.url()).pathname + new URL(sprite.url()).search, contentType: sprite.headers()["content-type"], bytes: spriteBytes },
  }, null, 2));
});

for (const width of [1440, 390]) {
  test(`first invitation never blocks place creation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockNaverMap(page);
    await page.goto("/");
    await expect(page.locator(".tami-invitation")).toBeVisible();
    await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tami-reserved-space")))).toBeGreaterThan(200);
    await mkdir("outputs", { recursive: true });
    await page.screenshot({ path: `outputs/tami-invitation-${width}.png` });
    await page.locator('[data-tour="nav-explore"]').click();
    await expect(page.locator(".tami-invitation")).toHaveCount(0);
    await page.locator('[data-tour="place-results"]').getByRole("button").first().click();
    await page.locator('[data-tour="create-from-place"]').click();
    await expect(page.locator('[data-tour="create-run"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "타미 사용법 열기" })).toBeVisible();
  });
}

test("Tami restores a paused run, respects motion and keeps help available after image failure", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockNaverMap(page);
  const run = newRun({ mode: "fixture" });
  run.version = 2; run.reviewVersion = 2; run.status = "ready_for_approval";
  run.cards = [1, 2, 3, 4].map((index) => ({ id: `card-${index}`, title: `카드 ${index}`, body: "공식 정보를 바탕으로 장소를 소개합니다.", script: "", claimIds: [], imagination: index === 4 }));
  await page.route("**/api/runs", (route) => route.fulfill({ json: [run] }));
  await page.route(`**/api/runs/${run.id}`, (route) => route.fulfill({ json: run }));
  await page.route((url) => url.pathname === "/_next/image" && url.searchParams.get("url") === "/tami/tami-sprites.png", (route) => route.abort());
  await page.addInitScript(({ key, runId }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({
      version: 1, tutorial: { version: 1, status: "active", step: 5, placeId: "pangyo-museum", runId, sourcePlaceId: "pangyo-museum" },
      preferences: { minimized: false, animationOff: false, invitationDismissed: true },
    }));
  }, { key: GUIDE_STORAGE_KEY, runId: run.id });
  await page.goto(`/?view=studio&place=pangyo-museum&run=${run.id}`);
  await expect(page.locator(".tami-character--fallback")).toBeVisible();
  await expect(page.locator(".tami-character")).toHaveCSS("animation-name", "none");
  await expect(page.locator(".tami-panel")).toHaveCount(0);
  await page.getByRole("button", { name: "타미 사용법 열기" }).click();
  await page.getByRole("button", { name: "6단계부터 이어하기", exact: true }).click();
  await step(page, 6);
  await page.getByRole("button", { name: "이전", exact: true }).click();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await step(page, 5);
  await page.getByTestId("tami-panel").getByText("타미 설정", { exact: true }).click();
  await page.getByLabel("움직임 끄기", { exact: true }).check();
  await page.getByLabel("캐릭터 최소화", { exact: true }).check();
  await page.getByRole("button", { name: "타미 안내 닫기" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "타미 사용법 열기" })).toBeVisible();
  await expect(page.locator(".tami-character")).toHaveCount(0);
  await page.getByRole("button", { name: "타미 사용법 열기" }).click();
  await expect(page.getByRole("button", { name: "5단계부터 이어하기", exact: true })).toBeVisible();
  await page.getByTestId("tami-panel").getByText("타미 설정", { exact: true }).click();
  await expect(page.getByLabel("움직임 끄기", { exact: true })).toBeChecked();
  await expect(page.getByLabel("캐릭터 최소화", { exact: true })).toBeChecked();
  await page.getByRole("button", { name: "처음부터 다시 시작", exact: true }).click();
  await step(page, 1);
  await page.getByRole("button", { name: "건너뛰기", exact: true }).click();
  await expect(page.locator(".tami-panel")).toHaveCount(0);
  const storage = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), GUIDE_STORAGE_KEY);
  expect(storage.tutorial.status).toBe("skipped");
  expect(storage.preferences).toEqual({ minimized: true, animationOff: true, invitationDismissed: true });
  await mkdir("outputs", { recursive: true });
  await page.screenshot({ path: "outputs/tami-preferences-1024.png" });
  await writeFile("outputs/tami-accessibility.json", JSON.stringify({
    viewport: { width: 1024, height: 900 }, restoredStep: 6, previousStepStable: 5,
    reducedMotionAnimation: "none", failedImageHelpVisible: true, restoredPreferences: storage.preferences,
    restartStep: 1, skipStatus: storage.tutorial.status,
  }, null, 2));
});
