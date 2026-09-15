export interface CityFoodPlace {
  id: string;
  name: string;
  category: 'restaurant' | 'cafe' | 'bar';
  district: '수정구' | '중원구' | '분당구';
  address: string | null;
  neighborhood: string;
  lat: number | null;
  lng: number | null;
  description: string;
  badge: string;
  sourceUrl: string;
  /** Publication date of the cited source, not a live popularity measurement. */
  sourceDate: string | null;
  checkedAt: string;
  coordinateSourceUrl?: string;
}

const hipstoreSource = 'https://snvision.seongnam.go.kr/23223';
const neungRadoSource = 'https://korean.visitkorea.or.kr/detail/ms_detail.do?cotid=d03f9d19-4a08-4cdb-940b-39e9529bf41c';
const pyeongyangSource = 'https://korean.visitkorea.or.kr/detail/ms_detail.do?cotid=16c13ac2-e457-4247-9f2b-fe91855e5fe5';
const gammiokSource = 'https://korean.visitkorea.or.kr/detail/ms_detail.do?cotid=5a91855b-92df-403e-8f80-5e746dc6553d';

/** Selection and editorial evidence only. Opening status, ratings and queues are unknown. */
export const CITY_FOOD_PLACES: CityFoodPlace[] = [
  {
    id: 'cafe-the-mallang', name: '카페 더 말랑', category: 'cafe', district: '수정구',
    address: null, neighborhood: '신흥동', lat: null, lng: null,
    description: '쌀과 찹쌀을 활용한 디저트를 만드는 카페입니다.',
    badge: '2026 성남 힙스토어 선정', sourceUrl: hipstoreSource,
    sourceDate: '2026-08-26', checkedAt: '2026-09-15',
  },
  {
    id: 'deffee', name: '디피', category: 'cafe', district: '수정구',
    address: null, neighborhood: '태평동', lat: null, lng: null,
    description: '마당이 있는 공간에서 디저트와 커피를 즐기는 카페입니다.',
    badge: '2026 성남 힙스토어 선정', sourceUrl: hipstoreSource,
    sourceDate: '2026-08-26', checkedAt: '2026-09-15',
  },
  {
    id: 'yori-genius-house', name: '요리천재의집', category: 'restaurant', district: '수정구',
    address: null, neighborhood: '태평동', lat: null, lng: null,
    description: '집밥처럼 차려내는 한식집입니다. 2026년 8월 18일 현재 상호로 바뀌었습니다.',
    badge: '2026 성남 힙스토어 선정', sourceUrl: hipstoreSource,
    sourceDate: '2026-08-26', checkedAt: '2026-09-15',
  },
  {
    id: 'cafe-kimhyunmin', name: '카페 기면민', category: 'cafe', district: '중원구',
    address: null, neighborhood: '금광동', lat: null, lng: null,
    description: '주택 1층에 자리한 카페로 계절에 따른 케이크를 선보입니다.',
    badge: '2026 성남 힙스토어 선정', sourceUrl: hipstoreSource,
    sourceDate: '2026-08-26', checkedAt: '2026-09-15',
  },
  {
    id: 'neung-rado-main', name: '능라도본점', category: 'restaurant', district: '분당구',
    address: '경기도 성남시 분당구 산운로32번길 12 (운중동)', neighborhood: '운중동',
    lat: 37.3917353230314, lng: 127.06517010100617,
    description: '판교 운중동의 평양냉면 전문점으로 직접 제분한 면을 사용합니다.',
    badge: '한국관광공사 소개', sourceUrl: neungRadoSource,
    sourceDate: null, checkedAt: '2026-09-15', coordinateSourceUrl: neungRadoSource,
  },
  {
    id: 'pyeongyang-myeonok', name: '평양면옥', category: 'restaurant', district: '분당구',
    address: '경기도 성남시 분당구 안골로 27 (서현동)', neighborhood: '서현동',
    lat: 37.3852891926, lng: 127.1342841970,
    description: '서현동에 있는 평양냉면 전문점으로 장충동 본점에서 이어진 분점입니다.',
    badge: '한국관광공사 소개', sourceUrl: pyeongyangSource,
    sourceDate: null, checkedAt: '2026-09-15', coordinateSourceUrl: pyeongyangSource,
  },
  {
    id: 'gammiok-main', name: '감미옥 본점', category: 'restaurant', district: '분당구',
    address: '경기도 성남시 분당구 탄천로 181 (야탑동)', neighborhood: '야탑동',
    lat: 37.4088177985021, lng: 127.122824771204,
    description: '야탑동의 설렁탕 전문점으로 가마솥에 끓인 국물을 소개하고 있습니다.',
    badge: '한국관광공사 소개', sourceUrl: gammiokSource,
    sourceDate: null, checkedAt: '2026-09-15', coordinateSourceUrl: gammiokSource,
  },
  {
    id: 'perleo', name: '페르레오', category: 'bar', district: '분당구',
    address: '경기도 성남시 분당구 성남대로171번길 17 (금곡동) 씨티밸리 111호', neighborhood: '금곡동',
    lat: null, lng: null,
    description: '한 명의 셰프가 오픈키친에서 여러 나라의 요리를 선보이는 다이닝바입니다.',
    badge: '블루리본 Pick', sourceUrl: 'https://www.bluer.co.kr/restaurants/43427',
    sourceDate: null, checkedAt: '2026-09-15',
  },
];

/** Straight-line WGS84 distance; no walking route or travel-time claim. */
export function nearbyCityFood(
  place: { lat: number; lng: number },
  radiusMeters = 3000,
): { food: CityFoodPlace; distanceMeters: number }[] {
  if (!Number.isFinite(place.lat) || Math.abs(place.lat) > 90
    || !Number.isFinite(place.lng) || Math.abs(place.lng) > 180
    || !Number.isFinite(radiusMeters) || radiusMeters < 0) return [];

  const radians = Math.PI / 180;
  return CITY_FOOD_PLACES.flatMap(food => {
    if (food.lat === null || food.lng === null || !Number.isFinite(food.lat) || !Number.isFinite(food.lng)
      || Math.abs(food.lat) > 90 || Math.abs(food.lng) > 180) return [];
    const dLat = (food.lat - place.lat) * radians;
    const dLng = (food.lng - place.lng) * radians;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(place.lat * radians) * Math.cos(food.lat * radians) * Math.sin(dLng / 2) ** 2;
    const distanceMeters = 2 * 6371000 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
    return distanceMeters <= radiusMeters ? [{ food, distanceMeters }] : [];
  }).sort((a, b) => a.distanceMeters - b.distanceMeters);
}
