import { describe, expect, it } from 'vitest';
import { getPlace, PLACES } from '../src/lib/places';
import expanded from '../src/lib/places-expanded.json';
import { CITY_LANDMARK_SCENES, DIORAMA_STOPS, selectionFromStop } from '../src/lib/diorama/data';

describe('expanded source-verified tourism catalog', () => {
  it('retains the original records and expands with distinct attractions', () => {
    expect(PLACES.slice(0, 8).map(place => place.id)).toEqual(['pangyo-museum', 'yuldong-park', 'central-park', 'seongnam-arts-center', 'moran-market', 'seongnam-city-hall', 'bongguksa', 'manggyeongam']);
    expect(PLACES.length).toBeGreaterThanOrEqual(52);
    expect(new Set(PLACES.map(place => place.id)).size).toBe(PLACES.length);
    expect(new Set(PLACES.map(place => place.name)).size).toBe(PLACES.length);
    for (const place of PLACES) expect(getPlace(place.name)?.id).toBe(place.id);
    expect(getPlace('forged-place')).toBeUndefined();
  });
  it('keeps unknown visitor facts empty and traces each new place and coordinate', () => {
    for (const place of expanded) {
      expect(place.name).not.toBe('');
      expect(place.description).not.toBe('');
      expect(place.address).toContain('성남');
      expect(new URL(place.sourceUrl).protocol).toBe('https:');
      expect(new URL(place.coordinateSourceUrl).protocol).toBe('https:');
      expect(place.verifiedAt).toBe('2026-09-15');
      expect(place.operatingHours).toBeNull();
      expect(place.closedDays).toBeNull();
      expect(place.admission).toBeNull();
      expect(place.photo).toBeNull();
      expect(place.officialQuotes.length, place.name).toBeGreaterThanOrEqual(3);
      expect(place.officialQuotes.every(quote => quote.text.trim() && new URL(quote.sourceUrl).protocol === 'https:')).toBe(true);
    }
  });
  it('exposes every verified place through the city and valid tour stops', () => {
    expect(CITY_LANDMARK_SCENES.map(scene => scene.placeId).sort()).toEqual(PLACES.map(place => place.id).sort());
    const visited = new Set(DIORAMA_STOPS.map(stop => selectionFromStop(stop).placeId));
    for (const place of PLACES) expect(visited.has(place.id), place.name).toBe(true);
  });
});
