import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { zipSync } from "fflate";
import type { Artifact, Card, Run } from "./types";
import { defaultPlaceImage, imageDataUri } from "./images";

let fontPromise: Promise<string> | undefined;
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );

// Preserve every Unicode subset from the package, including uncommon Korean syllables.
function embeddedFonts(): Promise<string> {
  fontPromise ??= (async () => {
    const root = resolve(
      process.cwd(),
      "node_modules/@fontsource/noto-sans-kr",
    );
    const styles = await Promise.all(
      [400, 700].map(async (weight) => {
        const css = await readFile(resolve(root, `${weight}.css`), "utf8");
        const sources = [
          ...css.matchAll(/src:\s*url\(([^)]+\.woff2)\)[^;]+;/g),
        ];
        let embedded = css;
        for (const source of sources) {
          const bytes = await readFile(resolve(root, source[1]));
          embedded = embedded.replace(
            source[0],
            `src: url(data:font/woff2;base64,${bytes.toString("base64")}) format('woff2');`,
          );
        }
        return embedded;
      }),
    );
    return styles.join("\n");
  })();
  return fontPromise;
}

export function cardHtml(
  run: Run,
  card: Card,
  index: number,
  fontCss = "",
  photoDataUri = "",
): string {
  if (photoDataUri && !/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/]+=*$/.test(photoDataUri))
    throw new Error("검증된 로컬 이미지 주소만 카드에 포함할 수 있습니다.");
  const crop = card.image?.crop ?? { x: 0.5, y: 0.5, zoom: 1 };
  if (![crop.x, crop.y, crop.zoom].every(Number.isFinite) || crop.x < 0 || crop.x > 1 || crop.y < 0 || crop.y > 1 || crop.zoom < 1 || crop.zoom > 3)
    throw new Error("이미지 크롭 범위가 올바르지 않습니다.");
  const chapter = ["발견", "기록", "연결", "상상"][index] ?? "문화";
  const color = card.imagination ? "#7854AF" : "#244CC5";
  const sourceNames = [...new Set(run.sources.filter(source => source.status === "ok").map(source => source.publisher))].join(" · ");
  const modeLabel = run.mode === "fixture" ? "fixture · 준비된 응답 시연" : "live · 실제 API 실행";
  const imageLabel = card.image?.kind === 'ai'
    ? (card.imagination || card.image.prompt?.imagination ? 'AI 생성 이미지 · 상상 이미지' : 'AI 생성 이미지 · 실제 사진 아님')
    : card.image?.kind === 'photo' ? '실제 장소 사진' : '사용자 업로드 이미지';
  const storyLabel = card.imagination ? (card.image?.kind === 'photo' ? '상상 장면 · 사진은 실제 모습' : '상상 장면 · 실제 사업 계획 아님') : '지역문화 이야기';
  const credit = card.image ? `${card.image.author} · ${card.image.license}` : '사진을 선택해 주세요';
  const cropStyle = `object-position:${crop.x * 100}% ${crop.y * 100}%;transform:scale(${crop.zoom});transform-origin:${crop.x * 100}% ${crop.y * 100}%`;
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:"><style>${fontCss}
*{box-sizing:border-box}html,body{margin:0;width:1080px;height:1080px}body{font-family:'Noto Sans KR',sans-serif;color:#182236}.card{width:1080px;height:1080px;background:#FCFCFD;display:grid;grid-template-rows:70px 430px 170px 212px 1fr;overflow:hidden}header{display:flex;justify-content:space-between;align-items:center;padding:0 54px;font-size:20px;color:${color};font-weight:700}.series{letter-spacing:3px}.number{font-size:19px}.photo{margin:0;width:1080px;height:430px;position:relative;overflow:hidden;background:#E8EDF3}.photo img{display:block;width:100%;height:100%;object-fit:cover}.photo figcaption{position:absolute;left:54px;bottom:22px;padding:8px 12px;background:rgba(255,255,255,.95);font-size:16px;font-weight:700;color:#182236;border-radius:4px}.title{padding:23px 54px 4px;min-height:0}.chapter{font-size:17px;line-height:1.5;color:${color};margin:0 0 9px;letter-spacing:2px}h1{font-size:46px;line-height:1.25;letter-spacing:-1.8px;font-weight:700;margin:0;word-break:keep-all;overflow-wrap:anywhere}.body{font-size:28px;line-height:1.6;letter-spacing:-.55px;margin:0;padding:8px 54px 20px;white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere}footer{margin:0 54px;padding:18px 0 24px;border-top:1px solid #D8DEE8;display:flex;flex-direction:column;justify-content:space-between;font-size:14px;line-height:1.5;min-height:0}.foot-row{display:flex;justify-content:space-between;gap:18px}.badge{font-size:16px;font-weight:700;color:${color}}.note{color:#465066}.credit{font-size:15px;margin:7px 0;overflow-wrap:anywhere}.sources{max-width:630px}.mode{white-space:nowrap}[data-fit]{min-width:0;min-height:0}
</style></head><body><main class="card"><header><span class="series">성남 타임스토리</span><span class="number">0${index + 1} / 04</span></header><figure class="photo">${photoDataUri ? `<img src="${photoDataUri}" alt="${escapeHtml(run.brief.place)} · ${imageLabel}" style="${cropStyle}">` : ''}<figcaption>${imageLabel}</figcaption></figure><section class="title" data-fit="title"><p class="chapter">${chapter} · ${escapeHtml(run.brief.place)}</p><h1>${escapeHtml(card.title)}</h1></section><p class="body" data-fit="body">${escapeHtml(card.body)}</p><footer data-fit="footer"><div><span class="badge">${storyLabel}</span><p class="credit">이미지: ${escapeHtml(credit)} · 크롭 적용</p></div><div class="foot-row note"><span class="sources">자료: ${escapeHtml(sourceNames || '별첨 출처 목록 확인')} · 출처와 이미지 권리는 sources.json</span><span class="mode">${modeLabel} · v${run.version}</span></div></footer></main></body></html>`;
}

export async function renderCards(
  input: Run,
  signal: AbortSignal,
): Promise<Artifact[]> {
  signal.throwIfAborted();
  // Freeze the reviewed content before asynchronous rendering; callers own approval state.
  const run = structuredClone(input);
  if (run.reviewVersion !== run.version)
    throw new Error("검수 버전이 콘텐츠와 일치하지 않습니다.");
  if (run.issues.some((issue) => !issue.resolved))
    throw new Error("미해결 검수 항목이 있습니다.");
  if (run.cards.length !== 4)
    throw new Error("카드뉴스는 정확히 4장이어야 합니다.");
  if (!run.cards[3].imagination)
    throw new Error("마지막 카드에 상상 장면 표시가 필요합니다.");
  if (
    !/^[a-zA-Z0-9_-]+$/.test(run.id) ||
    !Number.isSafeInteger(run.version) ||
    run.version < 1
  )
    throw new Error("잘못된 출력 경로입니다.");
  const root = resolve("outputs", run.id);
  const destination = resolve(root, `v${run.version}`);
  const staging = resolve(root, `.v${run.version}-${randomUUID()}`);
  const files: Record<string, Uint8Array> = {};
  let browser: Browser | undefined;
  const abortBrowser = () => {
    void browser?.close().catch(() => {});
  };
  signal.addEventListener("abort", abortBrowser, { once: true });
  try {
    const fonts = await embeddedFonts();
    const imageUris = new Map<string, string>();
    const fallback = run.cards.some(card => !card.image) ? await defaultPlaceImage(run.brief.placeId ?? run.brief.place) : undefined;
    const expectedPlaceId = run.brief.placeId ?? fallback?.placeId;
    for (const card of run.cards) {
      signal.throwIfAborted();
      card.image ??= fallback ? structuredClone(fallback) : undefined;
      if (!card.image) throw new Error("카드에 사용할 장소 사진을 선택해야 합니다.");
      if (expectedPlaceId && card.image.placeId !== expectedPlaceId) throw new Error("카드 이미지의 장소가 제작 요청과 다릅니다.");
      const key = `${card.image.id}:${card.image.sha256}`;
      if (!imageUris.has(key)) imageUris.set(key, await imageDataUri(card.image));
    }
    signal.throwIfAborted();
    await mkdir(staging, { recursive: true });
    browser = await chromium.launch({ headless: true });
    signal.throwIfAborted();
    const page = await browser.newPage({
      viewport: { width: 1080, height: 1080 },
      deviceScaleFactor: 1,
    });
    page.setDefaultTimeout(15000);
    await page.route("**/*", (route) => route.abort());
    for (const [index, card] of run.cards.entries()) {
      signal.throwIfAborted();
      await page.setContent(cardHtml(run, card, index, fonts, imageUris.get(`${card.image!.id}:${card.image!.sha256}`)), {
        waitUntil: "load",
      });
      const output = await page.evaluate(async () => {
        await document.fonts.ready;
        const images = [...document.images];
        await Promise.all(images.map(image => image.decode()));
        const imagesLoaded = images.length === 1 && images.every(image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
        const text = document.body.textContent ?? "";
        const normal = await document.fonts.load(
          '400 29px "Noto Sans KR"',
          text,
        );
        const bold = await document.fonts.load('700 53px "Noto Sans KR"', text);
        const overflow = [
          ...document.querySelectorAll<HTMLElement>("[data-fit]"),
        ]
          .filter(
            (element) =>
              element.scrollHeight > element.clientHeight + 1 ||
              element.scrollWidth > element.clientWidth + 1,
          )
          .map((element) => element.dataset.fit);
        return {
          imagesLoaded,
          fontsLoaded:
            normal.length > 0 &&
            bold.length > 0 &&
            document.fonts.check('400 29px "Noto Sans KR"', text) &&
            document.fonts.check('700 53px "Noto Sans KR"', text),
          overflow,
        };
      });
      if (!output.imagesLoaded) throw new Error("카드 사진을 불러오지 못했습니다.");
      if (!output.fontsLoaded)
        throw new Error("한글 글꼴을 불러오지 못했습니다.");
      if (output.overflow.length)
        throw new Error(
          `${index + 1}장 텍스트 잘림 (overflow): ${output.overflow.join(", ")}`,
        );
      const png = await page
        .locator(".card")
        .screenshot({ type: "png", animations: "disabled" });
      if (png.readUInt32BE(16) !== 1080 || png.readUInt32BE(20) !== 1080)
        throw new Error("카드 이미지 크기가 올바르지 않습니다.");
      files[`card-${index + 1}.png`] = png;
    }
    const metadata = {
      runId: run.id,
      mode: run.mode,
      strategy: run.strategy,
      version: run.version,
      reviewVersion: run.reviewVersion,
      auditStage: "render_snapshot",
      execution: run.execution ?? null,
    };
    files["script.md"] = Buffer.from(
      `# 성남 타임스토리 — 카드뉴스 대본\n\n실행 모드: ${run.mode}${run.mode === "fixture" ? " (준비된 응답 시연; 실제 모델 성능 측정 아님)" : ""}\n콘텐츠/검수 버전: ${run.version}/${run.reviewVersion}\n\n${run.cards.map((card, index) => `## ${index + 1}. ${escapeHtml(card.title)}${card.imagination ? " [상상 장면]" : ""}\n\n${escapeHtml(card.body)}\n\n대본: ${escapeHtml(card.script)}\n`).join("\n")}\n문장별 근거: sources.json\n검수 및 수정 이력: review.json\n`,
    );
    files["sources.json"] = Buffer.from(
      JSON.stringify(
        {
          ...metadata,
          sources: run.sources,
          evidence: run.evidence,
          claims: run.claims,
          searches: run.searches ?? [],
          images: run.cards.map(card => ({ cardId: card.id, ...card.image })),
        },
        null,
        2,
      ),
    );
    files["review.json"] = Buffer.from(
      JSON.stringify(
        {
          ...metadata,
          issues: run.issues,
          revisions: run.revisions,
          events: run.events,
          usage: run.usage,
          limits: run.limits,
          assessments: run.assessments ?? [],
          reviews: run.reviews ?? [],
          modelCallLog: run.modelCallLog ?? [],
          outputChecks: {
            cardCount: 4,
            width: 1080,
            height: 1080,
            fontsLoaded: true,
            imagesLoaded: true,
            overflow: false,
          },
        },
        null,
        2,
      ),
    );
    files["timestory.zip"] = zipSync(files, { level: 6 });
    signal.throwIfAborted();
    const artifacts: Artifact[] = [];
    for (const [name, bytes] of Object.entries(files)) {
      await writeFile(resolve(staging, name), bytes, { signal });
      artifacts.push({
        name,
        path: resolve(destination, name),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        version: run.version,
        reviewVersion: run.reviewVersion,
        kind: name.endsWith(".png")
          ? "png"
          : name.endsWith(".zip")
            ? "zip"
            : name.endsWith(".json")
              ? "json"
              : "text",
      });
    }
    signal.throwIfAborted();
    await rm(destination, { recursive: true, force: true });
    await rename(staging, destination);
    if (signal.aborted) {
      await rm(destination, { recursive: true, force: true });
      signal.throwIfAborted();
    }
    return artifacts;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    signal.throwIfAborted();
    throw error;
  } finally {
    signal.removeEventListener("abort", abortBrowser);
    await browser?.close();
  }
}
