import { expect, test } from '@playwright/test';
import { PLACES } from '../src/lib/places';
import type { Run } from '../src/lib/types';
import { hideDioramaSettings, selectDioramaPlace, showDioramaPlaces, showDioramaSettings } from './helpers/diorama-controls';

test.beforeEach(async ({ page }) => {
  await page.route('https://www.openstreetmap.org/export/embed.html**', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Recorded coordinate map</body></html>' }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('every added attraction is searchable, source-linked and selectable without rebuilding the city', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?view=diorama');
  const stage = page.getByTestId('diorama-stage');
  await expect(stage).toHaveAttribute('data-status', 'ready');
  const original = await stage.locator('canvas').elementHandle();
  for (const place of PLACES.slice(8)) {
    await selectDioramaPlace(page, place.name);
    await expect(page).toHaveURL(new RegExp(`scene=${place.id}(?:&|$)`));
    await expect(page.getByRole('heading', { name: place.name, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '공식 장소 안내 ↗', exact: true })).toHaveAttribute('href', place.sourceUrl);
    await expect(page.getByRole('button', { name: '이 장소로 카드뉴스 만들기', exact: true })).toBeEnabled();
    expect(await original!.evaluate(element => element === document.querySelector('[data-testid="diorama-stage"] canvas'))).toBe(true);
  }
  await page.getByRole('searchbox', { name: '명소 검색', exact: true }).fill('존재하지않는명소');
  await expect(page.getByText('일치하는 명소가 없어요. 다른 이름이나 지역을 입력해 보세요.')).toBeVisible();
  await page.getByRole('button', { name: '명소 검색 지우기', exact: true }).click();
  await expect(page.locator('.diorama-directory-pagination')).toContainText(`${PLACES.length}개`);
  const next = page.getByRole('button', { name: '다음 명소 목록', exact: true });
  await next.click();
  await expect(page.locator('.diorama-directory-pagination')).toContainText('2 /');
  expect(errors).toEqual([]);
});

