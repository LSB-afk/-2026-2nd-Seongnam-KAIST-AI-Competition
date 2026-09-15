import { projectCityCoordinate } from './city-data';
import type { Point3 } from './data';

export type UrbanIndex = {
  metadata: { counts: { pois: number; namedShops: number; namedFoodVenues: number }; inputs: { pois: { osmBaseTimestamp: string } } };
  pois: { id: string; coordinates: readonly [number, number]; tags: Record<string, string> }[];
  roads: { id: string; name: string; coordinates: readonly [number, number] }[];
};
export type UrbanDirectoryEntry = {
  key: string;
  id: string;
  kind: 'poi' | 'road';
  name: string;
  category: string;
  address: string | null;
  coordinates: readonly [number, number];
  position: Point3;
  sourceUrl: string;
  searchFields: string[];
};

const CATEGORIES: Record<string, string> = {
  restaurant: '음식점', cafe: '카페', fast_food: '간편 음식', bar: '바', pub: '주점',
  convenience: '편의점', supermarket: '슈퍼마켓', bakery: '베이커리', clothes: '의류',
  pharmacy: '약국', hospital: '병원', clinic: '의원', bank: '은행', school: '학교',
  library: '도서관', community_centre: '주민 시설', place_of_worship: '종교 시설',
  museum: '박물관', hotel: '호텔', attraction: '관광 장소', park: '공원',
};

export function matchesDirectoryQuery(fields: readonly string[], query: string): boolean {
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ko-KR');
  const haystack = fields.map(normalize).join(' ');
  return normalize(query).trim().split(/\s+/).filter(Boolean).every(token => haystack.includes(token));
}

export function createUrbanDirectory(index: Pick<UrbanIndex, 'pois' | 'roads'>): UrbanDirectoryEntry[] {
  const entries: UrbanDirectoryEntry[] = [];
  function append(id: string, kind: 'poi' | 'road', name: string, coordinates: readonly [number, number], category: string, address: string | null, aliases: string[] = []) {
    if (!/^(node|way|relation)\/\d+$/.test(id) || !name.trim() || coordinates.length !== 2 || !coordinates.every(Number.isFinite)) return;
    if (Math.abs(coordinates[0]) > 180 || Math.abs(coordinates[1]) > 90) return;
    entries.push({ key: `${kind}:${id}`, id, kind, name, category, address, coordinates, position: projectCityCoordinate(...coordinates), sourceUrl: `https://www.openstreetmap.org/${id}`, searchFields: [name, category, address ?? '', ...aliases] });
  }
  for (const poi of index.pois) {
    const tags = poi.tags;
    const type = ['shop', 'amenity', 'tourism', 'leisure', 'historic'].find(key => tags[key]);
    const category = type ? CATEGORIES[tags[type]] ?? `${type === 'shop' ? '가게' : '지도 분류'} · ${tags[type]}` : '공개 지도 장소';
    const address = tags['addr:full'] || ['addr:city', 'addr:district', 'addr:street', 'addr:housenumber'].map(key => tags[key]).filter(Boolean).join(' ') || null;
    append(poi.id, 'poi', tags['name:ko'] || tags.name || '', poi.coordinates, category, address, [tags.name, tags['name:en'], tags.brand].filter(Boolean));
  }
  for (const road of index.roads) append(road.id, 'road', road.name, road.coordinates, '도로', null);
  return entries;
}

export function searchUrbanDirectory(entries: readonly UrbanDirectoryEntry[], query: string, center: Point3, limit = 20) {
  const matches = entries.filter(entry => matchesDirectoryQuery(entry.searchFields, query));
  const distance = (entry: UrbanDirectoryEntry) => (entry.position[0] - center[0]) ** 2 + (entry.position[2] - center[2]) ** 2;
  return {
    total: matches.length,
    entries: matches.sort((a, b) => distance(a) - distance(b) || a.name.localeCompare(b.name, 'ko') || a.key.localeCompare(b.key)).slice(0, Math.max(0, Math.min(20, limit))),
  };
}
