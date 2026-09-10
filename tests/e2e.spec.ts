import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import type { Run } from "../src/lib/types";

test("causal error recovery, evidence, approval, download and edited-version re-review", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "도시의 이야기를, 근거 있는 콘텐츠로." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "실제 AI", exact: true }),
  ).toBeDisabled();
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/api/runs") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "카드뉴스 제작하기" }).click();
  const response = await created;
  expect(response.ok()).toBe(true);
  const initial: Run = await response.json();
  await expect(page.getByRole("status")).toHaveText("검수 통과 · 승인 대기", {
    timeout: 60000,
  });
  const run: Run = await page.request
    .get(`/api/runs/${initial.id}`)
    .then((r) => r.json());
  expect(run.version).toBe(2);
  expect(run.events.filter((e) => e.action === "search_sources").length).toBe(
    2,
  );
  expect(run.claims.some((c) => c.text.includes("AI 산업으로 이어"))).toBe(
    false,
  );
  expect(
    run.issues.some((i) => i.resolved && i.type === "unsupported_relation"),
  ).toBe(true);
  await expect(page.locator("blockquote")).toContainText("2013년 4월 2일");
  await page.getByRole("button", { name: /3장 .* 근거 보기/ }).click();
  await page.getByRole("tab", { name: "수정 내역" }).click();
  await expect(page.locator(".before")).toContainText("AI 산업으로 이어졌다");
  await expect(page.locator(".after")).toContainText("2003년부터 2008년");
  await page.getByLabel("확인 담당자").fill("시연 담당자");
  await page.getByRole("button", { name: "최종 결과 승인" }).click();
  await expect(page.getByRole("status")).toHaveText("담당자 승인 완료");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "카드뉴스 패키지 다운로드" }).click();
  const download = await downloadEvent;
  const archive = unzipSync(await readFile((await download.path())!));
  expect(Object.keys(archive).filter((n) => n.endsWith(".png"))).toHaveLength(
    4,
  );
  expect(JSON.parse(strFromU8(archive["review.json"])).mode).toBe("fixture");
  for (let i = 1; i <= 4; i++) {
    const buffer = Buffer.from(archive[`card-${i}.png`]);
    expect(buffer.readUInt32BE(16)).toBe(1080);
    expect(buffer.readUInt32BE(20)).toBe(1080);
  }
  await mkdir("outputs", { recursive: true });
  await page.screenshot({
    path: "outputs/e2e-studio-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /3장 .* 근거 보기/ }).click();
  await page.getByRole("tab", { name: "직접 수정" }).click();
  await page
    .getByLabel("카드 제목", { exact: true })
    .fill("땅속에서 만나는 시간");
  await page.getByRole("button", { name: "수정 저장" }).click();
  await expect(page.getByRole("status")).toHaveText("담당자 검토 필요");
  const edited: Run = await page.request
    .get(`/api/runs/${initial.id}`)
    .then((r) => r.json());
  expect(edited.version).toBe(3);
  expect(edited.approval).toBeNull();
  expect(edited.reviewVersion).toBeNull();
  expect(edited.artifacts).toHaveLength(0);
  await page.getByRole("button", { name: "수정 내용 재검수" }).click();
  await expect(page.getByRole("status")).toHaveText("검수 통과 · 승인 대기", {
    timeout: 60000,
  });
  const reviewed: Run = await page.request
    .get(`/api/runs/${initial.id}`)
    .then((r) => r.json());
  expect(reviewed.cards[2].title).toBe("땅속에서 만나는 시간");
  expect(
    reviewed.artifacts.every((a) => a.version === 3 && a.reviewVersion === 3),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("unavailable sources produce an explicit handoff without invented artifacts", async ({
  request,
}) => {
  const response = await request.post("/api/runs", {
    data: {
      mode: "fixture",
      scenario: "unavailable",
      requestId: crypto.randomUUID(),
    },
  });
  expect(response.ok()).toBe(true);
  const initial: Run = await response.json();
  await expect
    .poll(async () => {
      const r: Run = await request
        .get(`/api/runs/${initial.id}`)
        .then((r) => r.json());
      return r.status;
    })
    .toBe("needs_review");
  const r: Run = await request
    .get(`/api/runs/${initial.id}`)
    .then((r) => r.json());
  expect(r.evidence).toHaveLength(0);
  expect(r.artifacts).toHaveLength(0);
  expect(r.stopReason).toContain("거짓 판정이 아니며");
});

test("API rejects cross-origin mutations, invalid input, and unconfigured live execution", async ({
  request,
}) => {
  const cross = await request.post("/api/runs", {
    headers: { Origin: "https://untrusted.example" },
    data: { mode: "fixture", requestId: crypto.randomUUID() },
  });
  expect(cross.status()).toBe(403);
  const invalid = await request.post("/api/runs", {
    data: { mode: "fixture", requestId: "x" },
  });
  expect(invalid.status()).toBe(400);
  const live = await request.post("/api/runs", {
    data: { mode: "live", requestId: crypto.randomUUID() },
  });
  expect(live.status()).toBe(503);
});

test("mobile workspace has no horizontal overflow and usable form", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "카드뉴스 제작하기" }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.screenshot({
    path: "outputs/e2e-studio-mobile.png",
    fullPage: true,
  });
});
