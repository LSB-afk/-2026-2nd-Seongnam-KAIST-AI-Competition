import { expect, type Page } from '@playwright/test';

export async function showDioramaSettings(page: Page) {
  const button = page.getByRole('button', { name: '감상 설정', exact: true });
  if (await button.getAttribute('aria-expanded') === 'false') await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
}

export async function hideDioramaSettings(page: Page) {
  const button = page.getByRole('button', { name: '감상 설정', exact: true });
  if (await button.getAttribute('aria-expanded') === 'true') await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
}

export async function showDioramaPlaces(page: Page) {
  const button = page.getByRole('button', { name: /명소 패널 (열기|접기)/ });
  if (await button.getAttribute('aria-expanded') === 'false') await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
}

/** The expanded catalogue remains accessible even after selection collapses it. */
export async function selectDioramaPlace(page: Page, name: string) {
  await showDioramaPlaces(page);
  await page.locator('.diorama-directory-modes button').first().click();
  await page.getByRole('searchbox', { name: '명소 검색', exact: true }).fill(name);
  const toggle = page.getByRole('button', { name: /명소 목록 (접기|펼치기)/ });
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  await page.getByRole('button', { name: `${name} 장면 보기`, exact: true }).click();
}
