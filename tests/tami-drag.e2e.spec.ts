import { test, expect, type Page, type Locator } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { TAMI_POSITION_KEY } from "../src/lib/tami-position";
import { GUIDE_STORAGE_KEY } from "../src/lib/guide";
import { mockOsmEmbed } from "./helpers/mock-osm";

async function prepare(page: Page, invitationDismissed = true) {
  await page.addInitScript(({ key, dismissed }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, tutorial: { version: 1, status: "idle", step: 0 }, preferences: { minimized: false, animationOff: false, invitationDismissed: dismissed } }));
  }, { key: GUIDE_STORAGE_KEY, dismissed: invitationDismissed });
  await page.route("**/api/map-config", (route) => route.fulfill({ json: { configured: false, provider: "naver" } }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "안내 로봇 타미", exact: true })).toBeVisible();
}
async function box(locator: Locator) {
  const value = await locator.boundingBox();
  expect(value).not.toBeNull();
  return value!;
}
async function mouseDrag(page: Page, locator: Locator, dx: number, dy: number) {
  const start = await box(locator);
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + dx, start.y + start.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
}
async function insideViewport(page: Page) {
  await expect.poll(() => page.locator(".tami-dock").evaluate((element) => {
    const r = element.getBoundingClientRect(), v = window.visualViewport;
    return r.left >= (v?.offsetLeft ?? 0) + 7 && r.top >= (v?.offsetTop ?? 0) + 7 && r.right <= (v?.offsetLeft ?? 0) + (v?.width ?? innerWidth) - 7 && r.bottom <= (v?.offsetTop ?? 0) + (v?.height ?? innerHeight) - 7;
  })).toBe(true);
}

test("Tami mouse drag keeps a free saved position and ordinary clicks still open nearby help", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const writes: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST") writes.push(request.url()); });
  await prepare(page);
  const character = page.getByRole("button", { name: "안내 로봇 타미", exact: true });
  const before = await box(page.locator(".tami-dock"));
  await mouseDrag(page, character, -500, -360);
  await expect(page.locator(".tami-panel")).toHaveCount(0);
  const moved = await box(page.locator(".tami-dock"));
  expect(moved.x).toBeCloseTo(before.x - 500, 0); expect(moved.y).toBeCloseTo(before.y - 360, 0);
  await insideViewport(page);
  await mkdir("outputs", { recursive: true });
  await page.screenshot({ path: "outputs/tami-drag-desktop.png" });
  await page.reload();
  await expect(character).toBeVisible();
  await expect.poll(async () => Math.abs((await box(page.locator(".tami-dock"))).x - moved.x)).toBeLessThan(2);
  expect((await box(page.locator(".tami-dock"))).y).toBeCloseTo(moved.y, 0);
  // A small pointer jitter is a click, not a second drag.
  await mouseDrag(page, character, 2, 2);
  await expect(page.locator(".tami-panel")).toBeVisible();
  await expect(page.locator(".tami-character")).toHaveCSS("animation-play-state", "paused");
  await expect.poll(async () => {
    const dock = await box(page.locator(".tami-dock")), panel = await box(page.locator(".tami-panel"));
    return panel.x >= 0 && panel.y >= 0 && panel.x + panel.width <= 1440 && panel.y + panel.height <= 1000 && (panel.x + panel.width <= dock.x || panel.y + panel.height <= dock.y || panel.x >= dock.x + dock.width || panel.y >= dock.y + dock.height);
  }).toBe(true);
  await page.screenshot({ path: "outputs/tami-drag-desktop-help.png" });
  await page.getByRole("button", { name: "타미 안내 닫기" }).click();
  await page.getByRole("button", { name: "타미 사용법 열기", exact: true }).click();
  await expect(page.locator(".tami-panel")).toBeVisible();
  expect(writes).toEqual([]);
});

test("Tami touch drag supports cancellation, minimized help and smaller viewports without scrolling", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  const session = await context.newCDPSession(page);
  async function touchDrag(locator: Locator, dx: number, dy: number, cancel = false) {
    const start = await box(locator), x = start.x + start.width / 2, y = start.y + start.height / 2;
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx, y: y + dy }] });
    await session.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
  }
  const character = page.getByRole("button", { name: "안내 로봇 타미", exact: true });
  const initialScroll = await page.evaluate(() => scrollY);
  const before = await box(page.locator(".tami-dock"));
  await touchDrag(character, -130, -300);
  await expect(page.locator(".tami-panel")).toHaveCount(0);
  const moved = await box(page.locator(".tami-dock"));
  expect(moved.y).toBeCloseTo(before.y - 300, 0);
  expect(await page.evaluate(() => scrollY)).toBe(initialScroll);
  await mkdir("outputs", { recursive: true });
  await page.screenshot({ path: "outputs/tami-drag-mobile.png" });
  const saved = await page.evaluate((key) => localStorage.getItem(key), TAMI_POSITION_KEY);
  await touchDrag(character, 60, -80, true);
  await expect.poll(async () => Math.abs((await box(page.locator(".tami-dock"))).y - moved.y)).toBeLessThan(2);
  expect(await page.evaluate((key) => localStorage.getItem(key), TAMI_POSITION_KEY)).toBe(saved);
  const help = page.getByRole("button", { name: "타미 사용법 열기", exact: true });
  await help.click();
  await page.getByText("타미 설정", { exact: true }).click();
  await page.getByLabel("캐릭터 최소화", { exact: true }).check();
  await page.getByRole("button", { name: "타미 안내 닫기" }).click();
  await expect(character).toHaveCount(0);
  await touchDrag(help, 80, 120);
  await expect(page.locator(".tami-panel")).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 500 });
  await insideViewport(page);
  await page.reload();
  await expect(help).toBeVisible();
  await insideViewport(page);
  await session.detach();
});

