import { randomUUID, createHash } from "node:crypto";
import { readFile, rm, access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import type { Run } from "../src/lib/types";
import { cardHtml, renderCards } from "../src/lib/render";
import { imageDataUri, readImage, storeImage } from "../src/lib/images";
import { chromium } from "playwright";

const paths: string[] = [];
let previousImageRoot: string | undefined;
async function attachPhoto(run: Run) {
  previousImageRoot = process.env.TIMESTORY_IMAGE_DIR;
  const directory = await mkdtemp(resolve(tmpdir(), 'render-photos-'));
  paths.push(directory); process.env.TIMESTORY_IMAGE_DIR = directory;
  const browser = await chromium.launch({ headless: true });
  let bytes: Buffer;
  try {
    const page = await browser.newPage();
    const data = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 100; const context = canvas.getContext('2d')!; context.fillStyle = '#ff0000'; context.fillRect(0, 0, 200, 100); context.fillStyle = '#0000ff'; context.fillRect(200, 0, 200, 100); return canvas.toDataURL('image/png').split(',')[1]; });
    bytes = Buffer.from(data, 'base64');
  } finally { await browser.close(); }
  const asset = await storeImage(bytes, { placeId: 'pangyo-museum', kind: 'upload', author: '사진 테스트', license: '사용 권한 확인', sourceUrl: '', licenseUrl: '' });
  run.brief.placeId = 'pangyo-museum';
  for (const card of run.cards) card.image = { ...asset, crop: { x: 0.5, y: 0.5, zoom: 1 } };
}
function runFixture(): Run {
  const id = `render-test-${randomUUID()}`;
  paths.push(resolve("outputs", id));
  return {
    id,
    brief: {
      place: "판교박물관",
      audience: "청소년",
      goal: "문화 소개",
      cardCount: 4,
      includeFuture: true,
    },
    mode: "fixture",
    strategy: "agent",
    scenario: "normal",
    status: "running",
    createdAt: "2026-09-10T00:00:00Z",
    updatedAt: "2026-09-10T00:00:00Z",
    version: 2,
    reviewVersion: 2,
    sources: [
      {
        id: "s1",
        url: "https://example.org/museum",
        title: "박물관 소개",
        publisher: "성남시",
        retrievedAt: "2026-09-10T00:00:00Z",
        status: "ok",
        snapshot: "판교박물관 소개 자료",
        hash: "source-hash",
        license: "미확인",
      },
    ],
    evidence: [
      {
        id: "e1",
        sourceId: "s1",
        quote: "판교박물관 소개 자료",
        locator: "본문",
      },
    ],
    cards: Array.from({ length: 4 }, (_, index) => ({
      id: `c${index + 1}`,
      title: [
        "도시 아래, 시간을 만나다",
        "돌에 남겨진 이야기",
        "과거를 읽는 새로운 시선",
        "우리가 상상하는 문화공간",
      ][index],
      body: "판교박물관에서 우리 도시의 이야기를 만나 보세요. 오래된 공간을 살펴보며 오늘의 질문을 던져 봅니다.",
      script: "함께 박물관의 이야기를 알아볼까요?",
      claimIds: [],
      imagination: index === 3,
    })),
    claims: [],
    issues: [],
    revisions: [],
    events: [],
    artifacts: [],
    usage: {
      toolCalls: 4,
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      costKind: "fixture",
    },
    limits: {
      maxToolCalls: 12,
      maxRevisions: 3,
      maxDurationMs: 180000,
      maxModelCalls: 12,
      maxCostUsd: 1,
    },
    approval: null,
    stopReason: null,
  };
}
afterEach(async () => {
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  if (previousImageRoot === undefined) delete process.env.TIMESTORY_IMAGE_DIR;
  else process.env.TIMESTORY_IMAGE_DIR = previousImageRoot;
  previousImageRoot = undefined;
});

