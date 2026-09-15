import { describe, expect, it } from "vitest";
import { createFixtureStory } from "../src/lib/fixture";
import { getPlace } from "../src/lib/places";
import { DEFAULT_BRIEF, newRun } from "../src/lib/run";
import { fixtureSources } from "../src/lib/sources";
import { evidenceIsValid, verifyContent } from "../src/lib/verifier";

function fixture(placeId: string) {
  const place = getPlace(placeId)!;
  const run = newRun({ mode: "fixture", brief: { ...DEFAULT_BRIEF, placeId, place: place.name } });
  Object.assign(run, fixtureSources(placeId), createFixtureStory(run));
  return run;
}

describe("grounded place references", () => {
  it.each([
    ["fixture", "title"], ["fixture", "body"], ["fixture", "script"],
    ["live", "title"], ["live", "body"], ["live", "script"],
  ] as const)("rejects another place's valid quote from a shared official page in %s %s", (mode, field) => {
    const run = fixture("seongnam-botanical-garden");
    run.mode = mode;
    const other = getPlace("seongnam-culture-house")!;
    const quote = other.officialQuotes![0].text;
    const source = run.sources[0];
    expect(source.url).toBe(other.officialQuotes![0].sourceUrl);
    source.snapshot += `\n${quote}`;
    const start = source.snapshot.lastIndexOf(quote);
    run.evidence.push({ id: "shared-page-other-place", sourceId: source.id, quote, start, end: start + quote.length, locator: "shared official page" });
    run.claims[0].text = quote;
    run.claims[0].evidenceIds = ["shared-page-other-place"];
    run.cards[0][field] = quote;
    expect(evidenceIsValid(run, "shared-page-other-place")).toBe(true);
    expect(verifyContent(run)).toContainEqual(expect.objectContaining({ targetId: "card-1", type: "place_mismatch" }));
  });

  it.each(["seohyeon-culture-house", "central-park"])("accepts %s address and related-site references from the selected official source", placeId => {
    expect(verifyContent(fixture(placeId))).toEqual([]);
  });

  it("accepts a related-site title grounded in that card's selected-place source", () => {
    const run = fixture("central-park");
    run.cards[1].title = "수내동가옥";
    expect(verifyContent(run)).toEqual([]);
  });

  it.each(["판교박물관 안내", "수내동가옥은 무료입니다"])("rejects the unsupported title %s even when a related name occurs in valid evidence", title => {
    const run = fixture("central-park");
    run.cards[1].title = title;
    expect(verifyContent(run)).toContainEqual(expect.objectContaining({ targetId: "card-2", type: "place_mismatch" }));
  });

  it("does not turn a street-name occurrence into a bare attraction title", () => {
    const run = fixture("seohyeon-culture-house");
    run.cards[1].title = "중앙공원";
    expect(verifyContent(run)).toContainEqual(expect.objectContaining({ targetId: "card-2", type: "place_mismatch" }));
  });

  it("does not let an address citation support a different attraction claim", () => {
    const run = fixture("seohyeon-culture-house");
    run.claims[1].text = "중앙공원은 무료입니다.";
    run.cards[1].body = run.cards[1].script = run.claims[1].text;
    expect(verifyContent(run)).toContainEqual(expect.objectContaining({ targetId: "card-2", type: "place_mismatch" }));
  });

  it.each(["uncited", "invalid", "wrong-source"])("rejects related-place wording with %s evidence", corruption => {
    const run = fixture("central-park");
    if (corruption === "uncited") run.claims[1].evidenceIds = [];
    if (corruption === "invalid") run.sources.forEach(source => { source.snapshot = "원문에 없는 내용"; });
    if (corruption === "wrong-source") run.sources.forEach(source => { source.url = getPlace("sunae-historic-house")!.sourceUrl; });
    expect(verifyContent(run)).toContainEqual(expect.objectContaining({ targetId: "card-2", type: "place_mismatch" }));
  });
});
