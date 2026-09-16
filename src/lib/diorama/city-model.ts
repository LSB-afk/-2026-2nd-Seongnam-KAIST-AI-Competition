import * as THREE from 'three';
import type { DioramaModel } from './models';
import { CITY_DISTRICTS, CITY_LANDMARKS, projectCityCoordinate } from './city-data';
import { getDiorama } from './data';
import boundaries from './seongnam-boundaries.json';
import tancheonCourse from './tancheon-course.json';
import { CityAssets, inRing, ribbon, type XZ } from './city-model-assets';
import { buildUrbanModel } from './urban-model';
import { buildCityLife } from './city-life';

const projected = (coordinate: readonly number[]): XZ => {
  const [x, , z] = projectCityCoordinate(coordinate[0], coordinate[1]);
  return [x, z];
};

/** A single city: source footprints and roads, geographic place markers and illustrative street life. */
export function buildCityModel(): DioramaModel {
  const assets = new CityAssets();
  const group = assets.group('seongnam-continuous-city');
  const pickTargets: THREE.Object3D[] = [];
  const districts = boundaries.features.map(feature => ({
    definition: CITY_DISTRICTS.find(district => district.name === feature.properties.name)!,
    rings: feature.geometry.coordinates.map(ring => ring.map(projected)),
  }));
  const contains = (x: number, z: number) => districts.some(({ rings }) => inRing(x, z, rings[0]) && !rings.slice(1).some(hole => inRing(x, z, hole)));
  for (const { definition, rings } of districts) {
    const land = assets.solid(group, `city-district-${definition.id}`, rings, 0, .7, '#c5d0b8');
    land.userData = { placeId: 'seongnam', hotspotId: definition.id, districtId: definition.id, labelAnchor: [...definition.center], source: 'OpenStreetMap district polygon' };
    land.castShadow = false;
    pickTargets.push(land);
  }
  // Only the recorded watercourse is retained; its unmeasured width is explicitly schematic.
  const river = assets.group('tancheon-river-corridor', group);
  const water = assets.surface(river, 'tancheon-water', ribbon(tancheonCourse.map(projected), .4, .006, contains), '#77b8c0');
  water.castShadow = false;
  river.userData.source = 'OpenStreetMap Tancheon centerline; illustrative 40 m width, no invented bridges';

  const urban = buildUrbanModel();
  group.add(urban.group);
  for (const { definition, rings } of districts) {
    const idle = assets.band(group, `city-district-edge-${definition.id}`, rings[0], .18, .024, definition.color, .92);
    const active = assets.band(group, `city-district-edge-active-${definition.id}`, rings[0], .38, .024, definition.color, 1);
    idle.renderOrder = 4;
    active.renderOrder = 10;
    idle.userData = { districtId: definition.id, source: 'OpenStreetMap district polygon edge' };
    active.userData = { districtId: definition.id, source: 'OpenStreetMap district polygon edge' };
    active.visible = false;
  }
  const life = buildCityLife(urban.routes, CITY_LANDMARKS.map(landmark => landmark.position));
  group.add(life.people, life.traffic);

  // Markers locate attractions without replacing source footprints with guessed architecture.
  for (const landmark of CITY_LANDMARKS) {
    const root = assets.group(`landmark-${landmark.placeId}`, group);
    root.position.set(...landmark.position);
    root.scale.setScalar(landmark.scale);
    const geometry = assets.geometry('landmark-location-marker', () => new THREE.CylinderGeometry(.13, .13, .012, 16));
    const marker = assets.mesh(root, 'landmark-location-marker', geometry, '#d8ae5f');
    marker.position.y = .015;
    marker.castShadow = false;
    marker.userData.symbolic = 'location marker, not a building footprint';
    root.userData = { placeId: landmark.placeId, hotspotId: getDiorama(landmark.placeId).hotspots[0].id, labelAnchor: [landmark.position[0], .5, landmark.position[2]] };
    marker.userData = { ...marker.userData, ...root.userData };
    pickTargets.push(root);
  }
  group.userData = {
    modelKind: 'continuous-seongnam-city', geographicSource: 'OpenStreetMap',
    ...urban.counts, districtCount: districts.length, landmarkCount: CITY_LANDMARKS.length,
    population: life.counts,
    schematic: ['missing building heights and road widths', 'flat terrain', 'river width', 'people and vehicles'],
  };
  group.updateMatrixWorld(true);
  let disposed = false;
  return {
    group, visitors: life.people, traffic: life.traffic, pickTargets,
    configurePopulation: options => life.configure(options),
    update: (elapsedSeconds, moving) => { if (!disposed) life.update(elapsedSeconds, moving); },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      life.dispose();
      urban.dispose();
      assets.dispose();
    },
  };
}
