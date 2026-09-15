import * as THREE from 'three';
import { projectCityCoordinate } from './city-data';
import { URBAN_DATA, URBAN_LANDCOVER, isNamedBusiness, type LifeRoute, type UrbanCoordinate, type UrbanDataset, type UrbanLandcoverDataset, type UrbanTags } from './urban-data';

export const URBAN_HEIGHT_FALLBACK_METRES = 9;
export const URBAN_MAX_HEIGHT_METRES = 300;
/** These are illustrative widths only when OSM has no usable width or lanes. */
export const URBAN_ROAD_WIDTH_METRES: Readonly<Record<string, number>> = {
  motorway: 14, motorway_link: 7, trunk: 12, trunk_link: 7,
  primary: 10, primary_link: 6, secondary: 9, secondary_link: 6,
  tertiary: 7, tertiary_link: 5, residential: 6, unclassified: 6,
  living_street: 4, service: 4, pedestrian: 4, footway: 2,
  path: 1.5, cycleway: 2.5, steps: 2, track: 3, bridleway: 2,
};
const GROUND_Y = .02;
const CHUNK_SIZE = 30;
const denied = (value?: string) => value === 'no' || value === 'private';
const affirmative = (value?: string) => Boolean(value && !['no', 'false', '0'].includes(value));