test("Tami keyboard movement and reset preserve access and idle motion respects interaction and preferences", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await prepare(page);
  const character = page.getByRole("button", { name: "안내 로봇 타미", exact: true });
  const sprite = page.locator(".tami-character");
  await page.mouse.move(2, 2);
  await expect(sprite).toHaveCSS("animation-iteration-count", "infinite");
  await expect(sprite).toHaveCSS("animation-play-state", "running");
  const transform = await sprite.evaluate((el) => getComputedStyle(el).transform);
  await expect.poll(() => sprite.evaluate((el) => getComputedStyle(el).transform)).not.toBe(transform);
  await character.hover();
  await expect(sprite).toHaveCSS("animation-play-state", "paused");
  await page.mouse.move(2, 2);
  await character.focus();
  const before = await box(page.locator(".tami-dock"));
  await expect(sprite).toHaveCSS("animation-play-state", "paused");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Shift+ArrowUp");
  const moved = await box(page.locator(".tami-dock"));
  expect(moved.x).toBeCloseTo(before.x - 12, 0); expect(moved.y).toBeCloseTo(before.y - 40, 0);
  await expect(page.locator(".tami-panel")).toHaveCount(0);
  await page.keyboard.press("Home");
  expect(await page.evaluate((key) => localStorage.getItem(key), TAMI_POSITION_KEY)).toBeNull();
  await page.keyboard.press("Enter");
  await page.getByText("타미 설정", { exact: true }).click();
  await page.getByRole("button", { name: "타미 위로 이동", exact: true }).click();
  expect(await page.evaluate((key) => localStorage.getItem(key), TAMI_POSITION_KEY)).not.toBeNull();
  await page.getByRole("button", { name: "위치 초기화", exact: true }).click();
  expect(await page.evaluate((key) => localStorage.getItem(key), TAMI_POSITION_KEY)).toBeNull();
  await page.getByLabel("움직임 끄기", { exact: true }).check();
  await expect(sprite).toHaveCSS("animation-name", "none");
  await page.getByLabel("움직임 끄기", { exact: true }).uncheck();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(sprite).toHaveCSS("animation-name", "none");
});

test("Tami ignores malformed or blocked position storage and keeps the invitation beside its moved dock", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((key) => {
    localStorage.setItem(key, '{"version":1,"x":-999,"y":"broken"}');
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) { if (name === key) throw new DOMException("Blocked", "QuotaExceededError"); return write.call(this, name, value); };
  }, TAMI_POSITION_KEY);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await prepare(page, false);
  await insideViewport(page);
  const character = page.getByRole("button", { name: "안내 로봇 타미", exact: true });
  const before = await box(page.locator(".tami-dock"));
  await mouseDrag(page, character, -100, -350);
  await expect(page.locator(".tami-panel")).toHaveCount(0);
  expect((await box(page.locator(".tami-dock"))).y).toBeCloseTo(before.y - 350, 0);
  const invitation = await box(page.locator(".tami-invitation")), dock = await box(page.locator(".tami-dock"));
  expect(invitation.x).toBeGreaterThanOrEqual(0);
  expect(invitation.x + invitation.width).toBeLessThanOrEqual(390);
  expect(Math.abs(invitation.y + invitation.height - dock.y)).toBeLessThan(20);
  await mkdir("outputs", { recursive: true });
  await page.screenshot({ path: "outputs/tami-drag-mobile-invitation.png" });
  await character.click();
  await expect(page.locator(".tami-panel")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Tami default position leaves OSM attribution clear at 1024px while a dragged position stays saved", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await mockOsmEmbed(page);
  await prepare(page);
  await page.locator('[data-tour="nav-explore"]').click();
  const map = page.locator(".osm-map-viewport iframe");
  await expect(map).toBeVisible();
  // Bring the real lower 64px of the iframe into the default dock's vertical band.
  await map.evaluate((element) => window.scrollBy(0, element.getBoundingClientRect().bottom - innerHeight + 8));
  await expect.poll(async () => {
    const iframe = await box(map), dock = await box(page.locator(".tami-dock"));
    return dock.y + dock.height <= iframe.y + iframe.height - 64 - 7;
  }).toBe(true);
  const before = await box(page.locator(".tami-dock"));
  const iframe = await box(map);
  await mouseDrag(page, page.getByRole("button", { name: "안내 로봇 타미", exact: true }), 0, iframe.y + iframe.height - before.height - 12 - before.y);
  const moved = await box(page.locator(".tami-dock"));
  expect(moved.y + moved.height).toBeGreaterThan(iframe.y + iframe.height - 64);
  const saved = await page.evaluate((key) => localStorage.getItem(key), TAMI_POSITION_KEY);
  expect(saved).not.toBeNull();
  await page.reload();
  await expect(map).toBeVisible();
  await expect.poll(async () => Math.abs((await box(page.locator(".tami-dock"))).y - moved.y)).toBeLessThan(2);
  expect(await page.evaluate((key) => localStorage.getItem(key), TAMI_POSITION_KEY)).toBe(saved);
});
