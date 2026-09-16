import type { Card, Claim, Evidence, Run } from "./types";
import { getPlace, type Place } from "./places";
import { fixtureSources } from "./sources";
import { fixtureEasyText } from "./reading-style";

const compact = (text: string) => text.replace(/[\s\p{P}\p{S}]/gu, "");
const ADDRESS_FRAGMENT = /^(?:경기도)?(?:성남시)?(?:수정구|중원구|분당구)?(?:[가-힣0-9]+[로길]\d+(?:번길\d+)?|[가-힣]{1,3}[동리](?:\d+(?:번지)?)?)?$/;

/** How well an official quote reads as card body text: 0 sentence-like, 1 other descriptive fragment, 2 only the place name or an address. */
export function quoteBodyRank(quote: string, place: Place): number {
  const text = compact(quote), name = compact(place.name), rest = text.replaceAll(name, "");
  if (!rest || name.includes(text) || compact(place.address).includes(rest) || ADDRESS_FRAGMENT.test(rest)) return 2;
  return /[다요][.!?。]?$/.test(quote.trim()) || rest.length >= 12 ? 0 : 1;
}
// Registered quotes include bare names and addresses. Bodies use them only after more descriptive quotes, keeping the original order within a rank.
function preferDescriptive(evidence: Evidence[], place: Place): Evidence[] {
  return [...evidence].sort((a, b) => quoteBodyRank(a.quote, place) - quoteBodyRank(b.quote, place));
}

