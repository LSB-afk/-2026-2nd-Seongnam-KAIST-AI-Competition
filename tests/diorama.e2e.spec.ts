import { expect, test } from '@playwright/test';
import { selectDioramaPlace, hideDioramaSettings, showDioramaPlaces, showDioramaSettings } from './helpers/diorama-controls';

test.beforeEach(async ({ page }) => {
  await page.route('https://www.openstreetmap.org/export/embed.html**', route => route.fulfill({ contentType: 'text/html', body: '<html><body>OpenStreetMap test document</body></html>' }));
});

test('independent 3D menu renders a real scene and preserves navigation and creation identity', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: '성남 3D 여행', exact: true }).click();
  await expect(page).toHaveURL(/view=diorama/);
  await expect(page.getByRole('heading', { name: '성남 3D 여행', exact: true })).toBeVisible();
  const stage = page.getByTestId('diorama-stage');
  await expect(stage).toHaveAttribute('data-status', 'ready');
  await expect(stage.locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: '중앙공원 장면 보기', exact: true }).click();
  await expect(page).toHaveURL(/scene=central-park/);
  await page.getByRole('button', { name: '호수 곁 정자 관찰', exact: true }).first().click();
  await expect(page).toHaveURL(/spot=park-pavilion/);
  await page.reload();
  await expect(stage).toHaveAttribute('data-status', 'ready');
  await expect(page.getByRole('heading', { name: '중앙공원', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '이 장소로 카드뉴스 만들기', exact: true }).click();
  await expect(page).toHaveURL(/view=studio/);
  await expect(page.getByRole('textbox', { name: '소개할 장소', exact: true })).toHaveValue('중앙공원');
  await page.goBack();
  await expect(page).toHaveURL(/view=diorama/);
  await expect(stage).toHaveAttribute('data-status', 'ready');
});

test('camera controls change actual rendered pixels and the tour stops on manual interaction', async ({ page }) => {
  await page.goto('/?view=diorama&scene=pangyo-museum');
  const stage = page.getByTestId('diorama-stage');
  await expect(stage).toHaveAttribute('data-status', 'ready');
  await showDioramaSettings(page);
  await page.getByRole('checkbox', { name: '움직임 사용', exact: true }).uncheck();
  await hideDioramaSettings(page);
  const canvas = stage.locator('canvas');
  const before = await canvas.screenshot();
  await page.getByRole('button', { name: '확대', exact: true }).click();
  await expect.poll(async () => Buffer.compare(before, await canvas.screenshot())).not.toBe(0);
  await page.getByRole('button', { name: '자동 감상 시작', exact: true }).click();
  await expect(page.getByRole('button', { name: '감상 일시정지', exact: true })).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('3D canvas has no layout');
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .65);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .65, box.y + box.height * .65, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByText('직접 둘러보는 중', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '자동 감상 시작', exact: true })).toBeVisible();
  await showDioramaSettings(page);
  await expect(page.getByRole('checkbox', { name: '움직임 사용', exact: true })).not.toBeChecked();
});

test('WebGL failure retains the selected place information and creation action', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
      if (kind === 'webgl2' || kind === 'webgl' || kind === 'experimental-webgl') return null;
      return Reflect.apply(original, this, [kind, ...args]);
    } as typeof original;
  });
  await page.goto('/?view=diorama&scene=moran-market');
  await expect(page.getByTestId('diorama-stage')).toHaveAttribute('data-status', 'error');
  await expect(page.getByRole('heading', { name: '모란민속5일장', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '이 장소로 카드뉴스 만들기', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '자동 감상 시작', exact: true })).toBeDisabled();
});

test('mobile scene provides keyboard-accessible controls without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?view=diorama&scene=central-park');
  await expect(page.getByTestId('diorama-stage')).toHaveAttribute('data-status', 'ready');
  await expect(page.getByRole('button', { name: '자동 감상 시작', exact: true })).toBeVisible();
  await showDioramaSettings(page);
  await expect(page.getByText('기기의 모션 줄이기 설정을 적용했어요.', { exact: true })).toBeVisible();
  await hideDioramaSettings(page);
  await showDioramaPlaces(page);
  await page.getByRole('button', { name: '모란민속5일장 장면 보기', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/scene=moran-market/);
  await page.getByRole('button', { name: '확대', exact: true }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.getByRole('button', { name: '이 장소로 카드뉴스 만들기', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: '이 장소로 카드뉴스 만들기', exact: true })).toBeVisible();
});

