import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { buildUrbanModel, getBuildingHeight, getRoadStyle } from '@/lib/diorama/urban-model';
import { URBAN_DATA, findNearbyBusinesses, type UrbanCoordinate, type UrbanDataset, type UrbanPOI, type UrbanTags } from '@/lib/diorama/urban-data';

const coordinate = (x: number, z: number): UrbanCoordinate => [127.1115 + x / 884, 37.4041 - z / 1112];
const ring = (points: number[][]) => [...points, points[0]].map(([x, z]) => coordinate(x, z));
function dataset(): UrbanDataset {
  return { version: 1, metadata: { attribution: '© OpenStreetMap contributors', license: 'ODbL-1.0', cityRelationId: 2409180, bbox: [], counts: {} }, roads: [], buildings: [], pois: [] };
}
function meshes(group: THREE.Group): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  group.traverse(object => { if (object instanceof THREE.Mesh) result.push(object); });
  return result;
}
function sampleBuilding(tags: UrbanTags = { height: '20' }): UrbanDataset {
  return { ...dataset(), buildings: [{ id: 'way/1', tags, polygons: [[ring([[0, 0], [4, 0], [4, 4], [0, 4]]), ring([[1, 1], [1, 3], [3, 3], [3, 1]])]] }] };
}

describe('actual urban geometry', () => {
  it('preserves footprint and courtyard holes with upward roofs and outward walls', () => {
    const model = buildUrbanModel(sampleBuilding());
    try {
      model.group.updateMatrixWorld(true);
      const hit = (origin: number[], direction = [0, -1, 0]) => new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction)).intersectObject(model.group, true);
      expect(hit([.5, 10, .5])[0].point.y).toBeCloseTo(.22);
      expect(hit([2, 10, 2])).toHaveLength(0);
      expect(hit([4.5, 10, .5])).toHaveLength(0);
      expect(hit([-1, .1, 2], [1, 0, 0])[0].point.x).toBeCloseTo(0);
      expect(hit([2, .1, 2], [-1, 0, 0])[0].point.x).toBeCloseTo(1);
      for (const mesh of meshes(model.group)) {
        const geometry = mesh.geometry;
        const positions = geometry.getAttribute('position');
        const normals = geometry.getAttribute('normal');
        const indices = geometry.index!;
        for (let i = 0; i < indices.count; i += 3) {
          const a = new THREE.Vector3().fromBufferAttribute(positions, indices.getX(i));
          const b = new THREE.Vector3().fromBufferAttribute(positions, indices.getX(i + 1));
          const c = new THREE.Vector3().fromBufferAttribute(positions, indices.getX(i + 2));
          const normal = new THREE.Vector3().fromBufferAttribute(normals, indices.getX(i));
          expect(b.sub(a).cross(c.sub(a)).dot(normal)).toBeGreaterThan(0);
        }
      }
    } finally { model.dispose(); }
  });

  it('handles reversed rings and separate multipolygon islands without filling gaps', () => {
    const source = sampleBuilding();
    const model = buildUrbanModel({ ...source, buildings: [{ ...source.buildings[0], polygons: [source.buildings[0].polygons[0].map(points => [...points].reverse()), [ring([[8, 0], [9, 0], [9, 1], [8, 1]])]] }] });
    try {
      model.group.updateMatrixWorld(true);
      for (const [x, z, expected] of [[.5, .5, true], [2, 2, false], [6, 0, false], [8.5, .5, true]]) {
        expect(new THREE.Raycaster(new THREE.Vector3(Number(x), 10, Number(z)), new THREE.Vector3(0, -1, 0)).intersectObject(model.group, true).length > 0).toBe(expected);
      }
      expect(model.counts.buildingPolygons).toBe(2);
    } finally { model.dispose(); }
  });

  it('prefers tagged metres or feet, then levels, then disclosed fallback, with safe heights', () => {
    expect(getBuildingHeight({ height: '24', 'building:levels': '30' })).toMatchObject({ heightMetres: 24, source: 'height' });
    expect(getBuildingHeight({ height: '30 ft' }).heightMetres).toBeCloseTo(9.144);
    expect(getBuildingHeight({ height: 'unknown', 'building:levels': '5' })).toMatchObject({ heightMetres: 15, source: 'levels' });
    expect(getBuildingHeight({})).toMatchObject({ heightMetres: 9, source: 'fallback' });
    expect(getBuildingHeight({ height: '90000' })).toMatchObject({ heightMetres: 300, clamped: true });
    expect(getBuildingHeight({ height: '-9', 'building:levels': '0' })).toMatchObject({ heightMetres: 9, source: 'fallback' });
  });

  it('builds road ribbons at source positions with tagged widths and positive-facing triangles', () => {
    const model = buildUrbanModel({ ...dataset(), roads: [{ id: 'way/2', segmentIndex: 0, coordinates: [coordinate(0, 0), coordinate(10, 0), coordinate(10, 5)], tags: { highway: 'residential', width: '10' } }] });
    try {
      const road = meshes(model.group).find(mesh => mesh.userData.kind === 'roads')!;
      road.geometry.computeBoundingBox();
      expect(road.geometry.boundingBox!.min.z).toBeCloseTo(-.05);
      expect(road.geometry.boundingBox!.max.x).toBeCloseTo(10.05);
      expect(model.counts.roadSegments).toBe(2);
      expect(model.routes[0]).toMatchObject({ id: 'way/2:0', width: .1, vehicle: true, pedestrian: true });
      expect(model.routes[0].points[1]).toEqual([expect.closeTo(10), .02, expect.closeTo(0)]);
      model.group.updateMatrixWorld(true);
      expect(new THREE.Raycaster(new THREE.Vector3(5, 2, 0), new THREE.Vector3(0, -1, 0)).intersectObject(road).length).toBeGreaterThan(0);
    } finally { model.dispose(); }
  });

  it('preserves access, foot and vehicle restrictions and reverses negative one-way routes', () => {
    const tags: UrbanTags[] = [{ highway: 'footway' }, { highway: 'motorway' }, { highway: 'residential', access: 'no' }, { highway: 'residential', foot: 'no', oneway: '-1' }, { highway: 'residential', vehicle: 'no', foot: 'yes' }];
    const model = buildUrbanModel({ ...dataset(), roads: tags.map((tag, index) => ({ id: `way/${index}`, segmentIndex: 0, coordinates: [coordinate(0, index), coordinate(10, index)], tags: tag })) });
    try {
      expect(model.routes.map(route => [route.pedestrian, route.vehicle])).toEqual([[true, false], [false, true], [false, false], [false, true], [true, false]]);
      expect(model.routes[3].oneway).toBe(true);
      expect(model.routes[3].points[0][0]).toBeCloseTo(10);
      expect(model.routes[2].tags?.access).toBe('no');
    } finally { model.dispose(); }
  });

  it('omits hidden tunnels from both paint and routes while elevating bridges', () => {
    const model = buildUrbanModel({ ...dataset(), roads: ['yes', 'no'].map((tunnel, i) => ({ id: `way/${i}`, segmentIndex: 0, coordinates: [coordinate(0, i), coordinate(2, i)], tags: { highway: 'primary', tunnel, bridge: 'yes', layer: '2' } })) });
    try {
      expect(model.routes).toHaveLength(1);
      expect(model.routes[0].points[0][1]).toBeCloseTo(.1);
      expect(model.counts.hiddenRoads).toBe(1);
    } finally { model.dispose(); }
    expect(getRoadStyle({ highway: 'primary', layer: '-1' }).hidden).toBe(true);
  });

  it('bounds impossible road widths and uses lane/class estimates when width is unknown', () => {
    expect(getRoadStyle({ highway: 'primary', width: '90000' }).widthMetres).toBe(35);
    expect(getRoadStyle({ highway: 'residential', lanes: '2' }).widthMetres).toBe(6);
    expect(getRoadStyle({ highway: 'footway' }).widthMetres).toBe(2);
    expect(getRoadStyle({ highway: 'primary', width: 'NaN', lanes: '-8' }).widthMetres).toBe(10);
  });

  it('merges thousands of buildings into bounded chunks and disposes shared resources once', () => {
    const source = sampleBuilding();
    const model = buildUrbanModel({ ...dataset(), buildings: Array.from({ length: 1500 }, (_, i) => ({ ...source.buildings[0], id: `way/${i}` })) });
    const rendered = meshes(model.group);
    expect(rendered.length).toBeLessThan(10);
    expect(model.counts.buildings).toBe(1500);
    const geometries = [...new Set(rendered.map(mesh => mesh.geometry))];
    const materials = [...new Set(rendered.flatMap(mesh => Array.isArray(mesh.material) ? mesh.material : [mesh.material]))];
    const spies = [...geometries, ...materials].map(resource => vi.spyOn(resource, 'dispose'));
    model.dispose();
    model.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(model.group.children).toHaveLength(0);
  });

  it('skips degenerate/invalid coordinates without producing non-finite buffers', () => {
    const model = buildUrbanModel({ ...dataset(), roads: [{ id: 'way/1', segmentIndex: 0, coordinates: [coordinate(0, 0), coordinate(0, 0)], tags: { highway: 'residential' } }], buildings: [{ id: 'way/2', polygons: [[[coordinate(0, 0), [NaN, 37], coordinate(2, 2)]]], tags: {} }] });
    try {
      expect(model.counts.buildings).toBe(0);
      expect(model.counts.roadSegments).toBe(0);
      expect(model.routes).toHaveLength(0);
    } finally { model.dispose(); }
  });

  it('finds only named source businesses within a bounded real-coordinate radius', () => {
    const pois: UrbanPOI[] = [
      { id: 'node/1', coordinates: coordinate(1, 0), tags: { name: '가게', shop: 'convenience' }, positionSource: 'node' },
      { id: 'node/2', coordinates: coordinate(.5, 0), tags: { name: '카페', amenity: 'cafe' }, positionSource: 'node' },
      { id: 'node/3', coordinates: coordinate(0, 0), tags: { name: '공원', leisure: 'park' }, positionSource: 'node' },
    ];
    const nearby = findNearbyBusinesses(coordinate(0, 0), { radiusMetres: 80, pois });
    expect(nearby.map(poi => poi.id)).toEqual(['node/2']);
    expect(nearby[0].distanceMetres).toBeCloseTo(50);
  });

  it('fills actual mapped park and lake polygons, preserves islands, and keeps roads above water', () => {
    const square = ring([[0, 0], [4, 0], [4, 4], [0, 4]]);
    const island = ring([[1, 1], [1, 3], [3, 3], [3, 1]]);
    const model = buildUrbanModel(dataset(), { version: 1, metadata: dataset().metadata, areas: [
      { id: 'way/park', polygons: [[square]], tags: { leisure: 'park' } },
      { id: 'relation/lake', polygons: [[square, island]], tags: { natural: 'water' } },
    ] });
    try {
      model.group.updateMatrixWorld(true);
      const heightAt = (x: number, z: number) => new THREE.Raycaster(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0)).intersectObject(model.group, true)[0]?.point.y;
      expect(heightAt(.5, .5)).toBeCloseTo(.008);
      expect(heightAt(2, 2)).toBeCloseTo(.002);
      expect(heightAt(5, 5)).toBeUndefined();
      expect(model.counts.landcoverAreas).toBe(2);
      expect(model.counts.landcoverPolygons).toBe(2);
    } finally { model.dispose(); }
  });

  it('keeps the real city snapshot within merged draw and triangle budgets', () => {
    const model = buildUrbanModel(URBAN_DATA);
    try {
      expect(model.counts.buildings).toBeGreaterThan(32000);
      expect(model.counts.buildingHoles).toBe(29);
      expect(model.counts.roads).toBeGreaterThan(14000);
      expect(model.counts.hiddenRoads).toBeGreaterThan(0);
      expect(model.counts.drawCalls).toBeLessThanOrEqual(200);
      expect(model.counts.triangles).toBeLessThanOrEqual(2_000_000);
      expect(model.counts.poiMarkers).toBeGreaterThan(2000);
      expect(model.counts.landcoverAreas).toBeGreaterThan(900);
      expect(model.counts.landcoverPolygons).toBeGreaterThan(900);
      let inverted = 0;
      let degenerate = 0;
      for (const mesh of meshes(model.group)) {
        const positions = mesh.geometry.getAttribute('position');
        const normals = mesh.geometry.getAttribute('normal');
        const indices = mesh.geometry.index!;
        for (let i = 0; i < indices.count; i += 3) {
          const a = indices.getX(i), b = indices.getX(i + 1), c = indices.getX(i + 2);
          const ux = positions.getX(b) - positions.getX(a), uy = positions.getY(b) - positions.getY(a), uz = positions.getZ(b) - positions.getZ(a);
          const vx = positions.getX(c) - positions.getX(a), vy = positions.getY(c) - positions.getY(a), vz = positions.getZ(c) - positions.getZ(a);
          const direction = (uy * vz - uz * vy) * normals.getX(a) + (uz * vx - ux * vz) * normals.getY(a) + (ux * vy - uy * vx) * normals.getZ(a);
          if (direction < 0) inverted++;
          if (!Number.isFinite(direction) || direction === 0) degenerate++;
        }
      }
      expect(inverted).toBe(0);
      expect(degenerate).toBe(0);
      const markers = model.group.getObjectByName('urban-business-markers') as THREE.InstancedMesh;
      const dispose = vi.spyOn(markers, 'dispose');
      model.dispose();
      model.dispose();
      expect(dispose).toHaveBeenCalledTimes(1);
    } finally { model.dispose(); }
  });
});
