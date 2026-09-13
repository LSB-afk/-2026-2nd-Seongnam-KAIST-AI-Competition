import type { Place } from "./places";
import type { CreationPurpose } from "./types";

export type { CreationPurpose } from "./types";

export const PURPOSES: readonly {
  id: CreationPurpose;
  label: string;
  description: string;
  audience: string;
}[] = [
  { id: "place_intro", label: "장소 소개", description: "장소의 특징과 이야기를 한눈에 소개해요.", audience: "성남 시민" },
  { id: "visit_guide", label: "방문 안내", description: "가족과 방문하기 전에 확인할 정보를 정리해요.", audience: "가족 관람객" },
  { id: "youth_story", label: "청소년 이야기", description: "호기심을 따라 장소를 탐험하는 이야기를 만들어요.", audience: "청소년" },
];

/** Defaults for the creation form; users can still edit their audience and goal. */
export function goalForPurpose(place: Place, purpose: CreationPurpose): string {
  const instructions: Record<CreationPurpose, string> = {
    place_intro: `성남 시민에게 ${place.name}을 소개하는 카드뉴스 4장을 만들어줘. 장소 소개, 주요 특징, 공식 자료의 배경 순으로 구성해줘.`,
    visit_guide: `가족 관람객이 ${place.name} 방문을 준비할 카드뉴스 4장을 만들어줘. 확인된 위치·볼거리·방문 전 확인할 정보를 우선해줘. 운영시간·휴무·요금이 미확인이거나 상충하면 임의로 채우지 말고 공식 안내 확인이 필요하다고 알려줘.`,
    youth_story: `청소년이 ${place.name}을 호기심을 가지고 탐험할 카드뉴스 4장을 만들어줘. 궁금증을 여는 이야기, 장소의 배경, 현장에서 발견할 특징 순으로 쉬운 문구와 질문을 사용해줘. 역사나 시설을 지어내지 마.`,
  };
  if (!Object.hasOwn(instructions, purpose)) throw new Error("등록되지 않은 제작 목적입니다.");
  return `${instructions[purpose]} 사실은 선택한 장소의 공식 근거로 확인하고 마지막 장에는 상상 장면임을 표시한 미래 문화공간의 가능성을 넣어줘.`;
}
