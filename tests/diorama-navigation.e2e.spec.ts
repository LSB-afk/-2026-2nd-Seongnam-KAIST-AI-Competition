import { expect, test, type Page } from '@playwright/test';

async function openMap(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?view=diorama&scene=seongnam');
  await expect(page.getByTestId('diorama-stage')).toHaveAttribute('data-status', 'ready');
  await expect(page.locator('[data-city-marker=bundang]')).toBeVisible();
}

async function anchor(page: Page, id = 'bundang') {
  const box = await page.locator(`[data-city-marker=${id}]`).boundingBox();
  if (!box) throw new Error(`Missing visible map marker: ${id}`);
  return { x: box.x + box.width / 2, y: box.y + box.height };
}

async function drag(page: Page, x: number, y: number, dx: number, dy: number, button: 'left' | 'right' = 'left') {
  await page.mouse.move(x, y);
  await page.mouse.down({ button });
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up({ button });
}

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

test('dragging labels grabs the map precisely, stops on release and preserves click selection', async ({ page }) => {
  await openMap(page);
  const canvas = await page.locator('.diorama-webgl canvas').elementHandle();
  const before = await anchor(page), other = await anchor(page, 'sujeong'), url = page.url();
  await drag(page, before.x, before.y - 16, 100, 80);
  await expect.poll(async () => (await anchor(page)).x - before.x).toBeCloseTo(100, 0);
  const after = await anchor(page), otherAfter = await anchor(page, 'sujeong');
  expect(after.y - before.y).toBeCloseTo(80, 0);
  expect(distance(after, otherAfter)).toBeCloseTo(distance(before, other), 0);
  expect(page.url()).toBe(url);
  await page.waitForTimeout(250);
  expect(distance(after, await anchor(page))).toBeLessThan(.1);
  await page.locator('[data-city-marker=bundang]').click();
  await expect(page).toHaveURL(/spot=bundang/);
  expect(await canvas!.evaluate(node => node === document.querySelector('.diorama-webgl canvas'))).toBe(true);
});

test('blank clicks recenter without changing orientation, scale or selected identity', async ({ page }) => {
  await openMap(page);
  const before = await anchor(page), other = await anchor(page, 'sujeong'), url = page.url();
  await page.mouse.click(480, 400);
  await expect(page.locator('.diorama-center-indicator')).toBeVisible();
  await expect.poll(async () => distance(before, await anchor(page))).toBeGreaterThan(100);
  const after = await anchor(page), otherAfter = await anchor(page, 'sujeong');
  expect(after.x - before.x).toBeCloseTo(otherAfter.x - other.x, 0);
  expect(after.y - before.y).toBeCloseTo(otherAfter.y - other.y, 0);
  expect(page.url()).toBe(url);
  await page.getByRole('button', { name: '시점 초기화', exact: true }).click();
  await expect.poll(async () => distance(before, await anchor(page))).toBeLessThan(.5);
});

test('wheel zoom holds the ground under the cursor while expanding surrounding map detail', async ({ page }) => {
  await openMap(page);
  const before = await anchor(page), other = await anchor(page, 'sujeong');
  await page.mouse.move(before.x, before.y);
  await page.mouse.wheel(0, -400);
  await expect.poll(async () => distance(await anchor(page), await anchor(page, 'sujeong'))).toBeGreaterThan(distance(before, other) * 1.1);
  expect(distance(before, await anchor(page))).toBeLessThan(3);
  await expect(page).not.toHaveURL(/spot=/);
});

test('mode switching, keyboard panning and top view keep one canvas and allow recovery', async ({ page }) => {
  await openMap(page);
  const canvas = page.locator('.diorama-webgl canvas');
  const originalCanvas = await canvas.elementHandle();
  const original = await anchor(page), originalOther = await anchor(page, 'sujeong');
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await anchor(page)).x - original.x).toBeCloseTo(-64, 0);
  const panned = await anchor(page), otherPanned = await anchor(page, 'sujeong');
  expect(distance(panned, otherPanned)).toBeCloseTo(distance(original, originalOther), 0);
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(async () => distance(panned, await anchor(page))).toBeGreaterThan(1);
  await page.keyboard.press('Home');
  await expect.poll(async () => distance(original, await anchor(page))).toBeLessThan(.5);
  await page.getByRole('button', { name: '지도 회전 모드', exact: true }).click();
  await expect(page.getByTestId('diorama-stage')).toHaveAttribute('data-navigation-mode', 'rotate');
  await drag(page, original.x, original.y - 16, 80, 30);
  await expect.poll(async () => distance(original, await anchor(page))).toBeGreaterThan(10);
  await expect(page).not.toHaveURL(/spot=/);
  await page.getByRole('button', { name: '위에서 보기', exact: true }).click();
  await expect(page.getByRole('button', { name: '지도 회전 모드', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '지도 이동 모드', exact: true }).click();
  await page.getByRole('button', { name: '시점 초기화', exact: true }).click();
  await expect.poll(async () => distance(original, await anchor(page))).toBeLessThan(.5);
  expect(await originalCanvas!.evaluate(node => node === document.querySelector('.diorama-webgl canvas'))).toBe(true);
});

test('a drag returning to its label never becomes a click, and keyboard label activation still works', async ({ page }) => {
  await openMap(page);
  const before = await anchor(page), url = page.url();
  await page.mouse.move(before.x, before.y - 16); await page.mouse.down();
  await page.mouse.move(before.x + 70, before.y + 40, { steps: 8 });
  await page.mouse.move(before.x, before.y - 16, { steps: 8 }); await page.mouse.up();
  expect(page.url()).toBe(url);
  await expect.poll(async () => distance(before, await anchor(page))).toBeLessThan(.5);
  await page.locator('[data-city-marker=bundang]').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/spot=bundang/);
});

test.describe('mobile map gestures', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('one finger pans over labels and pinch zoom never selects a place', async ({ page, context }) => {
    await openMap(page);
    const before = await anchor(page), other = await anchor(page, 'sujeong'), url = page.url();
    const session = await context.newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number; id: number }[]) => session.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    await touch('touchStart', [{ x: before.x, y: before.y - 16, id: 1 }]);
    for (let step = 1; step <= 8; step++) await touch('touchMove', [{ x: before.x + step * 4, y: before.y - 16 + step * 5, id: 1 }]);
    await touch('touchEnd', []);
    await expect.poll(async () => distance(before, await anchor(page))).toBeGreaterThan(20);
    const moved = await anchor(page), otherMoved = await anchor(page, 'sujeong');
    expect(distance(moved, otherMoved)).toBeCloseTo(distance(before, other), 0);
    expect(page.url()).toBe(url);
    await page.getByRole('button', { name: '시점 초기화', exact: true }).click();
    const pinchBefore = distance(await anchor(page), await anchor(page, 'sujeong'));
    await touch('touchStart', [{ x: 150, y: 430, id: 1 }, { x: 230, y: 430, id: 2 }]);
    for (let step = 1; step <= 8; step++) await touch('touchMove', [{ x: 150 - step * 3, y: 430, id: 1 }, { x: 230 + step * 3, y: 430, id: 2 }]);
    await touch('touchEnd', []);
    await expect.poll(async () => distance(await anchor(page), await anchor(page, 'sujeong'))).toBeGreaterThan(pinchBefore * 1.15);
    expect(page.url()).toBe(url);
    await expect(page.locator('.diorama-center-indicator')).toBeHidden();
    await page.getByRole('button', { name: '지도 회전 모드', exact: true }).click();
    await expect(page.getByText('한 손가락으로 회전 · 두 손가락으로 확대', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await session.detach();
  });
});
