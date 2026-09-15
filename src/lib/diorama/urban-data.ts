import { projectCityCoordinate } from './city-data';

export type UrbanCoordinate = readonly [longitude: number, latitude: number];
export type UrbanTags = Readonly<Record<string, string>>;
export type UrbanRing = readonly UrbanCoordinate[];
export type UrbanPolygon = readonly UrbanRing[];
export interface UrbanRoad { id: string; segmentIndex: number; coordinates: readonly UrbanCoordinate[]; tags: UrbanTags }
export interface UrbanBuilding { id: string; polygons: readonly UrbanPolygon[]; tags: UrbanTags }
export interface UrbanPOI { id: string; coordinates: UrbanCoordinate; tags: UrbanTags; positionSource: string }
export interface UrbanMetadata {
  attribution: string;
  license: string;
  cityRelationId: number;
  bbox: readonly number[];
  counts: Readonly<Record<string, number | Readonly<Record<string, number>>>>;
  retrievedAt?: string;
  osmBaseTimestamp?: string;
  limitations?: readonly string[];
  inputs?: Readonly<Record<string, unknown>>;
  [key: string]: unknown;
}
export interface UrbanDataset {
  version: 1;
  metadata: UrbanMetadata;
  roads: readonly UrbanRoad[];
  buildings: readonly UrbanBuilding[];
  pois: readonly UrbanPOI[];
}
export interface UrbanLandcoverDataset {
  version: 1;
  metadata: UrbanMetadata;
  areas: readonly { id: string; polygons: readonly UrbanPolygon[]; tags: UrbanTags }[];
}
export interface LifeRoute {
  id: string;
  points: readonly (readonly [number, number, number])[];
  /** Model units: one unit is 100 metres. Points follow the permitted direction. */
  width: number;
  pedestrian: boolean;
  vehicle: boolean;
  oneway?: boolean;
  tags?: UrbanTags;
}

// Keep this snapshot in the lazy renderer graph. A typed require prevents
// TypeScript from inferring thousands of distinct raw OSM tag object shapes.
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const URBAN_DATA: UrbanDataset = require('./seongnam-urban.json');
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const URBAN_LANDCOVER: UrbanLandcoverDataset = require('./seongnam-landcover.json');

export function isNamedBusiness(poi: UrbanPOI): boolean {
  return Boolean((poi.tags.name || poi.tags['name:ko']) && (poi.tags.shop || poi.tags.amenity));
}
export const businessPOIs: readonly UrbanPOI[] = URBAN_DATA.pois.filter(isNamedBusiness);

/** Snapshot proximity, not opening status or a complete business inventory. */
export function findNearbyBusinesses(
  coordinates: UrbanCoordinate,
  options: { radiusMetres?: number; limit?: number; pois?: readonly UrbanPOI[] } = {},
): (UrbanPOI & { distanceMetres: number })[] {
  const [x, , z] = projectCityCoordinate(...coordinates);
  const radius = Math.max(0, options.radiusMetres ?? 500);
  const limit = Math.max(0, Math.min(100, Math.floor(options.limit ?? 12)));
  return (options.pois ?? businessPOIs).filter(isNamedBusiness).map(poi => {
    const [px, , pz] = projectCityCoordinate(...poi.coordinates);
    return { ...poi, distanceMetres: Math.hypot(px - x, pz - z) * 100 };
  }).filter(poi => poi.distanceMetres <= radius)
    .sort((a, b) => a.distanceMetres - b.distanceMetres || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export function urbanSourceUrl(feature: { id: string }): string {
  return `https://www.openstreetmap.org/${feature.id}`;
}
