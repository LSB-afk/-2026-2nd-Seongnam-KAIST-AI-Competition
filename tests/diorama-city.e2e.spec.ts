import { expect, test } from '@playwright/test';
import { selectDioramaPlace, hideDioramaSettings, showDioramaPlaces, showDioramaSettings } from './helpers/diorama-controls';

test.beforeEach(async ({ page }) => {
  await page.route('https://www.openstreetmap.org/export/embed.html**', route => route.fulfill({ contentType: 'text/html', body: '<html><body>OpenStreetMap test document</body></html>' }));
});

test('the complete city opens first and all three districts share one canvas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?view=diorama');
  const stage = page.getByTestId('diorama-stage');
  await expect(stage).toHaveAttribute('data-status', 'ready');
  await expect(page.getByRole('button', { name: '성남 전체 보기', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '이 장소로 카드뉴스 만들기', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /OpenStreetMap contributors/ }).first()).toBeVisible();
  const original = await stage.locator('canvas').elementHandle();
  await showDioramaSettings(page);
  await page.getByRole('checkbox', { name: '움직임 사용', exact: true }).uncheck();
  await hideDioramaSettings(page);
  const whole = await stage.locator('canvas').screenshot();
  for (const [name, id] of [['수정구', 'sujeong'], ['중원구', 'jungwon'], ['분당구', 'bundang']]) {
    await page.getByRole('button', { name: `${name} 지역 보기`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`scene=seongnam.*spot=${id}`));
    await expect(page.getByRole('button', { name: `${name} 지역 보기`, exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await original!.evaluate(element => element === document.querySelector('[data-testid="diorama-stage"] canvas'))).toBe(true);
    await expect.poll(async () => Buffer.compare(whole, await stage.locator('canvas').screenshot())).not.toBe(0);
  }
  await page.getByRole('button', { name: '성남 전체 보기', exact: true }).click();
  await expect(page).toHaveURL(/scene=seongnam/);
  expect(new URL(page.url()).searchParams.has('spot')).toBe(false);
  await expect(stage.locator('canvas')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('all eight city landmarks retain their information, URL and creation target', async ({ page }) => {
  await page.goto('/?view=diorama');
  const stage = page.getByTestId('diorama-stage');
  await expect(stage).toHaveAttribute('data-status', 'ready');
  await showDioramaSettings(page);
  await page.getByRole('checkbox', { name: '움직임 사용', exact: true }).uncheck();
  await hideDioramaSettings(page);
  const original = await stage.locator('canvas').elementHandle();
  const landmarks = [
    ['판교박물관', 'pangyo-museum'], ['중앙공원', 'central-park'], ['모란민속5일장', 'moran-market'],
    ['율동공원', 'yuldong-park'], ['성남아트센터', 'seongnam-arts-center'], ['성남시청', 'seongnam-city-hall'],
    ['봉국사 대광명전', 'bongguksa'], ['망경암', 'manggyeongam'],
  ];
  for (const [name, id] of landmarks) {
    await selectDioramaPlace(page, name);
    await expect(page).toHaveURL(new RegExp(`scene=${id}`));
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '이 장소로 카드뉴스 만들기', exact: true })).toBeEnabled();
    expect(await original!.evaluate(element => element === document.querySelector('[data-testid="diorama-stage"] canvas'))).toBe(true);
  }
  await page.reload();
  await expect(stage).toHaveAttribute('data-status', 'ready');
  await expect(page.getByRole('heading', { name: '망경암', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '이 장소로 카드뉴스 만들기', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '소개할 장소', exact: true })).toHaveValue('망경암');
  await page.goBack();
  await expect(page).toHaveURL(/scene=manggyeongam/);
  await expect(stage).toHaveAttribute('data-status', 'ready');
});

test('mobile can return from a city landmark and restore a district without autoplay', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?view=diorama&scene=seongnam&spot=sujeong');
  await expect(page.getByTestId('diorama-stage')).toHaveAttribute('data-status', 'ready');
  await expect(page.getByRole('button', { name: '수정구 지역 보기', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await showDioramaPlaces(page);
  await page.getByRole('button', { name: '봉국사 대광명전 장면 보기', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/scene=bongguksa/);
  await page.getByRole('button', { name: '성남 전체 보기', exact: true }).click();
  await expect(page.getByRole('button', { name: '성남 전체 보기', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '분당구 지역 보기', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: '분당구 지역 보기', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '자동 감상 시작', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.getByRole('button', { name: '자동 감상 시작', exact: true }).click();
  await expect(page).not.toHaveURL(/scene=seongnam/);
  await expect(page.getByRole('button', { name: '감상 일시정지', exact: true })).toBeVisible();
});
