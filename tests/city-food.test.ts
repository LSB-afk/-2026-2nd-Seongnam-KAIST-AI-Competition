import { describe, expect, it } from 'vitest';
import { CITY_FOOD_PLACES, nearbyCityFood } from '../src/lib/city-food';

const origin = { lat: 37.4088177985021, lng: 127.122824771204 };

describe('curated food proximity', () => {
  it('includes the origin at zero radius and measures meters rather than degrees', () => {
    const [match] = nearbyCityFood(origin, 0);
    expect(match.food.id).toBe('gammiok-main');
    expect(match.distanceMeters).toBe(0);
    expect(nearbyCityFood({ lat: origin.lat + 0.01, lng: origin.lng }, 1100)).toEqual([]);
    const [north] = nearbyCityFood({ lat: origin.lat + 0.01, lng: origin.lng }, 1120);
    expect(north.food.id).toBe('gammiok-main');
    expect(north.distanceMeters).toBeCloseTo(1111.95, 1);
  });

  it('sorts located venues by distance and never places unknown coordinates at zero', () => {
    const matches = nearbyCityFood(origin, 20000);
    expect(matches.map(({ food }) => food.id)).toEqual(['gammiok-main', 'pyeongyang-myeonok', 'neung-rado-main']);
    expect(matches.every(({ food }) => food.lat !== null && food.lng !== null && Boolean(food.coordinateSourceUrl))).toBe(true);
    expect(CITY_FOOD_PLACES.filter(food => food.lat === null)).toHaveLength(5);
    expect(nearbyCityFood(origin).every(({ distanceMeters }) => distanceMeters <= 3000)).toBe(true);
  });

  it('returns no proximity claims for invalid coordinates or radius', () => {
    for (const place of [{ lat: NaN, lng: 127 }, { lat: 91, lng: 127 }, { lat: 37, lng: 181 }]) {
      expect(nearbyCityFood(place)).toEqual([]);
    }
    for (const radius of [-1, NaN, Infinity]) expect(nearbyCityFood(origin, radius)).toEqual([]);
  });
});
