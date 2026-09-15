import { PLACES } from '../places';

/** IDs are checked against the source-verified catalog by normaliseDiorama. */
export type DioramaLandmarkId = string;
export type DioramaPlaceId = DioramaLandmarkId | 'seongnam';
export type Point3 = readonly [number, number, number];
export type CameraPreset = { position: Point3; target: Point3; zoom: number };
export type DioramaSelection = { placeId: DioramaPlaceId; hotspotId: string | null };
export type DioramaHotspot = { id: string; label: string; description: string; anchor: Point3; camera: CameraPreset };
export type DioramaDefinition = { placeId: DioramaPlaceId; theme: string; introduction: string; color: string; overview: CameraPreset; hotspots: readonly DioramaHotspot[]; modelNote: string };

export const DIORAMAS: readonly (DioramaDefinition & { placeId: 'pangyo-museum' | 'central-park' | 'moran-market' })[] = [
  {
    placeId: 'pangyo-museum', theme: '동네의 역사', color: '#6f817c',
    introduction: '익숙한 동네에서 오래된 시간을 만나요.',
    overview: { position: [30, 25, 35], target: [0, 2, 0], zoom: 1 },
    hotspots: [
      { id: 'museum-exterior', label: '박물관 외관', description: '판교박물관은 판교에서 발굴된 삼국시대 유적과 유물을 소개해요. 짙은 외벽과 목재 부분이 어우러진 외관을 살펴보세요.', anchor: [2, 5, 3.4], camera: { position: [19, 14, 29], target: [0, 3, 0], zoom: 1.55 } },
      { id: 'museum-garden', label: '건물과 나무', description: '실제 외관 사진에는 건물 앞의 나무와 녹지가 함께 담겨 있어요. 사진과 공개 지도에 등록된 주변 도로를 함께 살펴보세요.', anchor: [-9, 1.2, 6.5], camera: { position: [-25, 18, 27], target: [-5, 1, 2], zoom: 1.3 } },
    ],
    modelNote: '공개 지도에 등록된 건물 외곽과 도로를 보여줘요. 목재·외벽 등 외관의 세부 모습은 실제 사진에서 확인할 수 있어요.',
  },
  {
    placeId: 'central-park', theme: '숲과 물의 풍경', color: '#6a9270',
    introduction: '도시 안에서 잠시, 호수 곁으로.',
    overview: { position: [30, 28, 34], target: [0, 1, 0], zoom: 1 },
    hotspots: [
      { id: 'park-lake', label: '호수와 산책길', description: '중앙공원은 숲과 호수가 어우러진 도심 녹지공간이에요. 물가를 따라 이어지는 녹지의 모습을 살펴보세요.', anchor: [2, 0.3, 1], camera: { position: [28, 25, 26], target: [1, 0, 1], zoom: 1.35 } },
      { id: 'park-pavilion', label: '호수 곁 정자', description: '실제 사진에는 호수 곁 정자와 주변 풍경이 담겨 있어요. 공개 지도와 실제 사진을 함께 살펴보세요.', anchor: [-3.8, 3.5, -2.8], camera: { position: [-24, 17, 27], target: [-3.8, 1, -2.8], zoom: 1.7 } },
    ],
    modelNote: '공개 지도에 등록된 공원·물가와 산책로를 보여줘요. 지도에 없는 시설과 실제 외관은 사진·공식 안내에서 확인해 주세요.',
  },
  {
    placeId: 'moran-market', theme: '사람이 모이는 장터', color: '#b38c56',
    introduction: '좌판마다 이야기가 펼쳐지는 날.',
    overview: { position: [30, 27, 35], target: [0, 1, 0], zoom: 1 },
    hotspots: [
      { id: 'market-stalls', label: '곡물 좌판', description: '모란민속5일장은 다양한 물건과 사람들을 만나는 전통시장이에요. 곡물 좌판의 모습은 실제 사진에서 살펴볼 수 있어요.', anchor: [-5, 2.8, 3.5], camera: { position: [21, 17, 28], target: [-4, 1.5, 2], zoom: 1.6 } },
      { id: 'market-aisle', label: '장터 풍경', description: '지도에서 시장 주변 골목과 도로를 둘러보세요. 움직이는 사람과 차량은 분위기를 보여주는 표현이에요.', anchor: [0, 0.5, 3], camera: { position: [-24, 22, 27], target: [0, 1, 1], zoom: 1.3 } },
    ],
    modelNote: '공개 지도에 등록된 시장 주변 도로·건물·가게를 보여줘요. 장날 좌판과 방문객 수는 실제 현장을 재현한 정보가 아니에요.',
  },
];

