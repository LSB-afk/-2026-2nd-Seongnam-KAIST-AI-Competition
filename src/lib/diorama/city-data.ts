import { getPlace } from '../places';
import { CITY_LANDMARK_SCENES, getDiorama, type CameraPreset, type DioramaLandmarkId, type DioramaSelection, type Point3 } from './data';

/** Local east / up / south coordinates, ten model units per kilometre. */
export function projectCityCoordinate(longitude: number, latitude: number): Point3 {
  return [(longitude - 127.1115) * 88.4 * 10, 0, (37.4041 - latitude) * 111.2 * 10];
}

export type CityDistrictId = 'sujeong' | 'jungwon' | 'bundang';
export const CITY_DISTRICTS = [
  { id: 'sujeong', name: '수정구', color: '#4caf54', center: projectCityCoordinate(127.095, 37.452), zoom: 1.7, description: '북쪽의 동네와 산자락에서 오래된 문화유산을 만나요.' },
  { id: 'jungwon', name: '중원구', color: '#e09b24', center: projectCityCoordinate(127.158, 37.434), zoom: 2.4, description: '시장과 시민 공간이 모인 동네의 일상을 살펴요.' },
  { id: 'bundang', name: '분당구', color: '#3b8ee0', center: projectCityCoordinate(127.111, 37.382), zoom: 1.55, description: '탄천을 따라 박물관, 공원, 문화예술 공간을 둘러봐요.' },
] as const;

export const CITY_LANDMARKS = CITY_LANDMARK_SCENES.map(scene => {
  const place = getPlace(scene.placeId)!;
  return { placeId: scene.placeId as DioramaLandmarkId, name: place.name, district: place.district, position: projectCityCoordinate(place.lng, place.lat), scale: 1 };
});
export const CITY_OVERVIEW: CameraPreset = { position: [110, 250, 135], target: [0, 0, 0], zoom: 1 };
export function getCityCamera(selection: DioramaSelection): CameraPreset {
  if (selection.placeId === 'seongnam') {
    const district = CITY_DISTRICTS.find(item => item.id === selection.hotspotId);
    if (!district) return CITY_OVERVIEW;
    const [x, y, z] = district.center;
    return { position: [x + 145, y + 185, z + 195], target: district.center, zoom: district.zoom };
  }
  const landmark = CITY_LANDMARKS.find(item => item.placeId === selection.placeId)!;
  const definition = getDiorama(selection.placeId);
  const local = definition.hotspots.find(spot => spot.id === selection.hotspotId)?.camera ?? definition.overview;
  const transform = (point: Point3): Point3 => point.map((value, index) => landmark.position[index] + value * .012) as unknown as Point3;
  const target = transform(local.target);
  const direction = local.position.map((value, index) => value - local.target[index]);
  const length = Math.hypot(...direction);
  // Orthographic zoom controls apparent size. Keep the camera beyond the entire
  // city so its near plane does not slice streets/buildings in the foreground.
  const position = target.map((value, index) => value + direction[index] / length * 400) as unknown as Point3;
  return { position, target, zoom: 36 * local.zoom };
}
export type CityMarker = { id: string; label: string; point: Point3; selection: DioramaSelection; kind: 'district' | 'landmark' | 'hotspot' };
export function getCityMarkers(selection: DioramaSelection): CityMarker[] {
  const markers: CityMarker[] = CITY_LANDMARKS.map(item => ({ id: item.placeId, label: item.name, point: [item.position[0], .5, item.position[2]], selection: { placeId: item.placeId, hotspotId: null }, kind: 'landmark' }));
  if (selection.placeId === 'seongnam') return [...CITY_DISTRICTS.map((item): CityMarker => ({ id: item.id, label: item.name, point: [item.center[0], 1, item.center[2]], selection: { placeId: 'seongnam', hotspotId: item.id }, kind: 'district' })), ...markers];
  const landmark = CITY_LANDMARKS.find(item => item.placeId === selection.placeId)!;
  return [...getDiorama(selection.placeId).hotspots.map((spot): CityMarker => ({ id: spot.id, label: spot.label, point: spot.anchor.map((value, index) => landmark.position[index] + value * .012 + (index === 1 ? .5 : 0)) as unknown as Point3, selection: { placeId: selection.placeId, hotspotId: spot.id }, kind: 'hotspot' })), ...markers.filter(item => item.id !== selection.placeId)];
}
