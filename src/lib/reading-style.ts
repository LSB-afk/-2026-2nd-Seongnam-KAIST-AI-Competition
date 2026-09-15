import { cardPlace } from "./run";
import type { Card, Claim, Run } from "./types";

/** Prepared demo vocabulary only; this is not a natural-language model. */
export function fixtureEasyText(text: string): string {
  const prepared: Record<string, string> = {
    "율동공원은 원래의 자연을 최대한 살려 조성한 자연호수 공원으로 호수와 잔디밭·야산 등 경치가 아름답습니다.": "율동공원은 원래의 자연을 최대한 살려 만든 자연호수 공원이에요. 호수와 잔디밭·야산 등 경치가 아름다워요.",
    "망경암은 서울이 한눈에 내려다볼 수 있는 사찰이다.": "망경암은 서울을 한눈에 내려다볼 수 있는 사찰(절)이에요.",
  };
  if (prepared[text]) return prepared[text];
  if (text.startsWith("상상 장면:")) {
    text = text
      .replace(/만난다면/g, "만나면")
      .replace(/탐험한다면/g, "탐험하면")
      .replace(/떠난다면/g, "떠나면")
      .replace(/이웃과 함께 나누는 미래 문화공간은 어떤 모습일까요\?$/, "이웃과 나누는 미래 문화공간을 상상해 봐요.");
  }
  return text
    .replace(/석실분(?!\()/g, "석실분(돌로 방을 만든 무덤)")
    .replace(/발굴조사(?!\()/g, "발굴조사(땅속 유물·유적을 찾는 조사)")
    .replace(/출토된/g, "땅에서 나온")
    .replace(/있습니다\./g, "있어요.")
    .replace(/입니다\./g, "이에요.");
}

/** Fail closed on structural/visible fact loss; live mode also compares meaning in independent review. */
export function assertReadingStyleUpdate(run: Run, story: { cards: Card[]; claims: Claim[] }): void {
  const change = run.readingStyleChange;
  if (change?.status !== "requested") return;
  const numbers = (text: string) => (text.match(/\d+(?:[.,]\d+)?(?:\s*(?:년|월|일|시|분|초|원|명|개|km|m|평|%|층|장|세))?/g) ?? []).map(value => value.replace(/\s/g, ""));
  const qualifiers = (text: string) => text.match(/일부|이상|이하|미만|초과|까지|부터|제외|매주|매월|무료|유료|휴관|휴무|예약|사전|경우|한해|아니|않|없/g) ?? [];
  const requiredNames = (text: string, placeName: string) => [placeName, "백제", "고구려", "판교", "성남"].filter(name => text.includes(name));
  const retains = (before: string, after: string, placeName: string) =>
    JSON.stringify(numbers(before)) === JSON.stringify(numbers(after)) &&
    qualifiers(before).every(term => qualifiers(after).filter(value => value === term).length >= qualifiers(before).filter(value => value === term).length) &&
    requiredNames(before, placeName).every(name => after.includes(name));
  for (const cardId of change.targetCardIds) {
    const placeName = run.brief.story ? cardPlace(run, cardId).name : run.brief.place;
    const before = run.cards.find(card => card.id === cardId)!;
    const after = story.cards.find(card => card.id === cardId);
    if (!after || after.imagination !== before.imagination || JSON.stringify(after.claimIds) !== JSON.stringify(before.claimIds))
      throw new Error("쉬운 설명 변경에서 카드·문장 순서와 상상 표시를 보존해야 합니다.");
    const prior = run.claims.filter(claim => claim.cardId === cardId);
    const incoming = story.claims.filter(claim => claim.cardId === cardId);
    if (prior.length !== incoming.length || new Set(incoming.map(claim => claim.id)).size !== incoming.length)
      throw new Error("쉬운 설명 변경에서 기존 사실 문장을 추가하거나 삭제할 수 없습니다.");
    for (const claim of prior) {
      const next = incoming.find(candidate => candidate.id === claim.id);
      if (!next || next.kind !== claim.kind || JSON.stringify(next.evidenceIds) !== JSON.stringify(claim.evidenceIds) || !retains(claim.text, next.text, placeName))
        throw new Error("쉬운 설명 변경에서 기존 날짜·수치·장소·조건·근거를 보존하지 못했습니다. 기존 문구를 유지합니다.");
    }
    for (const field of ["title", "body", "script"] as const) {
      if (!retains(before[field], after[field], placeName))
        throw new Error("쉬운 설명 변경에서 제목·본문·대본의 날짜·수치·장소·조건을 보존하지 못했습니다. 기존 문구를 유지합니다.");
    }
  }
}