/** Deliberate, labelled test doubles. These templates are never used by live mode. */
export function createFixtureStory(run: Run): {
  cards: Card[];
  claims: Claim[];
} {
  if (run.readingStyleChange?.status === "requested") {
    const targets = new Set(run.readingStyleChange.targetCardIds);
    return {
      cards: run.cards.map(card => targets.has(card.id)
        ? { ...structuredClone(card), title: fixtureEasyText(card.title), body: fixtureEasyText(card.body), script: fixtureEasyText(card.script) }
        : structuredClone(card)),
      claims: run.claims.map(claim => targets.has(claim.cardId)
        ? { ...structuredClone(claim), text: fixtureEasyText(claim.text), support: claim.kind === "fact" ? "insufficient" : claim.support }
        : structuredClone(claim)),
    };
  }
  if (run.brief.story) {
    const story = run.brief.story;
    const claims: Claim[] = [];
    const cards: Card[] = story.cardStopIds.map((stopId, index) => {
      const stop = story.stops.find(stop => stop.id === stopId)!;
      const place = getPlace(stop.placeId)!;
      const evidence = run.evidence.filter(item => run.sources.some(source => source.id === item.sourceId && source.placeId === place.id && source.status === "ok"));
      if (!evidence.length) throw new Error(`${place.name}의 공식 근거가 없습니다.`);
      const occurrence = story.cardStopIds.slice(0, index).filter(id => id === stopId).length;
      const item = preferDescriptive(evidence, place)[occurrence % evidence.length];
      const cardId = `card-${index + 1}`;
      const single = { ...run, cards: [], issues: [], brief: { ...run.brief, story: undefined, placeId: place.id, place: place.name } };
      let text = index === 3 ? createFixtureStory(single).cards[3].body : item.quote;
      if ((run.version === 0 && run.scenario === "causal" || run.scenario === "persistent") && index === 2) text = "이 장소의 기술이 오늘날 AI 산업으로 이어졌다.";
      if (run.version === 0 && run.scenario === "mismatch" && index === 0) text = `${place.name}은 2015년에 개관했어요.`;
      if (run.version === 0 && run.scenario === "future" && index === 3) text = "성남시는 미래 AI 문화공간 조성 사업을 확정했습니다.";
      if (run.brief.readingStyle === "easy") text = fixtureEasyText(text);
      const imagination = index === 3 && !(run.version === 0 && run.scenario === "future");
      const claim: Claim = { id: `claim-story-${index + 1}`, cardId, text, kind: imagination ? "imagination" : "fact", evidenceIds: index === 3 ? [] : [item.id], support: imagination ? "not_applicable" : "insufficient" };
      claims.push(claim);
      return { id: cardId, placeId: place.id, stopId, title: index === 3 ? "우리가 상상하는 다음 장" : `${place.name}의 이야기`, body: text, script: text, claimIds: [claim.id], imagination };
    });
    return { cards, claims };
  }
  const place = getPlace(run.brief.placeId ?? run.brief.place);
  if (!place) throw new Error("등록되지 않은 관광지입니다.");
  const museum = place.id === "pangyo-museum";
  const purpose = run.brief.purpose;
  const claims: Claim[] = [
    {
      id: "claim-opening",
      cardId: "card-1",
      text: "판교박물관은 2013년 4월 2일에 문을 열었어요.",
      kind: "fact",
      evidenceIds: ["evidence-opening"],
      support: "insufficient",
    },
    {
      id: "claim-exhibit",
      cardId: "card-2",
      text: "백제·고구려 시대 석실분과 판교 전역에서 출토된 유물 일부를 만날 수 있어요.",
      kind: "fact",
      evidenceIds: ["evidence-exhibit"],
      support: "insufficient",
    },
    {
      id: "claim-excavation",
      cardId: "card-3",
      text: "판교 지역에서는 2003년부터 2008년까지 발굴조사가 진행됐어요.",
      kind: "fact",
      evidenceIds: ["evidence-excavation"],
      support: "insufficient",
    },
    {
      id: "claim-future",
      cardId: "card-4",
      text: "상상 장면: 미래에는 내가 고른 유물 이야기를 빛과 소리로 탐험하는 문화공간이 생기면 어떨까요?",
      kind: "imagination",
      evidenceIds: [],
      support: "not_applicable",
    },
  ];
  if (!museum) {
    const evidence = preferDescriptive(fixtureSources(place.id).evidence, place).slice(0, 3);
    if (evidence.length < 3) throw new Error("장소별 fixture에는 확인된 공식 발췌 3개가 필요합니다.");
    claims.splice(0, 3, ...evidence.map((item, index): Claim => ({
      id: `claim-${place.id}-${index + 1}`, cardId: `card-${index + 1}`,
      text: item.quote, kind: "fact", evidenceIds: [item.id], support: "insufficient",
    })));
    claims[3].text = `상상 장면: ${place.name}에서 내가 고른 이야기를 빛과 소리로 만난다면 어떨까요?`;
  }
  const order = purpose === "visit_guide" ? (museum ? [1, 2, 0] : [2, 0, 1])
    : purpose === "youth_story" ? (museum ? [2, 0, 1] : [1, 0, 2]) : [0, 1, 2];
  if (purpose) {
    const facts = order.map((index, position) => ({ ...claims[index], cardId: `card-${position + 1}` }));
    claims.splice(0, 3, ...facts);
    claims[3].text = purpose === "place_intro"
      ? `상상 장면: ${place.name}의 이야기를 이웃과 함께 나누는 미래 문화공간은 어떤 모습일까요?`
      : purpose === "visit_guide"
        ? `상상 장면: 다음에는 ${place.name}의 이야기를 가족이 함께 빛과 소리로 탐험한다면 어떨까요?`
        : `상상 장면: ${place.name}에서 내가 고른 이야기를 따라 나만의 시간 탐험을 떠난다면 어떨까요?`;
  }
  const firstDraft = run.version === 0;
  if (
    (firstDraft && run.scenario === "causal") ||
    run.scenario === "persistent"
  ) {
    claims[2] = {
      ...claims[2],
      text: museum ? "이 문화유산의 기술이 오늘날 판교 AI 산업으로 이어졌다." : "이 장소의 기술이 오늘날 AI 산업으로 이어졌다.",
    };
  }
  if (firstDraft && run.scenario === "future") {
    claims[3] = {
      ...claims[3],
      text: "성남시는 미래 AI 문화공간 조성 사업을 확정했습니다.",
      kind: "fact",
      support: "insufficient",
    };
  }
  if (firstDraft && run.scenario === "mismatch") {
    claims[0] = {
      ...claims[0],
      text: museum ? "판교박물관은 2015년에 개관했어요." : `${place.name}은 2015년에 개관했어요.`,
      evidenceIds: claims[1].evidenceIds,
    };
  }
  const titles = purpose === "place_intro"
    ? [`${place.name}을 소개합니다`, "눈여겨볼 이야기", "공식 자료에서 한 걸음", "함께 그리는 다음 모습"]
    : purpose === "visit_guide"
      ? (museum ? ["방문 전에 살펴볼 전시", "알고 가면 좋은 발굴 기록", "개관 이야기", "다음 방문을 상상하며"] : ["찾아갈 장소", "가기 전에 읽는 소개", "현장에서 만나볼 이야기", "다음 방문을 상상하며"])
      : purpose === "youth_story"
        ? [`${place.name}, 탐험을 시작해 볼까?`, "시간을 따라 만나는 이야기", "내가 발견할 장면", "내가 상상하는 다음 장"]
        : museum ? [
    "판교의 시간을 만나볼까?",
    "돌방에 남은 이야기",
    "땅속에서 찾은 시간",
    "우리가 상상하는 다음 장",
  ] : [`${place.name}에 가볼까?`, "공식 안내에서 찾은 이야기", "어디에서 만날까?", "우리가 상상하는 다음 장"];
  const layoutTargets = run.issues
    .filter((issue) => !issue.resolved && issue.type === "layout_overflow")
    .map((issue) => issue.targetId);
  const museumShorter = [
    "판교박물관은 2013년 4월 2일 개관했어요.",
    "백제·고구려 석실분과 판교 출토 유물 일부를 전시해요.",
    "2003~2008년 판교에서 발굴조사가 진행됐어요.",
    "상상 장면: 유물 이야기를 빛과 소리로 탐험한다면?",
  ];
  const shorter = museum ? [...order.map(index => museumShorter[index]), purpose ? claims[3].text : museumShorter[3]] : claims.map(claim => claim.text);
  for (let i = 0; i < claims.length; i++)
    if (
      layoutTargets.includes("run") ||
      layoutTargets.includes(claims[i].cardId)
    ) {
      claims[i].text = shorter[i];
      titles[i] = (purpose ? [place.name, "공식 이야기", "장소의 기록", "미래 상상"] : museum ? ["판교의 시간", "돌방의 이야기", "발굴의 기록", "미래 상상"] : [place.name, "공식 안내", "방문 장소", "미래 상상"])[
        i
      ];
    }
  if (run.brief.readingStyle === "easy") {
    claims.forEach(claim => { claim.text = fixtureEasyText(claim.text); });
    titles.forEach((title, i) => { titles[i] = fixtureEasyText(title); });
  }
  const cards: Card[] = claims.map((claim, i) => ({
    id: claim.cardId,
    title: titles[i],
    body: claim.text,
    script: claim.text,
    claimIds: [claim.id],
    imagination: claim.kind === "imagination",
  }));
  if (run.cards.length && run.issues.length) {
    const targets = new Set(
      run.issues
        .filter((issue) => !issue.resolved)
        .map((issue) => issue.targetId),
    );
    const nextCards: Card[] = [];
    const nextClaims: Claim[] = [];
    for (const card of cards) {
      const old = run.cards.find((item) => item.id === card.id);
      const preserve =
        old &&
        !targets.has("run") &&
        !targets.has(old.id) &&
        !old.claimIds.some((claimId) => targets.has(claimId));
      nextCards.push(preserve ? structuredClone(old) : card);
      nextClaims.push(
        ...structuredClone(
          preserve
            ? run.claims.filter((claim) => claim.cardId === old.id)
            : claims.filter((claim) => claim.cardId === card.id),
        ),
      );
    }
    return { cards: nextCards, claims: nextClaims };
  }
  return { cards, claims };
}
