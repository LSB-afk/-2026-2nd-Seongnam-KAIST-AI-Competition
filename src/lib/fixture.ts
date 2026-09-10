import type { Card, Claim, Run } from "./types";

/** Deliberate, labelled test doubles. These templates are never used by live mode. */
export function createFixtureStory(run: Run): {
  cards: Card[];
  claims: Claim[];
} {
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
  const firstDraft = run.version === 0;
  if (
    (firstDraft && run.scenario === "causal") ||
    run.scenario === "persistent"
  ) {
    claims[2] = {
      ...claims[2],
      text: "이 문화유산의 기술이 오늘날 판교 AI 산업으로 이어졌다.",
      evidenceIds: ["evidence-excavation"],
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
      text: "판교박물관은 2015년에 개관했어요.",
      evidenceIds: ["evidence-exhibit"],
    };
  }
  const titles = [
    "판교의 시간을 만나볼까?",
    "돌방에 남은 이야기",
    "땅속에서 찾은 시간",
    "우리가 상상하는 다음 장",
  ];
  const layoutTargets = run.issues
    .filter((issue) => !issue.resolved && issue.type === "layout_overflow")
    .map((issue) => issue.targetId);
  const shorter = [
    "판교박물관은 2013년 4월 2일 개관했어요.",
    "백제·고구려 석실분과 판교 출토 유물 일부를 전시해요.",
    "2003~2008년 판교에서 발굴조사가 진행됐어요.",
    "상상 장면: 유물 이야기를 빛과 소리로 탐험한다면?",
  ];
  for (let i = 0; i < claims.length; i++)
    if (
      layoutTargets.includes("run") ||
      layoutTargets.includes(claims[i].cardId)
    ) {
      claims[i].text = shorter[i];
      titles[i] = ["판교의 시간", "돌방의 이야기", "발굴의 기록", "미래 상상"][
        i
      ];
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