export const CITY_LANDMARK_SCENES: readonly DioramaDefinition[] = [
  ...DIORAMAS,
  ...PLACES.filter(place => !DIORAMAS.some(scene => scene.placeId === place.id)).map((place): DioramaDefinition => ({
    placeId: place.id, theme: place.type, introduction: place.description, color: '#728f7b',
    overview: { position: [30, 25, 35], target: [0, 2, 0], zoom: 1 },
    hotspots: [{ id: `${place.id}-view`, label: '장소의 풍경', description: place.description, anchor: [0, 5, 0], camera: { position: [24, 20, 30], target: [0, 2, 0], zoom: 1.35 } }],
    modelNote: '명소의 대표 위치와 공개 지도의 건물 외곽·도로를 함께 보여줘요. 미등록 건물 높이와 도로 폭은 추정 표현이며 실제 외관·출입구는 공식 자료에서 확인해 주세요.',
  })),
];
const city: DioramaDefinition = {
  placeId: 'seongnam', theme: '성남 전체', introduction: `하나의 도시에서 만나는 ${PLACES.length}곳의 이야기.`, color: '#719179',
  overview: { position: [150, 180, 200], target: [0, 0, 0], zoom: 1 },
  hotspots: [
    { id: 'sujeong', label: '수정구', description: '도시 북쪽의 지역과 문화유산을 둘러보세요.', anchor: [0, 0, 0], camera: { position: [150, 180, 200], target: [0, 0, 0], zoom: 1.8 } },
    { id: 'jungwon', label: '중원구', description: '모란시장과 성남시청을 만나보세요.', anchor: [0, 0, 0], camera: { position: [150, 180, 200], target: [0, 0, 0], zoom: 2 } },
    { id: 'bundang', label: '분당구', description: '박물관에서 공원과 문화예술 공간까지 이어지는 풍경이에요.', anchor: [0, 0, 0], camera: { position: [150, 180, 200], target: [0, 0, 0], zoom: 1.6 } },
  ],
  modelNote: '공개 지도에 등록된 구 경계·도로·건물 외곽·가게 위치를 반영했어요. 미등록 높이와 도로 폭은 추정하며 사람·차량은 활기를 표현한 모형이에요.',
};

export function getDiorama(placeId: unknown): DioramaDefinition {
  return CITY_LANDMARK_SCENES.find(scene => scene.placeId === placeId) ?? city;
}

export function normaliseDiorama(value: unknown): DioramaSelection {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const scene = getDiorama(raw.placeId);
  return { placeId: scene.placeId, hotspotId: scene.hotspots.find(spot => spot.id === raw.hotspotId)?.id ?? null };
}

export function selectionStopId(selection: DioramaSelection): string {
  return `${selection.placeId}:${selection.hotspotId ?? 'overview'}`;
}

export function selectionFromStop(stopId: string | null): DioramaSelection {
  const [placeId, hotspotId] = (stopId ?? '').split(':');
  return normaliseDiorama({ placeId, hotspotId });
}

export const DIORAMA_STOPS = CITY_LANDMARK_SCENES.flatMap(scene => scene.hotspots.map(spot => `${scene.placeId}:${spot.id}`));