test('shop focus preserves tourism identity and browser history clears temporary shop information', async ({ page }) => {
  await page.goto('/?view=diorama');
  await expect(page.getByTestId('diorama-stage')).toHaveAttribute('data-status', 'ready');
  await selectDioramaPlace(page, '한국잡월드');
  await page.getByRole('button', { name: '가게·도로', exact: true }).click();
  await page.getByRole('searchbox', { name: '가게·도로 검색', exact: true }).fill('카페');
  await expect(page.locator('.diorama-urban-results > button')).toHaveCount(20);
  await page.locator('.diorama-urban-results > button').first().click();
  await expect(page.getByRole('region', { name: '공개 지도 장소 정보', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'OpenStreetMap 원본 정보 ↗', exact: true })).toHaveAttribute('href', /^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/\d+$/);
  await expect(page).toHaveURL(/scene=korea-jobworld/);
  await page.goBack();
  await expect(page.getByRole('button', { name: '성남 전체 보기', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: '공개 지도 장소 정보', exact: true })).toHaveCount(0);
  await expect(page.locator('.diorama-directory-modes button').first()).toHaveAttribute('aria-pressed', 'true');
  await page.goForward();
  await expect(page).toHaveURL(/scene=korea-jobworld/);
  await expect(page.getByRole('heading', { name: '한국잡월드', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '공개 지도 장소 정보', exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await showDioramaPlaces(page);
  await page.getByRole('button', { name: '가게·도로', exact: true }).click();
  await page.getByRole('searchbox', { name: '가게·도로 검색', exact: true }).fill('도로');
  await expect(page.locator('.diorama-urban-results > button')).toHaveCount(20);
  await page.locator('.diorama-urban-results > button').first().click();
  await expect(page.getByRole('region', { name: '공개 지도 장소 정보', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await showDioramaSettings(page);
  await expect(page.getByRole('region', { name: '공개 지도 장소 정보', exact: true })).not.toBeVisible();
});

test('people and vehicles change the WebGL image independently and safe preferences survive reload', async ({ page }) => {
  await page.goto('/?view=diorama&scene=pangyo-museum');
  const stage = page.getByTestId('diorama-stage');
  await expect(stage).toHaveAttribute('data-status', 'ready');
  await showDioramaSettings(page);
  await page.getByRole('checkbox', { name: '움직임 사용', exact: true }).uncheck();
  await hideDioramaSettings(page);
  const populated = await stage.locator('canvas').screenshot();
  await showDioramaSettings(page);
  await page.getByRole('checkbox', { name: '사람들', exact: true }).uncheck();
  await hideDioramaSettings(page);
  await expect.poll(async () => Buffer.compare(populated, await stage.locator('canvas').screenshot())).not.toBe(0);
  const carsOnly = await stage.locator('canvas').screenshot();
  await showDioramaSettings(page);
  await page.getByRole('checkbox', { name: '자동차', exact: true }).uncheck();
  await hideDioramaSettings(page);
  await expect.poll(async () => Buffer.compare(carsOnly, await stage.locator('canvas').screenshot())).not.toBe(0);
  await showDioramaSettings(page);
  await page.getByRole('combobox', { name: '도시 활기', exact: true }).selectOption('2');
  await page.getByRole('combobox', { name: '사람 크기', exact: true }).selectOption('2.5');
  await page.reload();
  await expect(stage).toHaveAttribute('data-status', 'ready');
  await showDioramaSettings(page);
  await expect(page.getByRole('checkbox', { name: '자동차', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: '사람들', exact: true })).not.toBeChecked();
  await expect(page.getByRole('combobox', { name: '도시 활기', exact: true })).toHaveValue('2');
  await expect(page.getByRole('combobox', { name: '사람 크기', exact: true })).toHaveValue('2.5');
  await expect(page.getByRole('button', { name: '자동 감상 시작', exact: true })).toBeVisible();
});

test('an added attraction without a licensed photo creates four reviewed cards from its own official sources', async ({ page, request }) => {
  const place = PLACES.find(place => place.id === 'korea-jobworld')!;
  expect(place.photo).toBeNull();
  await page.goto(`/?view=diorama&scene=${place.id}`);
  await expect(page.getByTestId('diorama-stage')).toHaveAttribute('data-status', 'ready');
  await page.getByRole('button', { name: '이 장소로 카드뉴스 만들기', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '소개할 장소', exact: true })).toHaveValue(place.name);
  await expect(page.getByRole('combobox', { name: '카드 이미지', exact: true })).toContainText('글 중심 카드로 시작');
  await expect(page.getByText('등록된 사진이 없어 글 중심 카드로 만듭니다.', { exact: false })).toBeVisible();
  await page.getByText('시연·비교 설정', { exact: true }).click();
  await page.getByLabel('테스트 상황').selectOption('normal');
  const created = page.waitForResponse(response => response.url().endsWith('/api/runs') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '카드뉴스 제작하기', exact: true }).click();
  const initial: Run = await (await created).json();
  await expect(page.locator('.status-chip[role=status]')).toHaveText('검수 통과 · 승인 대기');
  const run: Run = await request.get(`/api/runs/${initial.id}`).then(response => response.json());
  expect(run.brief.placeId).toBe(place.id);
  expect(run.cards).toHaveLength(4);
  expect(run.cards.every(card => !card.image)).toBe(true);
  expect(run.cards[3].imagination).toBe(true);
  expect(run.artifacts.filter(artifact => artifact.kind === 'png')).toHaveLength(4);
  expect(run.sources.every(source => place.officialQuotes.some(quote => quote.sourceUrl === source.url))).toBe(true);
  expect(run.evidence.every(evidence => place.officialQuotes.some(quote => quote.text === evidence.quote))).toBe(true);
  expect(run.issues.filter(issue => !issue.resolved)).toEqual([]);
});