function lengthMetres(value?: string): number | undefined {
  if (!value) return undefined;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(m|metres?|meters?|ft|feet|')?\s*$/i.exec(value);
  if (!match) return undefined;
  const amount = Number(match[1]) * (/^(ft|feet|')$/i.test(match[2] ?? '') ? .3048 : 1);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

export function getBuildingHeight(tags: UrbanTags): {
  heightMetres: number; baseMetres: number; source: 'height' | 'levels' | 'fallback'; clamped: boolean;
} {
  const height = lengthMetres(tags.height);
  const levels = lengthMetres(tags['building:levels']);
  const source = height !== undefined ? 'height' : levels !== undefined ? 'levels' : 'fallback';
  const original = height ?? (levels === undefined ? URBAN_HEIGHT_FALLBACK_METRES : levels * 3);
  const heightMetres = THREE.MathUtils.clamp(original, 1, URBAN_MAX_HEIGHT_METRES);
  const minHeight = lengthMetres(tags.min_height) ?? (lengthMetres(tags['building:min_level']) ?? 0) * 3;
  return { heightMetres, baseMetres: Math.min(minHeight, heightMetres - .5), source, clamped: original !== heightMetres };
}

export function getRoadStyle(tags: UrbanTags): {
  widthMetres: number; widthSource: 'width' | 'lanes' | 'fallback'; elevationMetres: number;
  pedestrian: boolean; vehicle: boolean; hidden: boolean; oneway: boolean; reverse: boolean;
} {
  const highway = tags.highway ?? 'road';
  const width = lengthMetres(tags.width);
  const lanes = /^\d+(?:\.\d+)?$/.test(tags.lanes ?? '') ? Number(tags.lanes) : 0;
  const laneWidth = lanes > 0 && lanes <= 12 ? lanes * 3 : undefined;
  const pedestrianOnly = ['footway', 'pedestrian', 'path', 'steps', 'cycleway', 'bridleway', 'platform', 'corridor'].includes(highway);
  const unavailable = ['construction', 'proposed', 'raceway'].includes(highway);
  const genericAccess = !denied(tags.access);
  const pedestrian = !unavailable && (tags.foot ? !denied(tags.foot) : genericAccess && !['motorway', 'motorway_link', 'trunk', 'trunk_link'].includes(highway));
  const motorAccess = tags.motor_vehicle ?? tags.vehicle;
  const vehicle = !unavailable && (motorAccess ? !denied(motorAccess) : genericAccess && !pedestrianOnly);
  const layer = Number(tags.layer ?? 0);
  const hidden = affirmative(tags.tunnel) || Number.isFinite(layer) && layer < 0;
  const elevationMetres = Math.min(5, Math.max(affirmative(tags.bridge) ? 1 : 0, Number.isFinite(layer) ? layer : 0)) * 4;
  return {
    widthMetres: THREE.MathUtils.clamp(width ?? laneWidth ?? URBAN_ROAD_WIDTH_METRES[highway] ?? 5, .8, 35),
    widthSource: width !== undefined ? 'width' : laneWidth !== undefined ? 'lanes' : 'fallback',
    elevationMetres, pedestrian, vehicle, hidden,
    oneway: tags.oneway === '-1' || ['yes', '1', 'true'].includes(tags.oneway) || tags.junction === 'roundabout' && tags.oneway !== 'no',
    reverse: tags.oneway === '-1',
  };
}

interface GeometryChunk { positions: number[]; normals: number[]; colors: number[]; indices: number[]; featureIds: Set<string> }
function chunkAt(chunks: Map<string, GeometryChunk>, x: number, z: number): GeometryChunk {
  const key = `${Math.floor(x / CHUNK_SIZE)}:${Math.floor(z / CHUNK_SIZE)}`;
  let chunk = chunks.get(key);
  if (!chunk) {
    chunk = { positions: [], normals: [], colors: [], indices: [], featureIds: new Set() };
    chunks.set(key, chunk);
  }
  return chunk;
}
function vertex(chunk: GeometryChunk, x: number, y: number, z: number, nx: number, ny: number, nz: number, color: THREE.Color): number {
  const index = chunk.positions.length / 3;
  chunk.positions.push(x, y, z);
  chunk.normals.push(nx, ny, nz);
  chunk.colors.push(color.r, color.g, color.b);
  return index;
}
function validCoordinate(point: UrbanCoordinate): boolean {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
}
function projectedRing(coordinates: readonly UrbanCoordinate[]): THREE.Vector2[] | undefined {
  if (coordinates.some(point => !validCoordinate(point))) return;
  const ring: THREE.Vector2[] = [];
  for (const coordinate of coordinates) {
    const [x, , z] = projectCityCoordinate(...coordinate);
    if (!ring.length || Math.hypot(x - ring.at(-1)!.x, z - ring.at(-1)!.y) > 1e-9) ring.push(new THREE.Vector2(x, z));
  }
  if (ring.length > 1 && ring[0].distanceTo(ring.at(-1)!) < 1e-9) ring.pop();
  return ring.length >= 3 && Math.abs(THREE.ShapeUtils.area(ring)) > 1e-10 ? ring : undefined;
}

export interface UrbanModelCounts {
  buildings: number; buildingPolygons: number; buildingHoles: number;
  estimatedHeights: number; clampedHeights: number;
  roads: number; roadSegments: number; hiddenRoads: number;
  poiMarkers: number; triangles: number; drawCalls: number;
  landcoverAreas: number; landcoverPolygons: number;
}
export interface UrbanModel {
  group: THREE.Group;
  routes: LifeRoute[];
  counts: UrbanModelCounts;
  dispose(): void;
}

/** Source footprints/centerlines, with disclosed height/width and appearance estimates. */
export function buildUrbanModel(
  data: UrbanDataset = URBAN_DATA,
  landcover: UrbanLandcoverDataset | undefined = data === URBAN_DATA ? URBAN_LANDCOVER : undefined,
): UrbanModel {
  const group = new THREE.Group();
  group.name = 'urban-source-geometry';
  group.userData = {
    attribution: data.metadata.attribution, license: data.metadata.license,
    sourceMetadata: data.metadata, sourceBuildings: data.buildings, sourceRoads: data.roads,
    sourceLandcover: landcover?.areas,
    landcoverMetadata: landcover?.metadata,
    heightFallbackMetres: URBAN_HEIGHT_FALLBACK_METRES,
    appearance: 'Illustrative materials; height and width fallbacks are not surveyed dimensions.',
  };
  const counts: UrbanModelCounts = { buildings: 0, buildingPolygons: 0, buildingHoles: 0, estimatedHeights: 0, clampedHeights: 0, roads: 0, roadSegments: 0, hiddenRoads: 0, poiMarkers: 0, triangles: 0, drawCalls: 0, landcoverAreas: 0, landcoverPolygons: 0 };
  const routes: LifeRoute[] = [];
  const buildingChunks = new Map<string, GeometryChunk>();
  const roadChunks = new Map<string, GeometryChunk>();
  const landcoverChunks = new Map<string, GeometryChunk>();
  const buildingColor = new THREE.Color('#c4bba7');
  const roofColor = new THREE.Color('#dfd8c8');
  const roadColor = new THREE.Color('#697274');
  const pathColor = new THREE.Color('#c0ad88');

  for (const area of landcover?.areas ?? []) {
    const water = area.tags.natural === 'water' || area.tags.waterway === 'riverbank' || ['reservoir', 'basin'].includes(area.tags.landuse);
    const forest = area.tags.natural === 'wood' || area.tags.landuse === 'forest';
    const grass = ['grass', 'meadow', 'village_green'].includes(area.tags.landuse) || ['grassland', 'heath', 'scrub'].includes(area.tags.natural);
    // Separate overlapping park/grass/wood/water surfaces by centimetres.
    const y = water ? .008 : forest ? .004 : grass ? .003 : .002;
    const color = new THREE.Color(water ? '#83b8bf' : forest ? '#90aa79' : grass ? '#b6c49a' : '#a6bc90');
    let rendered = false;
    for (const polygon of area.polygons) {
      const rings = polygon.map(projectedRing);
      if (!rings.length || rings.some(ring => !ring)) continue;
      const [outer, ...holes] = rings as THREE.Vector2[][];
      const faces = THREE.ShapeUtils.triangulateShape(outer, holes);
      if (!faces.length) continue;
      const chunk = chunkAt(landcoverChunks, outer[0].x, outer[0].y);
      chunk.featureIds.add(area.id);
      const points = [outer, ...holes].flat();
      const start = chunk.positions.length / 3;
      for (const point of points) vertex(chunk, point.x, y, point.y, 0, 1, 0, color);
      for (const [a, b, c] of faces) {
        const cross = (points[b].x - points[a].x) * (points[c].y - points[a].y) - (points[b].y - points[a].y) * (points[c].x - points[a].x);
        if (Math.abs(cross) > 1e-12) chunk.indices.push(start + a, start + (cross > 0 ? c : b), start + (cross > 0 ? b : c));
      }
      counts.landcoverPolygons++;
      rendered = true;
    }
    if (rendered) counts.landcoverAreas++;
  }

  for (const building of data.buildings) {
    if (building.tags.building === 'no' || building.tags.location === 'underground' || Number(building.tags.layer ?? 0) < 0) continue;
    const height = getBuildingHeight(building.tags);
    const top = GROUND_Y + height.heightMetres / 100;
    const bottom = GROUND_Y + height.baseMetres / 100;
    let rendered = false;
    for (const polygon of building.polygons) {
      const rings = polygon.map(projectedRing);
      if (!rings.length || rings.some(ring => !ring)) continue;
      const [outer, ...holes] = rings as THREE.Vector2[][];
      // Outer CCW and holes CW in east/south coordinates give outward side normals.
      if (THREE.ShapeUtils.isClockWise(outer)) outer.reverse();
      for (const hole of holes) if (!THREE.ShapeUtils.isClockWise(hole)) hole.reverse();
      const faces = THREE.ShapeUtils.triangulateShape(outer, holes);
      if (!faces.length) continue;
      const chunk = chunkAt(buildingChunks, outer[0].x, outer[0].y);
      chunk.featureIds.add(building.id);
      const points = [outer, ...holes].flat();
      const roofStart = chunk.positions.length / 3;
      for (const point of points) vertex(chunk, point.x, top, point.y, 0, 1, 0, roofColor);
      for (const [a, b, c] of faces) {
        const cross = (points[b].x - points[a].x) * (points[c].y - points[a].y) - (points[b].y - points[a].y) * (points[c].x - points[a].x);
        if (Math.abs(cross) < 1e-12) continue;
        // x/z CCW maps to -Y, so roof triangle winding is reversed.
        chunk.indices.push(roofStart + a, roofStart + (cross > 0 ? c : b), roofStart + (cross > 0 ? b : c));
      }
      for (const ring of [outer, ...holes]) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          const dx = b.x - a.x, dz = b.y - a.y, length = Math.hypot(dx, dz);
          const nx = dz / length, nz = -dx / length;
          const start = vertex(chunk, a.x, bottom, a.y, nx, 0, nz, buildingColor);
          vertex(chunk, b.x, bottom, b.y, nx, 0, nz, buildingColor);
          vertex(chunk, b.x, top, b.y, nx, 0, nz, buildingColor);
          vertex(chunk, a.x, top, a.y, nx, 0, nz, buildingColor);
          chunk.indices.push(start, start + 2, start + 1, start, start + 3, start + 2);
        }
      }
      counts.buildingPolygons++;
      counts.buildingHoles += holes.length;
      rendered = true;
    }
    if (rendered) {
      counts.buildings++;
      if (height.source !== 'height') counts.estimatedHeights++;
      if (height.clamped) counts.clampedHeights++;
    }
  }

  for (const road of data.roads) {
    const style = getRoadStyle(road.tags);
    if (style.hidden) { counts.hiddenRoads++; continue; }
    if (road.coordinates.some(point => !validCoordinate(point))) continue;
    const y = GROUND_Y + style.elevationMetres / 100;
    const points: [number, number, number][] = [];
    for (const coordinate of road.coordinates) {
      const [x, , z] = projectCityCoordinate(...coordinate);
      const previous = points.at(-1);
      if (!previous || Math.hypot(x - previous[0], z - previous[2]) > 1e-8) points.push([x, y, z]);
    }
    if (points.length < 2) continue;
    const width = style.widthMetres / 100;
    const half = width / 2;
    const offsets = points.map((point, index) => {
      const previous = points[Math.max(0, index - 1)], next = points[Math.min(points.length - 1, index + 1)];
      const before = index > 0 ? [point[0] - previous[0], point[2] - previous[2]] : [next[0] - point[0], next[2] - point[2]];
      const after = index + 1 < points.length ? [next[0] - point[0], next[2] - point[2]] : before;
      const aLength = Math.hypot(...before), bLength = Math.hypot(...after);
      const ax = -before[1] / aLength, az = before[0] / aLength;
      const bx = -after[1] / bLength, bz = after[0] / bLength;
      const length = Math.hypot(ax + bx, az + bz);
      if (length < 1e-5) return [ax * half, az * half];
      const nx = (ax + bx) / length, nz = (az + bz) / length;
      const miter = Math.min(half * 2, half / Math.max(.001, nx * bx + nz * bz));
      return [nx * miter, nz * miter];
    });
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const chunk = chunkAt(roadChunks, (a[0] + b[0]) / 2, (a[2] + b[2]) / 2);
      chunk.featureIds.add(`${road.id}:${road.segmentIndex}`);
      const color = style.vehicle ? roadColor : pathColor;
      const start = vertex(chunk, a[0] + offsets[i][0], y, a[2] + offsets[i][1], 0, 1, 0, color);
      vertex(chunk, a[0] - offsets[i][0], y, a[2] - offsets[i][1], 0, 1, 0, color);
      vertex(chunk, b[0] - offsets[i + 1][0], y, b[2] - offsets[i + 1][1], 0, 1, 0, color);
      vertex(chunk, b[0] + offsets[i + 1][0], y, b[2] + offsets[i + 1][1], 0, 1, 0, color);
      for (const [a, b, c] of [[start, start + 1, start + 2], [start, start + 2, start + 3]]) {
        const p = chunk.positions;
        const cross = (p[b * 3] - p[a * 3]) * (p[c * 3 + 2] - p[a * 3 + 2]) - (p[b * 3 + 2] - p[a * 3 + 2]) * (p[c * 3] - p[a * 3]);
        if (Math.abs(cross) > 1e-14) chunk.indices.push(a, cross > 0 ? c : b, cross > 0 ? b : c);
      }
      counts.roadSegments++;
    }
    routes.push({ id: `${road.id}:${road.segmentIndex}`, points: style.reverse ? points.reverse() : points, width, pedestrian: style.pedestrian, vehicle: style.vehicle, oneway: style.oneway, tags: road.tags });
    counts.roads++;
  }

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  for (const [kind, chunks] of [['landcover', landcoverChunks], ['buildings', buildingChunks], ['roads', roadChunks]] as const) {
    if (!chunks.size) continue;
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    materials.push(material);
    for (const [key, chunk] of chunks) {
      if (!chunk.indices.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(chunk.positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(chunk.normals, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(chunk.colors, 3));
      // Nearly collinear source vertices can change winding when converted to
      // Float32. Orient the actual GPU triangles against their stored normals.
      const positions = geometry.getAttribute('position').array;
      const normals = geometry.getAttribute('normal').array;
      let validIndices = 0;
      for (let i = 0; i < chunk.indices.length; i += 3) {
        const a = chunk.indices[i], b = chunk.indices[i + 1], c = chunk.indices[i + 2];
        const ux = positions[b * 3] - positions[a * 3], uy = positions[b * 3 + 1] - positions[a * 3 + 1], uz = positions[b * 3 + 2] - positions[a * 3 + 2];
        const vx = positions[c * 3] - positions[a * 3], vy = positions[c * 3 + 1] - positions[a * 3 + 1], vz = positions[c * 3 + 2] - positions[a * 3 + 2];
        const direction = (uy * vz - uz * vy) * normals[a * 3] + (uz * vx - ux * vz) * normals[a * 3 + 1] + (ux * vy - uy * vx) * normals[a * 3 + 2];
        if (!Number.isFinite(direction) || direction === 0) continue;
        chunk.indices[validIndices++] = a;
        chunk.indices[validIndices++] = direction > 0 ? b : c;
        chunk.indices[validIndices++] = direction > 0 ? c : b;
      }
      chunk.indices.length = validIndices;
      geometry.setIndex(chunk.indices);
      geometry.computeBoundingSphere();
      geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `urban-${kind}-${key}`;
      mesh.userData = { kind, source: 'OpenStreetMap', featureIds: [...chunk.featureIds] };
      mesh.castShadow = kind === 'buildings';
      mesh.receiveShadow = true;
      group.add(mesh);
      counts.triangles += chunk.indices.length / 3;
      counts.drawCalls++;
    }
  }

  const pois = data.pois.filter(poi => isNamedBusiness(poi) && validCoordinate(poi.coordinates));
  let markers: THREE.InstancedMesh | undefined;
  if (pois.length) {
    const geometry = new THREE.CylinderGeometry(.025, .025, .12, 5);
    const material = new THREE.MeshLambertMaterial({ color: '#b5653e' });
    geometries.push(geometry); materials.push(material);
    markers = new THREE.InstancedMesh(geometry, material, pois.length);
    markers.name = 'urban-business-markers';
    markers.userData = { kind: 'businesses', source: 'OpenStreetMap', featureIds: pois.map(poi => poi.id), positionSources: pois.map(poi => poi.positionSource) };
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < pois.length; i++) {
      const [x, , z] = projectCityCoordinate(...pois[i].coordinates);
      markers.setMatrixAt(i, matrix.makeTranslation(x, GROUND_Y + .06, z));
    }
    markers.instanceMatrix.needsUpdate = true;
    markers.computeBoundingSphere();
    group.add(markers);
    counts.poiMarkers = pois.length;
    counts.triangles += geometry.index!.count / 3 * pois.length;
    counts.drawCalls++;
  }

  let disposed = false;
  return { group, routes, counts, dispose() {
    if (disposed) return;
    disposed = true;
    markers?.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    group.clear();
  } };
}