describe("card export boundary", () => {
  it("escapes untrusted text and does not turn source URLs into executable markup", () => {
    const run = runFixture();
    run.cards[0].title = '<script>alert("x")</script>';
    run.cards[0].body = '<img src=x onerror=alert(1)> & "quoted"';
    run.sources[0].publisher = "<svg onload=alert(2)>";
    run.sources[0].url = 'javascript:alert("x")';
    const html = cardHtml(run, run.cards[0], 0);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;svg onload=alert(2)&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('href="javascript:');
  });

  it("rejects a stale review and unresolved review issues before exporting", async () => {
    const run = runFixture();
    run.reviewVersion = 1;
    await expect(
      renderCards(run, new AbortController().signal),
    ).rejects.toThrow(/검수|review/i);
    run.reviewVersion = 2;
    run.issues = [
      {
        id: "i1",
        targetId: "c1",
        type: "source",
        severity: "warning",
        message: "근거 부족",
        evidenceIds: [],
        recommendation: "확인",
        resolved: false,
      },
    ];
    await expect(
      renderCards(run, new AbortController().signal),
    ).rejects.toThrow(/미해결|unresolved/i);
  });

  it("exports four full-sized PNGs and a ZIP with matching review versions and mode", async () => {
    const run = runFixture();
    await attachPhoto(run);
    const artifacts = await renderCards(run, new AbortController().signal);
    const pngs = artifacts.filter((file) => file.kind === "png");
    expect(pngs).toHaveLength(4);
    for (const artifact of artifacts) {
      const bytes = await readFile(artifact.path);
      expect(artifact.sha256).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
      expect(artifact.version).toBe(2);
      expect(artifact.reviewVersion).toBe(2);
      if (artifact.kind === "png") {
        expect(bytes.subarray(1, 4).toString()).toBe("PNG");
        expect(bytes.readUInt32BE(16)).toBe(1080);
        expect(bytes.readUInt32BE(20)).toBe(1080);
      }
    }
    const zip = unzipSync(
      await readFile(artifacts.find((file) => file.kind === "zip")!.path),
    );
    expect(
      Object.keys(zip).filter((name) => name.endsWith(".png")),
    ).toHaveLength(4);
    expect(strFromU8(zip["script.md"])).toContain("fixture");
    expect(JSON.parse(strFromU8(zip["review.json"]))).toMatchObject({
      version: 2,
      reviewVersion: 2,
      mode: "fixture",
      issues: [],
      auditStage: "render_snapshot",
      assessments: [],
      reviews: [],
      modelCallLog: [],
    });
    expect(JSON.parse(strFromU8(zip["sources.json"]))).toMatchObject({
      mode: "fixture",
      images: [{ cardId: 'c1', placeId: 'pangyo-museum', kind: 'upload', author: '사진 테스트', crop: { x: 0.5, y: 0.5, zoom: 1 } }, expect.anything(), expect.anything(), expect.anything()],
      evidence: [
        {
          id: "e1",
          sourceId: "s1",
          quote: "판교박물관 소개 자료",
          locator: "본문",
        },
      ],
    });
  }, 60000);

  it("rejects text overflow and removes incomplete output files", async () => {
    const run = runFixture();
    await attachPhoto(run);
    run.cards[0].body = "한글 문장이 카드 밖으로 넘칩니다. ".repeat(500);
    await expect(
      renderCards(run, new AbortController().signal),
    ).rejects.toThrow(/잘림|overflow/i);
    await expect(access(resolve("outputs", run.id, "v2"))).rejects.toThrow();
  }, 60000);

  it("does not create files for a cancelled run", async () => {
    const run = runFixture();
    const controller = new AbortController();
    controller.abort();
    await expect(renderCards(run, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(access(resolve("outputs", run.id, "v2"))).rejects.toThrow();
  });

  it('applies the shared crop formula to the actual raster and blocks external image loads', async () => {
    const run = runFixture(); await attachPhoto(run);
    const card = run.cards[0];
    const uri = await imageDataUri(card.image!);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
      const requested: string[] = []; await page.route('**/*', route => { requested.push(route.request().url()); return route.abort(); });
      const colors: number[][] = [];
      for (const x of [0, 1]) {
        card.image!.crop.x = x;
        await page.setContent(cardHtml(run, card, 0, '', uri));
        await page.locator('.photo img').evaluate(async element => { await (element as HTMLImageElement).decode(); });
        const screenshot = await page.locator('.photo').screenshot();
        colors.push(await page.evaluate(async data => { const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode(); const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height; const context = canvas.getContext('2d')!; context.drawImage(img, 0, 0); return [...context.getImageData(Math.floor(img.width / 2), Math.floor(img.height / 2), 1, 1).data]; }, screenshot.toString('base64')));
      }
      expect(colors[0].slice(0, 3)).toEqual([255, 0, 0]);
      expect(colors[1].slice(0, 3)).toEqual([0, 0, 255]);
      expect(requested).toEqual([]);
      await expect(async () => cardHtml(run, card, 0, '', 'https://evil.com/photo.png')).rejects.toThrow(/이미지|주소/);
    } finally { await browser.close(); }
  }, 60000);

  it('distinguishes actual photos from AI imagination and rejects invalid crop values', async () => {
    const run = runFixture(); await attachPhoto(run);
    const card = run.cards[3]; card.image!.kind = 'photo';
    expect(cardHtml(run, card, 3)).toContain('사진은 실제 모습');
    card.image!.kind = 'ai';
    expect(cardHtml(run, card, 3)).toContain('AI 생성 이미지');
    card.image!.crop.zoom = 4;
    expect(() => cardHtml(run, card, 3)).toThrow(/크롭/);
  }, 60000);

  it('renders long AI reference attribution without footer clipping and labels imagination explicitly (mock raster)', async () => {
    const run = runFixture(); await attachPhoto(run);
    const original = run.cards[3].image!;
    const license = 'AI 생성 이미지. 원본 이미지 제공 조건과 별개로, 참조 사진의 저작자 표시 및 동일조건변경허락 조건을 준수해야 합니다. 참조 사진 조건: CC BY-SA 3.0';
    // This red/blue test raster exercises export metadata and layout, not image-generation quality.
    const asset = await storeImage(await readImage(original), {
      placeId: original.placeId, kind: 'ai', sourceUrl: 'https://openai.com/',
      author: 'OpenAI; 참조 사진: 골뱅이', license, licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
      reference: { id: original.id, placeId: original.placeId, sha256: original.sha256, sourceUrl: 'https://example.org/mock-reference', author: '골뱅이', license: 'CC BY-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/' },
    });
    run.cards[3].image = { ...asset, crop: { x: 0.5, y: 0.5, zoom: 1 } };
    const html = cardHtml(run, run.cards[3], 3, '', await imageDataUri(asset));
    expect(html).toContain('AI 생성 이미지');
    expect(html).toContain('상상 이미지');
    const artifacts = await renderCards(run, new AbortController().signal);
    expect(artifacts.filter(artifact => artifact.kind === 'png')).toHaveLength(4);
    const zip = unzipSync(await readFile(artifacts.find(artifact => artifact.kind === 'zip')!.path));
    const sources = JSON.parse(strFromU8(zip['sources.json']));
    expect(sources.images[3]).toMatchObject({ kind: 'ai', author: 'OpenAI; 참조 사진: 골뱅이', license, reference: { author: '골뱅이', license: 'CC BY-SA 3.0' } });
    expect(JSON.parse(strFromU8(zip['review.json'])).outputChecks).toMatchObject({ imagesLoaded: true, overflow: false });
  }, 60000);

  it("rejects missing cards and missing final imagination marker", async () => {
    const run = runFixture();
    run.cards[3].imagination = false;
    await expect(
      renderCards(run, new AbortController().signal),
    ).rejects.toThrow(/상상/);
    run.cards.pop();
    await expect(
      renderCards(run, new AbortController().signal),
    ).rejects.toThrow(/4장/);
  });

  it("cleans up a render interrupted during browser startup", async () => {
    const run = runFixture();
    const controller = new AbortController();
    const task = renderCards(run, controller.signal);
    const timer = setTimeout(() => controller.abort(), 30);
    try {
      await expect(task).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      clearTimeout(timer);
    }
    await expect(access(resolve("outputs", run.id, "v2"))).rejects.toThrow();
  }, 60000);
});
