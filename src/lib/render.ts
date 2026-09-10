import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { zipSync } from "fflate";
import type { Artifact, Card, Run } from "./types";

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

function illustration(index: number): string {
  const common =
    'viewBox="0 0 936 260" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="시간과 문화공간을 표현한 추상 도형"';
  const drawings = [
    '<circle cx="750" cy="60" r="108" fill="#DBE8FF"/><path d="M0 250H936M0 210H936" stroke="#EAF0FF" stroke-width="2"/><path d="M130 250V90L278 22L426 90V250" fill="#244CC5"/><path d="M182 250V120L278 78L374 120V250" fill="#98B5F5"/><path d="M232 250V151L278 130L324 151V250" fill="#EAF0FF"/><path d="M520 250V110H664V250M692 250V168H824V250" fill="#5174D0"/><circle cx="800" cy="46" r="14" fill="#244CC5"/>',
    '<path d="M68 215L115 69L305 30L381 204Z" fill="#236653"/><path d="M347 225L407 44L615 71L651 219Z" fill="#68A893"/><path d="M619 232L691 90L843 46L909 230Z" fill="#A2CABA"/><path d="M97 167L334 116M381 151L628 127M661 174L867 123" stroke="#DAEEE4" stroke-width="5"/><circle cx="73" cy="37" r="20" fill="#D9AB66"/><path d="M0 250H936" stroke="#236653" stroke-width="2"/>',
    '<circle cx="255" cy="130" r="114" fill="#D3DEF5"/><circle cx="255" cy="130" r="62" fill="#244CC5"/><path d="M430 130H629" stroke="#244CC5" stroke-width="3" stroke-dasharray="7 12"/><path d="M665 242V67L781 15L897 67V242Z" fill="#A3C7BC"/><path d="M720 242V113L781 83L842 113V242" fill="#176A59"/><path d="M247 101L281 131L247 163" fill="none" stroke="#FFFFFF" stroke-width="6"/><circle cx="561" cy="51" r="14" fill="#D9AB66"/>',
    '<circle cx="765" cy="83" r="93" fill="#D4C6EE"/><path d="M80 247V102L184 49L288 102V247" fill="#7854AF"/><path d="M126 247V139L184 110L242 139V247" fill="#F1EBFA"/><path d="M359 247V78Q458 -50 557 78V247" fill="#B098D5"/><path d="M405 247V89Q458 22 511 89V247" fill="#F1EBFA"/><path d="M627 247V158L732 105L837 158V247" fill="#537C70"/><path d="M656 247V183L732 146L808 183V247" fill="#B9D7CD"/><path d="M62 39H94M78 23V55M604 65H628M616 53V77" stroke="#7854AF" stroke-width="4"/>',
  ];
  return `<svg ${common}>${drawings[index]}</svg>`;
}

export function cardHtml(
  run: Run,
  card: Card,
  index: number,
  fontCss = "",
): string {
  const chapter = ["발견", "기록", "연결", "상상"][index] ?? "문화";
  const palette = [
    ["#EFF4FF", "#244CC5"],
    ["#EAF4EE", "#176A59"],
    ["#F6F7F9", "#244CC5"],
    ["#F1EBFA", "#7854AF"],
  ][index] ?? ["#EFF4FF", "#244CC5"];
  const sourceNames = [
    ...new Set(
      run.sources
        .filter((source) => source.status === "ok")
        .map((source) => source.publisher),
    ),
  ].join(" · ");
  const modeLabel =
    run.mode === "fixture"
      ? "fixture · 준비된 응답 시연"
      : "live · 실제 API 실행";
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:"><style>${fontCss}
*{box-sizing:border-box}html,body{margin:0;width:1080px;height:1080px}body{font-family:'Noto Sans KR',sans-serif;color:#182236} .card{width:1080px;height:1080px;background:${palette[0]};padding:64px 72px;display:grid;grid-template-rows:48px 174px 260px 180px 1fr;gap:24px;overflow:hidden}header{display:flex;justify-content:space-between;align-items:center;font-size:21px;color:${palette[1]};font-weight:700;border-bottom:1px solid currentColor;padding-bottom:16px}.series{letter-spacing:3px}.number{font-size:22px}.title{display:flex;flex-direction:column;justify-content:center;min-height:0}.chapter{font-size:20px;color:${palette[1]};margin:0 0 10px;letter-spacing:4px}h1{font-size:53px;line-height:1.3;letter-spacing:-2.4px;font-weight:700;margin:0;word-break:keep-all;overflow-wrap:anywhere}svg{width:936px;height:260px;display:block}.body{font-size:29px;line-height:1.65;letter-spacing:-.7px;margin:0;white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere}footer{border-top:1px solid #18223633;padding-top:18px;display:flex;flex-direction:column;justify-content:space-between;font-size:15px;line-height:1.5;min-height:0}.foot-row{display:flex;justify-content:space-between;gap:16px}.badge{font-size:17px;font-weight:700;color:${palette[1]};padding:4px 11px;border:1px solid currentColor;border-radius:4px}.note{color:#465066}.sources{max-width:670px}.mode{white-space:nowrap}[data-fit]{min-width:0;min-height:0}
</style></head><body><main class="card"><header><span class="series">성남 타임스토리</span><span class="number">0${index + 1} / 04</span></header><section class="title" data-fit="title"><p class="chapter">${chapter} · ${escapeHtml(run.brief.place)}</p><h1>${escapeHtml(card.title)}</h1></section>${illustration(index)}<p class="body" data-fit="body">${escapeHtml(card.body)}</p><footer data-fit="footer"><div class="foot-row"><span class="badge">${card.imagination ? "상상 장면 · 실제 사업 계획 아님" : "지역문화 이야기"}</span><span class="note">추상 일러스트 · 실제 유물 사진 아님</span></div><div class="foot-row note"><span class="sources">자료: ${escapeHtml(sourceNames || "별첨 출처 목록 확인")} · 문장별 근거는 sources.json</span><span class="mode">${modeLabel} · v${run.version}</span></div></footer></main></body></html>`;
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
      await page.setContent(cardHtml(run, card, index, fonts), {
        waitUntil: "load",
      });
      const output = await page.evaluate(async () => {
        await document.fonts.ready;
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
          fontsLoaded:
            normal.length > 0 &&
            bold.length > 0 &&
            document.fonts.check('400 29px "Noto Sans KR"', text) &&
            document.fonts.check('700 53px "Noto Sans KR"', text),
          overflow,
        };
      });
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
