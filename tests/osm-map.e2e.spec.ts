import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PLACES } from "../src/lib/places";
import { mockOsmEmbed } from "./helpers/mock-osm";

async function setup(page: Page) {
  await mockOsmEmbed(page);
  await page.route("**/api/map-config", route => route.fulfill({ json: { provider: "naver", configured: false, reason: "missing-client-id" } }));
  await page.addInitScript(() => localStorage.setItem("timestory:tami-guide:v1", JSON.stringify({ version: 1, preferences: { minimized: true, animationOff: true, invitationDismissed: true } })));
}
const embed = (page: Page) => page.locator(".osm-map-viewport iframe");

test("missing NAVER credentials show a real-provider embed contract with filtered location selection", async ({ page }) => {
  await setup(page); const sdk: string[] = [], writes: string[] = [];
  page.on("request", request => { if (request.url().includes("maps.js")) sdk.push(request.url()); if (request.method() === "POST") writes.push(request.url()); });
  await page.goto("/?view=explore");
  await expect(embed(page)).toBeVisible();
  await expect(page.locator(".place-result")).toHaveCount(8);
  await expect(page.frameLocator(".osm-map-viewport iframe").getByText("OpenStreetMap 임베드 모의 응답")).toBeVisible();
  await page.getByRole("combobox", { name: "지도에 표시할 장소" }).selectOption(PLACES[0].id);
  await expect(page.locator(".place-detail h2")).toHaveText(PLACES[0].name);
  await expect.poll(async () => new URL((await embed(page).getAttribute("src"))!).searchParams.get("marker")).toBe(`${PLACES[0].lat},${PLACES[0].lng}`);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "지도에 표시할 장소" })).toHaveValue(PLACES[0].id);
  await page.getByRole("textbox", { name: "관광지 검색", exact: true }).fill("율동");
  await expect(page.locator(".place-result")).toHaveCount(1);
  await expect(page.getByRole("combobox", { name: "지도에 표시할 장소" }).locator("option")).toHaveCount(2);
  await expect.poll(async () => new URL((await embed(page).getAttribute("src"))!).searchParams.has("marker")).toBe(false);
  expect(sdk).toEqual([]); expect(writes).toEqual([]);
});

test("nationwide and city controls preserve their requested view through reload", async ({ page }) => {
  await setup(page); await page.goto("/?view=explore");
  await page.locator(".osm-map-location").getByRole("button", { name: "전국 보기" }).click();
  await expect(page).toHaveURL(/zoom=7/);
  const nation = await embed(page).getAttribute("src");
  await page.reload(); await expect(embed(page)).toHaveAttribute("src", nation!);
  await page.locator(".osm-map-location").getByRole("button", { name: "성남 둘러보기" }).click();
  await expect(page).toHaveURL(/zoom=12/);
  expect(await embed(page).getAttribute("src")).not.toBe(nation);
  const current = await embed(page).getAttribute("src");
  await page.getByRole("button", { name: "지도 다시 불러오기", exact: true }).click();
  await expect(embed(page)).toHaveAttribute("src", current!);
});

test("failed public-map documents can be retried while the list remains usable", async ({ page }) => {
  await setup(page); let fail = true, requests = 0;
  await page.route("https://www.openstreetmap.org/export/embed.html?*", route => {
    requests++; return fail ? route.abort() : route.fulfill({ contentType: "text/html; charset=utf-8", body: "<p>다시 열린 지도 문서</p>" });
  });
  await page.goto("/?view=explore"); await expect.poll(() => requests).toBe(1);
  await expect(page.locator(".place-result")).toHaveCount(8);
  await expect(page.getByRole("link", { name: "큰 지도 열기" })).toHaveAttribute("href", /^https:\/\/www.openstreetmap.org\//);
  // iframe load events do not prove that its tiles rendered; the UI must not claim success.
  await expect(page.locator(".osm-tourism-map")).not.toContainText("지도가 준비됐어요");
  fail = false; await page.getByRole("button", { name: "지도 다시 불러오기", exact: true }).click();
  await expect(page.frameLocator(".osm-map-viewport iframe").getByText("다시 열린 지도 문서")).toBeVisible();
  expect(requests).toBe(2);
});

test("mobile basic map controls, attribution space and filtered empty state fit the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await setup(page);
  await page.goto("/?view=explore&display=map"); await expect(embed(page)).toBeVisible();
  const box = await embed(page).boundingBox(); expect(box!.width).toBeGreaterThan(300); expect(box!.height).toBeGreaterThanOrEqual(260);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole("textbox", { name: "관광지 검색", exact: true }).fill("결과없는장소");
  await expect(page.getByRole("combobox", { name: "지도에 표시할 장소" })).toContainText("검색 결과가 없어요");
  await expect.poll(async () => new URL((await embed(page).getAttribute("src"))!).searchParams.has("marker")).toBe(false);
  await page.getByRole("button", { name: "목록", exact: true }).click();
  await expect(embed(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "조건에 맞는 장소가 없어요." })).toBeVisible();
});


test("fatal NAVER rendering errors dispose the session and ignore late tile callbacks", async ({ page }) => {
  await setup(page);
  const sdk = await readFile("tests/fixtures/naver-maps-mock.js", "utf8");
  await page.route("**/api/map-config", route => route.fulfill({ json: { provider: "naver", configured: true, clientId: "test-public-key" } }));
  await page.route("**/openapi/v3/maps.js*", route => route.fulfill({ contentType: "application/javascript", body: sdk }));
  await page.goto("/?view=explore");
  await expect(page.locator("[data-map-state=ready]")).toBeAttached();
  await page.evaluate(`(() => {
    const map = window.__naverMock.maps.at(-1);
    window.__lateTileCallback = [...map.events].find(event => event.name === 'tilesloaded').listener;
    map.setSize = () => { throw new Error('Test SDK rendering failure'); };
    map.container.style.height = '500px';
  })()`);
  await expect(page.locator("[data-map-fallback-reason=map-error]")).toBeVisible();
  await expect.poll(() => page.evaluate("window.__naverMock.destroyed")).toBe(1);
  expect(await page.evaluate("window.__naverMock.activeEvents")).toBe(0);
  await page.evaluate("window.__lateTileCallback()");
  await expect(embed(page)).toBeVisible();
  await expect(page.locator(".naver-map-stage")).toHaveCount(0);
  await expect(page.locator(".place-result")).toHaveCount(8);
});
