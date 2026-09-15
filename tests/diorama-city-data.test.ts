import { describe, expect, it } from 'vitest';
import { CITY_DISTRICTS, CITY_LANDMARKS, CITY_OVERVIEW, getCityCamera, getCityMarkers, projectCityCoordinate } from '../src/lib/diorama/city-data';
import { CITY_LANDMARK_SCENES, DIORAMA_STOPS, normaliseDiorama, selectionFromStop, selectionStopId } from '../src/lib/diorama/data';
import boundaries from '../src/lib/diorama/seongnam-boundaries.json';
import river from '../src/lib/diorama/tancheon-course.json';
import { PLACES } from '../src/lib/places';
import { DEFAULT_BRIEF } from '../src/lib/run';
import { createWorkspace, decodeWorkspace, workspaceFromSearch, workspaceSearch, type DraftState } from '../src/lib/workspace-state';
import { getGuideAdvice } from '../src/lib/guide';

const draft: DraftState = { brief: DEFAULT_BRIEF, mode: 'fixture', strategy: 'agent', scenario: 'normal', imageChoice: 'photo' };
function inside(point: number[], ring: number[][]) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}

describe('one continuous Seongnam city', () => {
  it('opens the whole city by default and preserves legacy landmark links', () => {
    const initial = createWorkspace(draft);
    expect(initial.diorama).toEqual({ placeId: 'seongnam', hotspotId: null });
    expect(workspaceFromSearch(initial, '?view=diorama').diorama).toEqual(initial.diorama);
    expect(workspaceFromSearch(initial, '?view=diorama&scene=pangyo-museum&spot=museum-garden').diorama).toEqual({ placeId: 'pangyo-museum', hotspotId: 'museum-garden' });
  });
  it('roundtrips city, districts and every landmark through URL and saved workspace', () => {
    for (const selection of [{ placeId: 'seongnam', hotspotId: null }, ...CITY_DISTRICTS.map(d => ({ placeId: 'seongnam', hotspotId: d.id })), ...CITY_LANDMARK_SCENES.flatMap(s => [{ placeId: s.placeId, hotspotId: null }, ...s.hotspots.map(h => ({ placeId: s.placeId, hotspotId: h.id }))])]) {
      const state = { ...createWorkspace(draft), view: 'diorama' as const, diorama: normaliseDiorama(selection) };
      expect(workspaceFromSearch(createWorkspace(draft), workspaceSearch(state)).diorama).toEqual(selection);
      expect(decodeWorkspace(JSON.stringify(state), draft).diorama).toEqual(selection);
      expect(selectionFromStop(selectionStopId(state.diorama))).toEqual(selection);
    }
  });
  it('rejects cross-place and cross-level hotspots without changing valid places', () => {
    expect(normaliseDiorama({ placeId: 'seongnam', hotspotId: 'museum-garden' })).toEqual({ placeId: 'seongnam', hotspotId: null });
    expect(normaliseDiorama({ placeId: 'yuldong-park', hotspotId: 'sujeong' })).toEqual({ placeId: 'yuldong-park', hotspotId: null });
  });
  it('covers all source-verified places in their source districts', () => {
    expect(CITY_LANDMARKS.map(p => p.placeId).sort()).toEqual(PLACES.map(p => p.id).sort());
    for (const place of PLACES) {
      const boundary = boundaries.features.find(f => f.properties.name === place.district)!;
      expect(inside([place.lng, place.lat], boundary.geometry.coordinates[0]), place.name).toBe(true);
      expect(CITY_LANDMARKS.find(l => l.placeId === place.id)?.position).toEqual(projectCityCoordinate(place.lng, place.lat));
    }
  });
  it('preserves north/east orientation and realistic horizontal scale', () => {
    const origin = projectCityCoordinate(127.1115, 37.4041);
    expect(origin).toEqual([0, 0, 0]);
    expect(projectCityCoordinate(127.1215, 37.4141)[0]).toBeCloseTo(8.84);
    expect(projectCityCoordinate(127.1215, 37.4141)[2]).toBeCloseTo(-11.12);
    expect(CITY_LANDMARKS.find(p => p.placeId === 'bongguksa')!.position[2]).toBeLessThan(CITY_LANDMARKS.find(p => p.placeId === 'central-park')!.position[2]);
  });
  it('keeps regional boundaries closed and finite, and the river ordered south to north', () => {
    expect(boundaries.features.map(f => f.properties.name).sort()).toEqual(['분당구', '수정구', '중원구'].sort());
    for (const f of boundaries.features) {
      const ring = f.geometry.coordinates[0];
      expect(ring[0]).toEqual(ring.at(-1));
      expect(ring.flat().every(Number.isFinite)).toBe(true);
      expect(ring.length).toBeGreaterThan(80);
    }
    expect(river[0][1]).toBeLessThan(river.at(-1)![1]);
    expect(river.length).toBeGreaterThan(30);
    expect(boundaries.license).toBe('ODbL-1.0');
  });
  it('targets each landmark in the same world and derives local hotspot cameras from it', () => {
    expect(getCityCamera({ placeId: 'seongnam', hotspotId: null })).toEqual(CITY_OVERVIEW);
    for (const landmark of CITY_LANDMARKS) {
      const camera = getCityCamera({ placeId: landmark.placeId, hotspotId: null });
      expect(Math.hypot(camera.target[0] - landmark.position[0], camera.target[2] - landmark.position[2])).toBeLessThan(2);
      expect(camera.zoom).toBeGreaterThan(CITY_OVERVIEW.zoom);
      expect([...camera.position, ...camera.target, camera.zoom].every(Number.isFinite)).toBe(true);
    }
  });
  it('keeps the orthographic camera outside the city when focusing nearby landmarks', () => {
    for (const landmark of CITY_LANDMARKS) {
      const camera = getCityCamera({ placeId: landmark.placeId, hotspotId: null });
      // A close physical camera cuts the foreground at its near plane, even though
      // orthographic zoom can keep the landmark itself looking correctly sized.
      const distance = Math.hypot(...camera.position.map((value, i) => value - camera.target[i]));
      expect(distance, landmark.placeId).toBeGreaterThan(300);
    }
  });
  it('includes all landmarks at city scale and selected observation points nearby', () => {
    const city = getCityMarkers({ placeId: 'seongnam', hotspotId: null });
    expect(city.filter(m => m.kind === 'landmark')).toHaveLength(PLACES.length);
    expect(city.filter(m => m.kind === 'district')).toHaveLength(3);
    const selected = getCityMarkers({ placeId: 'central-park', hotspotId: 'park-pavilion' });
    expect(selected.filter(m => m.kind === 'hotspot').map(m => m.id)).toEqual(['park-lake', 'park-pavilion']);
    expect(new Set(selected.map(m => m.id)).size).toBe(selected.length);
  });
  it('tours valid landmark observation stops and excludes city/district headings', () => {
    expect(DIORAMA_STOPS).toHaveLength(PLACES.length + 3);
    expect(DIORAMA_STOPS.every(id => !id.startsWith('seongnam:') && selectionFromStop(id).hotspotId)).toBe(true);
  });
  it('gives city guidance without opening an unrelated creation draft', () => {
    const advice = getGuideAdvice({ view: 'diorama', selectedPlace: null, draftPlace: PLACES[0], run: null, busy: false, error: '', tab: 'evidence', selectedCardId: '' });
    expect(advice.title).toContain('성남 전체');
    expect(advice.body).toContain('수정구');
    expect(advice.action).toBeNull();
  });
});
