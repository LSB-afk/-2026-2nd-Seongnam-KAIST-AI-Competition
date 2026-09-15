import { describe, expect, it } from 'vitest';
import { createUrbanDirectory, matchesDirectoryQuery, searchUrbanDirectory } from '../src/lib/diorama/urban-directory';

describe('public-map directory', () => {
  it('searches names, categories and addresses with normalized multiword queries', () => {
    expect(matchesDirectoryQuery(['ＣＵ 정자점', '편의점', '성남시 정자일로'], 'cu  정자')).toBe(true);
    expect(matchesDirectoryQuery(['정자 카페', '성남시'], '정자 분당구')).toBe(false);
  });
  it('preserves recorded coordinates, category, address and source without inventing missing addresses', () => {
    const entries = createUrbanDirectory({ pois: [
      { id: 'node/1', coordinates: [127.1, 37.4], tags: { name: 'Cafe', 'name:ko': '동네 카페', amenity: 'cafe', 'addr:street': '정자일로', 'addr:housenumber': '12' } },
      { id: 'way/2', coordinates: [127.11, 37.41], tags: { name: '작은 가게', shop: 'convenience' } },
    ], roads: [{ id: 'way/3', name: '정자일로', coordinates: [127.12, 37.42] }] });
    expect(entries[0]).toMatchObject({ name: '동네 카페', category: '카페', address: '정자일로 12', coordinates: [127.1, 37.4], sourceUrl: 'https://www.openstreetmap.org/node/1' });
    expect(entries[1].address).toBeNull();
    expect(entries[2]).toMatchObject({ kind: 'road', category: '도로', address: null });
  });
  it('rejects malformed sources, unnamed features and invalid coordinates', () => {
    const tags = { name: '가게' };
    expect(createUrbanDirectory({ pois: [
      { id: 'https://example.com', coordinates: [127, 37], tags },
      { id: 'node/1', coordinates: [NaN, 37], tags },
      { id: 'node/2', coordinates: [127, 91], tags },
      { id: 'node/3', coordinates: [127, 37], tags: {} },
    ], roads: [] })).toEqual([]);
  });
  it('caps nearby results at 20 and ranks against the selected map location', () => {
    const entries = createUrbanDirectory({ pois: Array.from({ length: 30 }, (_, i) => ({ id: `node/${i}`, coordinates: [127 + i * .001, 37.4] as const, tags: { name: `가게 ${i}`, shop: 'convenience' } })), roads: [] });
    const result = searchUrbanDirectory(entries, '편의점', entries[29].position, 100);
    expect(result.total).toBe(30);
    expect(result.entries).toHaveLength(20);
    expect(result.entries[0].id).toBe('node/29');
    expect(searchUrbanDirectory(entries, '없는 장소', entries[0].position).entries).toEqual([]);
  });
});
