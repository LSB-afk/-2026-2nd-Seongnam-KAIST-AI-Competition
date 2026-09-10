import { createHash } from "node:crypto";
import type { Run, Decision, SourceResult, Source } from "./types";

const CATALOG = [
  {
    id: "source-faq",
    url: "https://museum.seongnam.go.kr/pangyo/contents/content.do?cIdx=57&fboard=board_faq",
    title: "판교박물관 자주하는 질문",
    quotes: [
      {
        id: "evidence-opening",
        quote: "판교박물관은 2013년 4월 2일 개관하였습니다.",
      },
      {
        id: "evidence-exhibit",
        quote:
          "백제 · 고구려 시대 석실분과 판교 전역에서 출토된 유물 중 일부를 전시하고 있습니다.",
      },
    ],
  },
  {
    id: "source-history",
    url: "https://museum.seongnam.go.kr/pangyo/contents/content.do?cIdx=64",
    title: "판교박물관 건립배경 — 이전",
    quotes: [
      {
        id: "evidence-excavation",
        quote: "2003년부터 2008년까지 발굴조사를 진행하였습니다.",
      },
    ],
  },
];
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export function assertOfficialUrl(value: string): void {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.hostname !== "museum.seongnam.go.kr" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443")
  )
    throw new Error("허용된 공식 박물관 HTTPS 주소만 수집할 수 있습니다.");
}
export function fixtureSources(): SourceResult {
  const sources: Source[] = CATALOG.map((c) => ({
    id: c.id,
    url: c.url,
    title: c.title,
    publisher: "성남시 판교박물관",
    retrievedAt: "2026-09-10T07:30:00.000Z",
    status: "ok",
    snapshot: c.quotes.map((q) => q.quote).join("\n"),
    hash: sha(c.quotes.map((q) => q.quote).join("\n")),
    license:
      "공식 원문 발췌를 검증용 fixture로 보관. 소장 이미지 사용 권한은 포함하지 않습니다.",
  }));
  return {
    sources,
    evidence: CATALOG.flatMap((c) =>
      c.quotes.map((q) => ({
        ...q,
        sourceId: c.id,
        locator: "공식 페이지 본문 발췌 (2026-09-10 확인)",
      })),
    ),
  };
}
function plainText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const cp = Number(n);
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}
export async function fetchOfficialPage(
  url: string,
  signal: AbortSignal,
): Promise<string> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    assertOfficialUrl(current);
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      headers: {
        "user-agent":
          "SeongnamTimeStory/0.1 (official cultural content research)",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next) throw new Error("주소 이동 정보 없음");
      await response.body?.cancel();
      current = new URL(next, current).href;
      continue;
    }
    if (!response.ok)
      throw new Error(`공식 자료 응답 오류 (${response.status})`);
    if (!response.headers.get("content-type")?.includes("text/html"))
      throw new Error("HTML 원문이 아닙니다.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("원문 응답이 비어 있습니다.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2_000_000) throw new Error("원문 크기 상한 초과");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const text = plainText(Buffer.concat(chunks).toString("utf8"));
    if (!text) throw new Error("원문 본문 추출 실패");
    return text;
  }
  throw new Error("공식 자료 주소 이동 횟수 초과");
}
export async function searchSources(
  run: Run,
  _decision: Decision,
  signal: AbortSignal,
): Promise<SourceResult> {
  signal.throwIfAborted();
  if (run.mode === "fixture") {
    const result = fixtureSources();
    if (run.scenario === "unavailable")
      return {
        sources: result.sources.map((s) => ({
          ...s,
          status: "unavailable",
          snapshot: "",
          hash: sha(""),
        })),
        evidence: [],
      };
    return result;
  }
  const result: SourceResult = { sources: [], evidence: [] };
  for (const entry of CATALOG) {
    signal.throwIfAborted();
    let snapshot = "";
    let status: Source["status"] = "ok";
    try {
      snapshot = await fetchOfficialPage(entry.url, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      status = "unavailable";
    }
    result.sources.push({
      id: entry.id,
      url: entry.url,
      title: entry.title,
      publisher: "성남시 판교박물관",
      retrievedAt: new Date().toISOString(),
      status,
      snapshot,
      hash: sha(snapshot),
      license: "공식 원문 확인용. 이미지 재사용 권한 미확인.",
    });
    if (status === "ok")
      for (const q of entry.quotes) {
        const needle = q.quote.replace(/\s+/g, " ");
        const index = snapshot.indexOf(needle);
        if (index >= 0)
          result.evidence.push({
            ...q,
            sourceId: entry.id,
            locator: `수집 본문 문자 위치 ${index}–${index + needle.length}`,
          });
      }
  }
  return result;
}
