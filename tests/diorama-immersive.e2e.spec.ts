import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('https://www.openstreetmap.org/export/embed.html**', route => route.fulfill({ contentType: 'text/html', body: '<html>OpenStreetMap test document</html>' }));
});

for (const [width, height] of [[1440, 1000], [1024, 900], [390, 844]]) {
  test(`the map fills ${width} by ${height} behind its floating controls`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/?view=diorama&scene=seongnam');
    const stage = page.getByTestId('diorama-stage');
    await expect(stage).toHaveAttribute('data-status', 'ready');
    const canvas = stage.locator('canvas');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeCloseTo(0, 0);
    expect(bounds!.y).toBeCloseTo(0, 0);
    expect(bounds!.width).toBeCloseTo(width, 0);
    expect(bounds!.height).toBeCloseTo(height, 0);
    expect(await page.evaluate(() => ({ x: document.documentElement.scrollWidth > innerWidth, y: document.documentElement.scrollHeight > innerHeight + 1 }))).toEqual({ x: false, y: false });
    await expect(page.locator('.workspace-footer')).not.toBeVisible();
    for (const name of ['주 메뉴 열기', '성남 전체 보기', '확대', '자동 감상 시작', '감상 설정']) {
      const button = page.getByRole('button', { name, exact: true });
      await expect(button).toBeVisible();
      expect(await button.evaluate(button => {
        const b = button.getBoundingClientRect();
        const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        return hit === button || button.contains(hit);
      })).toBe(true);
    }
    const original = await canvas.elementHandle();
    const toggle = page.getByRole('button', { name: /명소 패널 (열기|접기)/ });
    const initial = await toggle.getAttribute('aria-expanded');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', initial === 'true' ? 'false' : 'true');
    expect(await original!.evaluate(node => node === document.querySelector('[data-testid="diorama-stage"] canvas'))).toBe(true);
  });
}

test('the floating app menu restores focus and normal workspace navigation', async ({ page }) => {
  await page.goto('/?view=diorama&scene=central-park');
  await expect(page.getByTestId('diorama-stage')).toHaveAttribute('data-status', 'ready');
  await expect(page.getByRole('navigation', { name: '주 메뉴', exact: true })).not.toBeVisible();
  const open = page.getByRole('button', { name: '주 메뉴 열기', exact: true });
  await open.click();
  const nav = page.getByRole('navigation', { name: '주 메뉴', exact: true });
  await expect(nav).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(nav).not.toBeVisible();
  await expect(open).toBeFocused();
  await open.click();
  await nav.getByRole('button', { name: 'AI 에이전트', exact: true }).click();
  await expect(page).toHaveURL(/view=agent/);
  await expect(page.getByTestId('diorama-stage')).toHaveCount(0);
  await expect(page.locator('.topbar')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('diorama-stage')).toHaveAttribute('data-status', 'ready');
  await expect(open).toBeVisible();
  await expect(page.getByRole('button', { name: '자동 감상 시작', exact: true })).toBeVisible();
});

test('mobile floating sheets keep every place and setting reachable without page scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?view=diorama&scene=seongnam');
  await expect(page.getByTestId('diorama-stage')).toHaveAttribute('data-status', 'ready');
  const panel = page.getByRole('button', { name: /명소 패널 (열기|접기)/ });
  await expect(panel).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: '망경암 장면 보기', exact: true })).not.toBeVisible();
  await panel.click();
  await page.getByRole('button', { name: '망경암 장면 보기', exact: true }).click();
  await expect(page).toHaveURL(/scene=manggyeongam/);
  const create = page.getByRole('button', { name: '이 장소로 카드뉴스 만들기', exact: true });
  await create.scrollIntoViewIfNeeded();
  await expect(create).toBeVisible();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toBeFocused();
  const settings = page.getByRole('button', { name: '감상 설정', exact: true });
  await settings.click();
  await page.getByRole('checkbox', { name: '움직임 사용', exact: true }).uncheck();
  await page.keyboard.press('Escape');
  await expect(settings).toHaveAttribute('aria-expanded', 'false');
  await expect(settings).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await panel.click();
  await create.click();
  await expect(page.getByRole('textbox', { name: '소개할 장소', exact: true })).toHaveValue('망경암');
});

test('resizing with both panels open keeps focus on a visible control', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/?view=diorama&scene=seongnam');
  await expect(page.getByTestId('diorama-stage')).toHaveAttribute('data-status', 'ready');
  const settings = page.getByRole('button', { name: '감상 설정', exact: true });
  for (const name of ['판교박물관 장면 보기', '명소 패널 접기']) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await settings.click();
    const target = page.getByRole('button', { name, exact: true });
    await target.focus();
    await expect(target).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(settings).toHaveAttribute('aria-expanded', 'true');
    await expect(settings).toBeFocused();
    await expect(settings).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(settings).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: '명소 패널 열기', exact: true })).toBeVisible();
  }
});

test('the default guide leaves a full-height tablet place panel toggle reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/?view=diorama&scene=seongnam');
  await expect(page.getByTestId('diorama-stage')).toHaveAttribute('data-status', 'ready');
  await page.getByRole('button', { name: '판교박물관 장면 보기', exact: true }).click();
  const panel = page.getByRole('button', { name: /명소 패널 (열기|접기)/ });
  await panel.click({ timeout: 5000 });
  await expect(panel).toHaveAttribute('aria-expanded', 'false');
  await panel.click();
  await expect(panel).toHaveAttribute('aria-expanded', 'true');
});
