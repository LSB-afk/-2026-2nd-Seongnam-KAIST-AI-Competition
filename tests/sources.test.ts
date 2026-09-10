import { describe, expect, it } from "vitest";
import {
  assertOfficialUrl,
  fixtureSources,
  searchSources,
} from "../src/lib/sources";
import { newRun } from "../src/lib/run";

describe("official sources boundary", () => {
  it.each([
    "http://museum.seongnam.go.kr/pangyo",
    "https://127.0.0.1",
    "https://localhost",
    "https://museum.seongnam.go.kr.evil.com",
    "https://evil.com",
    "https://user:pass@museum.seongnam.go.kr/pangyo",
    "https://museum.seongnam.go.kr:8443/pangyo",
  ])("blocks unsafe URL %s", (url) =>
    expect(() => assertOfficialUrl(url)).toThrow(),
  );
  it("accepts only the exact public museum host over HTTPS", () =>
    expect(() =>
      assertOfficialUrl(
        "https://museum.seongnam.go.kr/pangyo/contents/content.do?cIdx=57",
      ),
    ).not.toThrow());
  it("keeps captured evidence linked to a real source and contains no AI inheritance assertion", () => {
    const result = fixtureSources();
    expect(
      result.evidence.find((e) => e.id === "evidence-opening")?.quote,
    ).toContain("2013년 4월 2일");
    for (const e of result.evidence)
      expect(
        result.sources.find((s) => s.id === e.sourceId)?.snapshot,
      ).toContain(e.quote);
    expect(
      result.evidence.some((e) => e.quote.includes("AI 산업으로 이어")),
    ).toBe(false);
  });
  it("represents failed retrieval as unavailable, never as proof of falsehood", async () => {
    const run = newRun({ mode: "fixture", scenario: "unavailable" });
    const result = await searchSources(
      run,
      {
        action: "search_sources",
        targetIds: [],
        evidenceIds: [],
        reasonSummary: "check",
        uncertainty: "",
      },
      new AbortController().signal,
    );
    expect(result.evidence).toHaveLength(0);
    expect(result.sources.every((s) => s.status === "unavailable")).toBe(true);
  });
});
