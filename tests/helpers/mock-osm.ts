import type { Page } from "@playwright/test";

/** Avoid repeated public-map traffic. Real map screenshots are a separate manual check. */
export async function mockOsmEmbed(page: Page) {
  await page.route("https://www.openstreetmap.org/export/embed.html?*", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: '<html lang="ko"><body style="margin:0;background:#dce9dd"><p>OpenStreetMap 임베드 모의 응답</p></body></html>' }));
}
