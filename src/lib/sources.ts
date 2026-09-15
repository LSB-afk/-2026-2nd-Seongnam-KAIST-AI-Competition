import { createHash, randomUUID } from "node:crypto";
import { getPlace, PLACES } from "./places";
import type { Run, Decision, SourceResult, Source, SearchIntent, SearchRecord, Evidence } from "./types";

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
function normalizedUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.searchParams.sort();
  return url.href;
}
function registeredUrls(placeId: string): string[] {
  const place = getPlace(placeId);
  if (!place) throw new Error("등록되지 않은 관광지입니다.");
  return [...new Set([place.sourceUrl, ...(place.officialQuotes ?? []).map(quote => quote.sourceUrl)].map(normalizedUrl))];
}
export function assertOfficialUrl(value: string, placeId?: string): void {
  const u = new URL(value);
  const allowedPath = /^\/pangyo(?:\/|\/index\.do|\/contents\/content\.do)?$/.test(u.pathname);
  const allowedQuery: Record<string, RegExp> = {
    cIdx: /^\d+$/, fboard: /^board_[a-zA-Z0-9_]+$/, actionMode: /^view$/, b_num: /^\d+$/, page: /^\d+$/,
  };
  const museum = (!placeId || getPlace(placeId)?.id === "pangyo-museum") && u.hostname === "museum.seongnam.go.kr" && allowedPath
    && [...u.searchParams].every(([key, val]) => allowedQuery[key]?.test(val));
  const selected = placeId ? [getPlace(placeId)].filter(place => !!place) : PLACES;
  const registered = selected.some(place => registeredUrls(place.id).includes(normalizedUrl(value)));
  // Some city facilities publish HTTPS on a dedicated port. Only an exact
  // registered endpoint may use it; museum discovery still requires port 443.
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443" && !registered) || (!museum && !registered))
    throw new Error("선택한 관광지의 등록된 공식 HTTPS 읽기 전용 주소만 수집할 수 있습니다.");
}
function canonicalUrl(value: string, base?: string, placeId?: string): string {
  const url = normalizedUrl(new URL(decodeEntities(value), base).href);
  assertOfficialUrl(url, placeId);
  return url;
}
export function fixtureSources(placeId = "pangyo-museum"): SourceResult {
  const place = getPlace(placeId);
  if (!place) throw new Error("등록되지 않은 관광지입니다.");
  const catalog = place.id === "pangyo-museum" ? CATALOG : registeredUrls(place.id).map((url, index) => ({
    id: `source-${place.id}-${index + 1}`, url, title: `${place.name} 공식 관광 안내`,
    quotes: (place.officialQuotes ?? []).map((quote, quoteIndex) => ({ id: `evidence-${place.id}-${quoteIndex + 1}`, quote: quote.text, url: normalizedUrl(quote.sourceUrl) })).filter(quote => quote.url === url),
  })).filter(entry => entry.quotes.length > 0);
  const retrievedAt = place.id === "pangyo-museum" ? "2026-09-10T07:30:00.000Z" : `${place.verifiedAt.slice(0, 10)}T00:00:00.000Z`;
  const sources: Source[] = catalog.map((c) => ({
    id: c.id, url: c.url, title: c.title, publisher: `${place.name} 공식 안내`, retrievedAt,
    status: "ok", snapshot: c.quotes.map(q => q.quote).join("\n"), hash: sha(c.quotes.map(q => q.quote).join("\n")),
    license: "공식 원문 발췌를 검증용 fixture로 보관. 사진 이용 조건은 별도로 확인합니다.",
  }));
  return {
    sources,
    evidence: catalog.flatMap(c => c.quotes.map(q => {
      const start = sources.find(source => source.id === c.id)!.snapshot.indexOf(q.quote);
      return { id: q.id, quote: q.quote, sourceId: c.id, start, end: start + q.quote.length, locator: `공식 페이지 본문 발췌 (${retrievedAt.slice(0, 10)} 확인)` };
    })),
  };
}
function decodeEntities(value: string): string {
  return value.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, raw: string) => {
    const number = raw.toLowerCase().startsWith("x") ? parseInt(raw.slice(1), 16) : Number(raw);
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : "";
  }).replace(/&(nbsp|amp|lt|gt|quot|apos);/g, (_, name: string) => ({ nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[name]!);
}
function plainText(html: string): string {
  return decodeEntities(html.replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|nav|header|footer|form|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|section|h[1-6]|li|tr|article)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")).split("\n").map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}
// Find the matching closing tag so nested museum layout divs are not truncated.
function innerRegion(html: string, opening: RegExp): string | undefined {
  const match = opening.exec(html);
  if (!match) return undefined;
  const tag = /^<([a-z0-9]+)/i.exec(match[0])![1];
  const tags = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
  tags.lastIndex = match.index + match[0].length;
  let depth = 1;
  let token: RegExpExecArray | null;
  while ((token = tags.exec(html))) {
    if (token[0].startsWith("</")) depth--;
    else if (!token[0].endsWith("/>")) depth++;
    if (depth === 0) return html.slice(match.index + match[0].length, token.index);
  }
  return undefined;
}
function contentSnapshot(html: string): string {
  const safe = html.replace(/<(script|style|nav|header|footer|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const touristDescription = innerRegion(safe, /<[a-z0-9]+\b[^>]*class=["'][^"']*\btourist_con\b[^"']*["'][^>]*>/i);
  const touristDetails = innerRegion(safe, /<[a-z0-9]+\b[^>]*class=["'][^"']*\btouristInfo\b[^"']*["'][^>]*>/i);
  const region = innerRegion(safe, /<[a-z0-9]+\b[^>]*class=["'][^"']*\bcon_body\b[^"']*["'][^>]*>/i)
    ?? innerRegion(safe, /<[a-z0-9]+\b[^>]*class=["'][^"']*\bgrid-info\b[^"']*["'][^>]*>/i)
    ?? (touristDescription ? `${touristDetails ?? ""}\n${touristDescription}` : undefined)
    ?? innerRegion(safe, /<main\b[^>]*>/i)
    ?? innerRegion(safe, /<article\b[^>]*>/i)
    ?? innerRegion(safe, /<[a-z0-9]+\b[^>]*role=["']main["'][^>]*>/i);
  if (!region) throw new Error("원문 본문 영역 추출 실패 (오류·안내 페이지 가능)");
  const snapshot = plainText(region);
  if (snapshot.length < 8 || /^(?:페이지를 찾을 수|오류가 발생|접근이 거부|서비스 이용에 불편)/.test(snapshot)) throw new Error("유효한 공식 본문이 아닙니다.");
  return snapshot;
}

async function fetchDocument(url: string, signal: AbortSignal, placeId?: string): Promise<{ html: string; url: string }> {
  let current = canonicalUrl(url, undefined, placeId);
  for (let hop = 0; hop < 4; hop++) {
    signal.throwIfAborted();
    assertOfficialUrl(current, placeId);
    const response = await fetch(current, { redirect: "manual", signal, headers: { "user-agent": "SeongnamTimeStory/0.2 (official cultural content research)" } });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      await response.body?.cancel();
      if (!next) throw new Error("주소 이동 정보 없음");
      current = canonicalUrl(next, current, placeId);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`공식 자료 응답 오류 (${response.status})`); }
    if (!response.headers.get("content-type")?.includes("text/html")) { await response.body?.cancel(); throw new Error("HTML 원문이 아닙니다."); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("원문 응답이 비어 있습니다.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2_000_000) throw new Error("원문 크기 상한 초과");
        chunks.push(value);
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
    return { html: Buffer.concat(chunks).toString("utf8"), url: current };
  }
  throw new Error("공식 자료 주소 이동 횟수 초과");
}
export async function fetchOfficialPage(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetchDocument(url, AbortSignal.any([signal, AbortSignal.timeout(12000)]));
  return contentSnapshot(response.html);
}

function intentFor(run: Run, decision: Decision): SearchIntent {
  if (decision.search) return structuredClone(decision.search);
  const targetClaimIds = [...new Set(decision.targetIds.flatMap(id => {
    const card = run.cards.find(item => item.id === id);
    return card ? card.claimIds : [id];
  }))];
  const missingInformation = run.issues.filter(issue => !issue.resolved && (decision.targetIds.includes(issue.targetId) || targetClaimIds.includes(issue.targetId))).map(issue => issue.message);
  return { query: run.brief.goal, targetClaimIds, missingInformation, reason: decision.reasonSummary };
}
function searchTerms(intent: SearchIntent, run: Run): string[] {
  const claims = run.claims.filter(claim => intent.targetClaimIds.includes(claim.id)).map(claim => claim.text);
  const place = getPlace(run.brief.placeId ?? run.brief.place);
  const raw = [intent.query, ...intent.missingInformation, ...claims].join(" ").toLowerCase().replaceAll(place?.name.toLowerCase() ?? "", " ")
    .replace(/소개(?:할|하는|해줘|해주세요)?|상상(?:하는|할|해줘)?|넣어줘|\d+장/g, " ");
  const generic = /^(?:판교박물관|판교|박물관|성남|청소년|문화|문화유산|카드뉴스|카드|소개|홍보|자료|정보|근거|확인|검색|요청|부족|내용|실제|공식|만들어줘|만들어|포함|마지막|상상|미래|문화공간|이야기|장면|목표|설명|수정|기본|종합|전반|대해|관한|위한|장|장에는|있는|있습니다|합니다|주세요)$/;
  const terms = [...new Set((raw.match(/[가-힣a-z0-9]+/g) ?? []).map(term => term.replace(/(?:에게|에서|으로|까지|부터|에는|은|는|이|가|을|를|의|에)$/, "")).filter(term => term.length >= 2 && !generic.test(term)))];
  const groups = [["관람료", "입장료", "무료", "요금"], ["개관", "개원", "문을", "맞이"], ["전시", "석실분", "유물"], ["발굴", "조사"]];
  for (const group of groups) if (group.some(word => raw.includes(word))) terms.push(...group);
  return [...new Set(terms)];
}
function attributes(tag: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const match of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))
    values[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4]);
  return values;
}
function explicitDates(html: string): Pick<Source, "publishedAt" | "modifiedAt"> {
  const dates: Pick<Source, "publishedAt" | "modifiedAt"> = {};
  function assign(label: string, value?: string) {
    if (!value || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value) || !Number.isFinite(Date.parse(value))) return;
    if (value.length === 10 && new Date(value).toISOString().slice(0, 10) !== value) return;
    if (/^(?:article:published_time|datepublished|datecreated|dc.date.issued)$|발행|게시|등록/i.test(label)) dates.publishedAt ??= value;
    else if (/^(?:article:modified_time|datemodified|last-modified)$|수정|업데이트/i.test(label)) dates.modifiedAt ??= value;
  }
  const safe = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  for (const match of safe.matchAll(/<meta\b[^>]*>/gi)) {
    const attr = attributes(match[0]);
    assign(attr.property ?? attr.itemprop ?? attr.name ?? "", attr.content);
  }
  for (const match of safe.matchAll(/<time\b([^>]*)>([\s\S]*?)<\/time>/gi)) {
    const attr = attributes(match[1]);
    assign(attr.itemprop ?? plainText(match[2]), attr.datetime);
  }
  return dates;
}
const INSTRUCTION = /ignore\s+(?:all\s+)?(?:previous|prior)|system\s*prompt|api[ _-]?key|send.*secret|지시.{0,20}무시|시스템.{0,10}프롬프트|비밀.{0,10}키/i;
function matchingEvidence(source: Source, terms: string[], broad: boolean, search: SearchRecord): Evidence[] {
  const result: Evidence[] = [];
  const unique = new Set<string>();
  for (const match of source.snapshot.matchAll(/[^.!?。！？\n]+(?:[.!?。！？]+|$)/g)) {
    const quote = match[0].trim();
    if (quote.length < 12 || quote.length > 900 || INSTRUCTION.test(quote) || unique.has(quote) || (!broad && !terms.some(term => quote.toLowerCase().includes(term)))) continue;
    const start = match.index! + match[0].indexOf(quote);
    const end = start + quote.length;
    unique.add(quote);
    result.push({ id: `evidence-${sha(`${source.id}:${start}:${end}:${quote}`)}`, sourceId: source.id, quote, locator: `수집 본문 문자 위치 ${start}–${end}`, start, end, searchId: search.id, targetClaimIds: [...search.targetClaimIds] });
    if (result.length >= 16) break;
  }
  return result;
}
function linksFrom(html: string, base: string, terms: string[], placeId: string): { url: string; score: number }[] {
  const links: { url: string; score: number }[] = [];
  for (const link of html.matchAll(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = canonicalUrl(link[2], base, placeId);
      if (url === base) continue;
      const label = plainText(link[3]).toLowerCase();
      const score = terms.filter(term => label.includes(term)).length;
      links.push({ url, score });
    } catch { /* Non-content, external, login, booking and malformed links are not crawl targets. */ }
  }
  return links.sort((a, b) => b.score - a.score);
}
function additions(run: Run, result: SourceResult, search: SearchRecord): SourceResult {
  const existingSources = new Set(run.sources.map(source => `${source.url}|${source.hash}|${source.status}`));
  const sources = result.sources.filter(source => {
    const key = `${source.url}|${source.hash}|${source.status}`;
    if (existingSources.has(key)) return false;
    existingSources.add(key); return true;
  });
  const quoteKey = (quote: string) => quote.normalize("NFKC").replace(/\s+/g, " ").trim();
  const existingEvidence = new Set(run.evidence.map(evidence => quoteKey(evidence.quote)));
  const terms = searchTerms(search, run);
  const score = (evidence: Evidence) => terms.filter(term => evidence.quote.toLowerCase().includes(term)).length;
  const ranked = [...result.evidence].sort((a, b) => score(b) - score(a));
  const distinct = ranked.filter(item => {
    const key = quoteKey(item.quote);
    if (existingEvidence.has(key)) return false;
    existingEvidence.add(key); return true;
  });
  const evidence = distinct.slice(0, 32);
  if (distinct.length > evidence.length) search.errors.push(`검색 근거 상한 32개: 관련도 순으로 ${distinct.length - evidence.length}개 후보를 보류했습니다.`);
  search.newEvidenceCount = evidence.length;
  search.evidenceIds = evidence.map(item => item.id);
  return { sources, evidence, search };
}
export async function searchSources(run: Run, decision: Decision, signal: AbortSignal): Promise<SourceResult> {
  signal.throwIfAborted();
  const place = getPlace(run.brief.placeId ?? run.brief.place);
  if (!place) throw new Error("등록되지 않은 관광지입니다.");
  const intent = intentFor(run, decision);
  const search: SearchRecord = { ...intent, id: `search-${randomUUID()}`, at: new Date().toISOString(), version: run.version, visitedPages: 0, newEvidenceCount: 0, evidenceIds: [], resolvedClaimIds: [], remainingInformation: intent.missingInformation.length ? [...intent.missingInformation] : ["수집 자료가 요청을 뒷받침하는지 검수 필요"], errors: [] };
  if (run.mode === "fixture") {
    const captured = fixtureSources(place.id);
    const result = run.scenario === "unavailable" ? { sources: captured.sources.map(source => ({ ...source, status: "unavailable" as const, snapshot: "", hash: sha("") })), evidence: [] } : captured;
    if (run.scenario === "unavailable") search.errors.push("fixture: 공식 자료 접근 실패 시나리오");
    return additions(run, { sources: result.sources.map(source => ({ ...source, searchIds: [search.id] })), evidence: result.evidence.map(item => {
      const source = result.sources.find(source => source.id === item.sourceId)!;
      const start = source.snapshot.indexOf(item.quote);
      return { ...item, start, end: start + item.quote.length, searchId: search.id, targetClaimIds: [...intent.targetClaimIds] };
    }) }, search);
  }
  const elapsed = run.startedAt ? Math.max(run.usage.elapsedMs ?? 0, Date.now() - Date.parse(run.startedAt)) : run.usage.elapsedMs ?? 0;
  const remainingMs = Math.max(1, Math.min(12000, run.limits.maxDurationMs - elapsed));
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(remainingMs)]);
  const terms = searchTerms(intent, run);
  const broad = !intent.targetClaimIds.length && !intent.missingInformation.length && terms.length === 0;
  const seeds = place.id === "pangyo-museum" ? CATALOG.map(entry => entry.url) : registeredUrls(place.id);
  const queue = seeds.map(url => ({ url: canonicalUrl(url, undefined, place.id), depth: 0, score: 0 }));
  const visited = new Set<string>();
  const queued = new Set(queue.map(entry => entry.url));
  const result: SourceResult = { sources: [], evidence: [] };
  while (queue.length && visited.size < 8 && !bounded.aborted) {
    signal.throwIfAborted();
    const entry = queue.shift()!;
    if (visited.has(entry.url)) continue;
    visited.add(entry.url); search.visitedPages++;
    try {
      const page = await fetchDocument(entry.url, bounded, place.id);
      visited.add(page.url);
      const snapshot = contentSnapshot(page.html);
      const hash = sha(snapshot);
      const title = plainText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(page.html)?.[1] ?? `${place.name} 공식 자료`);
      const previous = [...run.sources, ...result.sources].find(source => source.url === page.url && source.hash === hash && source.status === "ok");
      const source: Source = { id: previous?.id ?? `source-${sha(`${page.url}:${hash}`)}`, url: page.url, title, publisher: `${place.name} 공식 안내`, retrievedAt: new Date().toISOString(), status: "ok", snapshot, hash, license: "공식 원문 확인용. 이미지 재사용 권한 미확인.", searchIds: [search.id], ...explicitDates(page.html) };
      result.sources.push(source);
      result.evidence.push(...matchingEvidence(source, terms, broad, search));
      if (entry.depth < 2) {
        for (const link of linksFrom(page.html, page.url, terms, place.id)) {
          if (!queued.has(link.url) && !visited.has(link.url)) { queued.add(link.url); queue.push({ ...link, depth: entry.depth + 1 }); }
        }
        queue.sort((a, b) => b.score - a.score || a.depth - b.depth);
      }
    } catch (error) {
      signal.throwIfAborted();
      search.errors.push(`${entry.url}: ${error instanceof Error ? error.message : "공식 자료 수집 실패"}`);
      result.sources.push({ id: `source-${sha(`${entry.url}:unavailable`)}`, url: entry.url, title: "공식 자료 수집 실패", publisher: `${place.name} 공식 안내`, retrievedAt: new Date().toISOString(), status: "unavailable", snapshot: "", hash: sha(""), license: "수집 실패", searchIds: [search.id] });
    }
  }
  signal.throwIfAborted();
  if (bounded.aborted) search.errors.push("검색 시간 상한에 도달했습니다. 수집된 자료만 검수에 전달합니다.");
  else if (queue.length) search.errors.push("검색 페이지/깊이 상한에 도달했습니다.");
  return additions(run, result, search);
}