test('automatic tour advances, pauses reading time, and resumes only when requested', async ({ page }) => {
  await page.goto('/?view=diorama&scene=pangyo-museum');
  await expect(page.getByTestId('diorama-stage')).toHaveAttribute('data-status', 'ready');
  await showDioramaSettings(page);
  await page.getByRole('checkbox', { name: '움직임 사용', exact: true }).uncheck();
  await hideDioramaSettings(page);
  await showDioramaSettings(page);
  await page.getByRole('combobox', { name: '설명 감상 시간', exact: true }).selectOption('6');
  await page.getByRole('combobox', { name: '이동 속도', exact: true }).selectOption('2');
  await hideDioramaSettings(page);
  await page.getByRole('button', { name: '자동 감상 시작', exact: true }).click();
  await expect(page).toHaveURL(/spot=museum-exterior/);
  await expect(page.getByText(/다음 풍경까지 [1-6]초/)).toBeVisible();
  await page.getByRole('button', { name: '감상 일시정지', exact: true }).click();
  const pausedUrl = page.url();
  // Longer than the configured dwell: a paused timer must not consume reading time.
  await page.waitForTimeout(6500);
  expect(page.url()).toBe(pausedUrl);
  await page.getByRole('button', { name: '자동 감상 계속', exact: true }).click();
  await expect(page).toHaveURL(/spot=museum-garden/, { timeout: 8500 });
  await page.getByRole('button', { name: '감상 일시정지', exact: true }).click();
  await page.getByRole('button', { name: '다음 관찰 지점', exact: true }).click();
  await expect(page).toHaveURL(/scene=central-park.*spot=park-lake/);
  await page.getByRole('button', { name: '자동 감상 계속', exact: true }).click();
  await expect(page.getByText(/다음 풍경까지 [1-6]초/)).toBeVisible();
  await page.getByRole('button', { name: '감상 종료', exact: true }).click();
  await expect(page.getByRole('button', { name: '자동 감상 시작', exact: true })).toBeVisible();
});

test('rapid selection, saved-only filtering and context-loss recovery keep the same place', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/?view=diorama');
  const stage = page.getByTestId('diorama-stage');
  await expect(stage).toHaveAttribute('data-status', 'ready');
  await showDioramaSettings(page);
  await page.getByRole('checkbox', { name: '저장한 장소만 감상', exact: true }).check();
  await hideDioramaSettings(page);
  await expect(page.getByRole('button', { name: '자동 감상 시작', exact: true })).toBeDisabled();
  for (const name of ['중앙공원', '판교박물관', '모란민속5일장', '중앙공원', '모란민속5일장']) {
    await selectDioramaPlace(page, name);
  }
  await expect(page.getByRole('heading', { name: '모란민속5일장', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '모란민속5일장 저장', exact: true }).click();
  await page.getByRole('button', { name: '자동 감상 시작', exact: true }).click();
  await expect(page).toHaveURL(/scene=moran-market.*spot=market-stalls/);
  await expect(page.getByText(/다음 풍경까지/)).toBeVisible();
  const hadExtension = await stage.locator('canvas').evaluate(node => {
    const extension = (node as HTMLCanvasElement).getContext('webgl2')?.getExtension('WEBGL_lose_context');
    extension?.loseContext();
    return Boolean(extension);
  });
  expect(hadExtension).toBe(true);
  await expect(stage).toHaveAttribute('data-status', 'error');
  await expect(page.getByRole('button', { name: '이 장소로 카드뉴스 만들기', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '3D 화면 다시 불러오기', exact: true }).click();
  await expect(stage).toHaveAttribute('data-status', 'ready');
  await expect(page).toHaveURL(/scene=moran-market.*spot=market-stalls/);
  await expect(page.getByRole('button', { name: '자동 감상 시작', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '모란민속5일장 저장 해제', exact: true }).click();
  await expect(page.getByRole('button', { name: '자동 감상 시작', exact: true })).toBeDisabled();
  expect(pageErrors).toEqual([]);
});

test('leaving the scene unmounts WebGL and restoring the page never restarts playback', async ({ page }) => {
  await page.goto('/?view=diorama');
  await expect(page.getByTestId('diorama-stage')).toHaveAttribute('data-status', 'ready');
  await page.getByRole('button', { name: '자동 감상 시작', exact: true }).click();
  await expect(page.getByText(/다음 풍경까지/)).toBeVisible();
  await page.getByRole('button', { name: '주 메뉴 열기', exact: true }).click();
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: 'AI 에이전트', exact: true }).click();
  await expect(page.getByTestId('diorama-stage')).toHaveCount(0);
  await page.goBack();
  await expect(page.getByTestId('diorama-stage')).toHaveAttribute('data-status', 'ready');
  await expect(page.getByRole('button', { name: '자동 감상 시작', exact: true })).toBeVisible();
  await expect(page.getByText('원하는 곳부터 둘러보세요', { exact: true })).toBeVisible();
});

test('the default guide leaves tablet playback controls clickable', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/?view=diorama&scene=moran-market');
  await expect(page.getByTestId('diorama-stage')).toHaveAttribute('data-status', 'ready');
  const next = page.getByRole('button', { name: '다음 관찰 지점', exact: true });
  await expect(next).toBeVisible();
  await expect.poll(() => next.evaluate(button => {
    const rect = button.getBoundingClientRect();
    const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return top === button || button.contains(top);
  })).toBe(true);
  await next.click();
  await expect(page).toHaveURL(/spot=market-stalls/);
});
