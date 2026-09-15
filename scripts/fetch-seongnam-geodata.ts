/**
 * Prepare a static, ODbL Seongnam urban extract; never called by the application.
 * Run: node --import tsx scripts/fetch-seongnam-geodata.ts [--offline|--self-test|--landcover]
 * Cached raw responses and queries make offline rebuilds reproducible.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

type Coordinate = [number, number];
type Ring = Coordinate[];
type Polygon = Ring[];
type Tags = Record<string, string>;
type Member = { type: string; ref: number; role: string; geometry?: { lon: number; lat: number }[] };
type Element = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  geometry?: { lon: number; lat: number }[];
  members?: Member[];
  tags?: Tags;
};
type Response = { elements: Element[]; osm3s: { timestamp_osm_base: string }; remark?: string };
type Road = { id: string; segmentIndex: number; coordinates: Coordinate[]; tags: Tags };
type Building = { id: string; polygons: Polygon[]; tags: Tags };
type Poi = { id: string; coordinates: Coordinate; positionSource: "node" | "interior-point" | "geometry-point"; tags: Tags };
type Exclusion = { id: string; category: "building" | "road" | "poi"; reason: string };

const ARTIFACTS = path.resolve("outputs/seongnam-living-city-development");
const OUTPUT = path.resolve("src/lib/diorama/seongnam-urban.json");
const INDEX_OUTPUT = path.resolve("src/lib/diorama/seongnam-urban-index.json");
const LANDCOVER_OUTPUT = path.resolve("src/lib/diorama/seongnam-landcover.json");
const BBOX = [127.0270715, 37.3333872, 127.1959614, 37.4748116];
const BOX_QUERY = `${BBOX[1]},${BBOX[0]},${BBOX[3]},${BBOX[2]}`;
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const EPS = 1e-10;
const queryHeader = `[out:json][timeout:90][bbox:${BOX_QUERY}];`;
const landcoverSelection = '(wr[natural~"^(water|wood)$"];wr[landuse~"^(forest|grass|recreation_ground)$"];wr[leisure~"^(park|garden|nature_reserve)$"];wr[waterway=riverbank];);';
const queries = {
  boundary: "[out:json][timeout:40];relation(2409180);out geom;",
  roads: `${queryHeader}way[highway];out geom;`,
  buildings: `${queryHeader}wr[building][building!=no];out geom;`,
  pois: `[out:json][timeout:30][bbox:${BOX_QUERY}];nwr[name][~"^(shop|amenity|tourism|leisure|historic)$"~"."];out geom;`,
  "landcover-counts": `[out:json][timeout:30][bbox:${BOX_QUERY}];${landcoverSelection}out count;`,
  landcover: `[out:json][timeout:40][bbox:${BOX_QUERY}];${landcoverSelection}out geom;`,
};

const same = (a: Coordinate, b: Coordinate) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;
const interpolate = (a: Coordinate, b: Coordinate, t: number): Coordinate => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const cross = (a: Coordinate, b: Coordinate) => a[0] * b[1] - a[1] * b[0];
const subtract = (a: Coordinate, b: Coordinate): Coordinate => [a[0] - b[0], a[1] - b[1]];
const key = (p: Coordinate) => `${p[0]},${p[1]}`;
const sourceId = (element: Element) => `${element.type}/${element.id}`;
const coordinates = (geometry: Element["geometry"]): Coordinate[] => (geometry ?? []).map((p) => [p.lon, p.lat]);
const validCoordinate = (p: Coordinate) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

function area(ring: Ring) {
  const origin = ring[0];
  return ring.slice(1).reduce((sum, p, i) => sum + cross(subtract(ring[i], origin), subtract(p, origin)), 0) / 2;
}

function onSegment(p: Coordinate, a: Coordinate, b: Coordinate) {
  const d = subtract(b, a);
  const length = Math.hypot(...d);
  if (length < EPS) return same(p, a);
  return Math.abs(cross(subtract(p, a), d)) <= EPS * length &&
    p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS &&
    p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;
}

function inRing(p: Coordinate, ring: Ring) {
  let inside = false;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1];
    if (onSegment(p, a, b)) return true;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function inPolygon(p: Coordinate, polygon: Polygon) {
  return inRing(p, polygon[0]) && !polygon.slice(1).some((ring) => inRing(p, ring));
}

function intersectionFractions(a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate): number[] {
  const r = subtract(b, a), s = subtract(d, c);
  const denominator = cross(r, s);
  const delta = subtract(c, a);
  if (Math.abs(denominator) < 1e-20) {
    if (Math.abs(cross(delta, r)) > EPS * Math.hypot(...r)) return [];
    const axis = Math.abs(r[0]) > Math.abs(r[1]) ? 0 : 1;
    if (Math.abs(r[axis]) < EPS) return [];
    return [c, d].map((p) => (p[axis] - a[axis]) / r[axis]).filter((t) => t > 0 && t < 1);
  }
  const t = cross(delta, s) / denominator;
  const u = cross(delta, r) / denominator;
  return t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS ? [Math.max(0, Math.min(1, t))] : [];
}

function validRing(ring: Ring) {
  if (ring.length < 4 || !same(ring[0], ring.at(-1)!) || !ring.every(validCoordinate) || Math.abs(area(ring)) < 1e-14) return false;
  for (let i = 0; i < ring.length - 1; i++) {
    if (same(ring[i], ring[i + 1])) return false;
    for (let j = i + 2; j < ring.length - 1; j++) {
      if (i === 0 && j === ring.length - 2) continue;
      if (intersectionFractions(ring[i], ring[i + 1], ring[j], ring[j + 1]).length) return false;
    }
  }
  return true;
}

function joinRings(fragments: Ring[]): Ring[] {
  const pending = fragments.filter((f) => f.length > 1).map((f) => f.slice());
  const rings: Ring[] = [];
  while (pending.length) {
    let ring = pending.pop()!;
    while (!same(ring[0], ring.at(-1)!)) {
      const index = pending.findIndex((fragment) => same(fragment[0], ring.at(-1)!) || same(fragment.at(-1)!, ring.at(-1)!));
      if (index < 0) throw new Error("unclosed-relation-ring");
      const fragment = pending.splice(index, 1)[0];
      if (!same(fragment[0], ring.at(-1)!)) fragment.reverse();
      ring = ring.concat(fragment.slice(1));
    }
    ring = ring.filter((point, index) => index === 0 || !same(point, ring[index - 1]));
    if (!validRing(ring)) throw new Error("invalid-ring");
    rings.push(ring);
  }
  return rings;
}

function polygonsOf(element: Element): Polygon[] {
  if (element.type === "way") {
    const ring = coordinates(element.geometry).filter((p, i, all) => !i || !same(p, all[i - 1]));
    if (!validRing(ring)) throw new Error("invalid-or-open-building-way");
    return [[area(ring) > 0 ? ring : ring.reverse()]];
  }
  if (element.type !== "relation") throw new Error("not-polygon");
  const members = (element.members ?? []).filter((member) => member.type === "way");
  if (members.some((m) => !["outer", "inner", ""].includes(m.role))) throw new Error("unsupported-relation-member-role");
  const outers = joinRings(members.filter((m) => m.role !== "inner").map((m) => coordinates(m.geometry)));
  const inners = joinRings(members.filter((m) => m.role === "inner").map((m) => coordinates(m.geometry)));
  if (!outers.length) throw new Error("missing-outer-ring");
  const polygons: Polygon[] = outers.map((outer) => [area(outer) > 0 ? outer : outer.reverse()]);
  for (const inner of inners) {
    const parent = polygons.filter((polygon) => inRing(inner[0], polygon[0])).sort((a, b) => Math.abs(area(a[0])) - Math.abs(area(b[0])))[0];
    if (!parent || !inner.every((p) => inRing(p, parent[0]))) throw new Error("uncontained-inner-ring");
    parent.push(area(inner) < 0 ? inner : inner.reverse());
  }
  return polygons;
}

/** A small spatial index keeps full-resolution boundary clipping inexpensive. */
class CityClipper {
  private edges: [Coordinate, Coordinate][];
  private buckets = new Map<string, number[]>();
  private pointCache = new Map<string, boolean>();
  private bounds: number[];
  constructor(readonly polygons: Polygon[]) {
    const all = polygons.flat(2);
    this.bounds = [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))];
    this.edges = polygons.flatMap((polygon) => polygon.flatMap((ring) => ring.slice(1).map((p, i): [Coordinate, Coordinate] => [ring[i], p])));
    this.edges.forEach(([a, b], index) => {
      for (const cell of this.cells(a, b)) {
        const indices = this.buckets.get(cell) ?? [];
        indices.push(index);
        this.buckets.set(cell, indices);
      }
    });
  }
  private cells(a: Coordinate, b: Coordinate) {
    const x = (value: number) => Math.max(0, Math.min(63, Math.floor((value - this.bounds[0]) / (this.bounds[2] - this.bounds[0]) * 64)));
    const y = (value: number) => Math.max(0, Math.min(63, Math.floor((value - this.bounds[1]) / (this.bounds[3] - this.bounds[1]) * 64)));
    const result: string[] = [];
    for (let ix = x(Math.min(a[0], b[0])); ix <= x(Math.max(a[0], b[0])); ix++) {
      for (let iy = y(Math.min(a[1], b[1])); iy <= y(Math.max(a[1], b[1])); iy++) result.push(`${ix}:${iy}`);
    }
    return result;
  }
  contains(p: Coordinate) {
    const cacheKey = key(p), cached = this.pointCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const inside = p[0] >= this.bounds[0] - EPS && p[0] <= this.bounds[2] + EPS && p[1] >= this.bounds[1] - EPS && p[1] <= this.bounds[3] + EPS && this.polygons.some((polygon) => inPolygon(p, polygon));
    this.pointCache.set(cacheKey, inside);
    return inside;
  }
  segment(a: Coordinate, b: Coordinate): [Coordinate, Coordinate][] {
    if (same(a, b)) return [];
    const candidates = new Set(this.cells(a, b).flatMap((cell) => this.buckets.get(cell) ?? []));
    const fractions = [0, 1];
    for (const index of candidates) fractions.push(...intersectionFractions(a, b, ...this.edges[index]));
    const sorted = fractions.sort((a, b) => a - b).filter((t, index, all) => !index || t - all[index - 1] > 1e-9);
    return sorted.slice(1).flatMap((t, i) => this.contains(interpolate(a, b, (sorted[i] + t) / 2)) ? [[interpolate(a, b, sorted[i]), interpolate(a, b, t)] as [Coordinate, Coordinate]] : []);
  }
  line(points: Coordinate[]): Coordinate[][] {
    const result: Coordinate[][] = [];
    for (let i = 1; i < points.length; i++) {
      for (const [a, b] of this.segment(points[i - 1], points[i])) {
        const previous = result.at(-1);
        if (previous && same(previous.at(-1)!, a)) previous.push(b);
        else result.push([a, b]);
      }
    }
    return result;
  }
  fullyContains(ring: Ring) {
    return ring.every((p) => this.contains(p)) && ring.slice(1).every((p, i) => {
      const fragments = this.segment(ring[i], p);
      return fragments.length > 0 && same(fragments[0][0], ring[i]) && same(fragments.at(-1)![1], p) && fragments.slice(1).every((segment, j) => same(fragments[j][1], segment[0]));
    });
  }
}

/** Scanline interior point, so a concave polygon's bbox centre is never invented as its location. */
function interiorPoint(polygon: Polygon): Coordinate | undefined {
  const outer = polygon[0];
  const ys = outer.slice(0, -1).map((p) => p[1]).sort((a, b) => a - b);
  const scans = [(ys[0] + ys.at(-1)!) / 2, ...ys.slice(1).map((y, i) => (y + ys[i]) / 2)];
  for (const y of scans) {
    const xs: number[] = [];
    for (const ring of polygon) for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i], b = ring[i + 1];
      if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
    }
    xs.sort((a, b) => a - b);
    const candidates = xs.slice(1).map((x, i) => ({ point: [(x + xs[i]) / 2, y] as Coordinate, width: x - xs[i] })).sort((a, b) => b.width - a.width);
    const selected = candidates.find(({ point }) => inPolygon(point, polygon));
    if (selected) return selected.point;
  }
}

async function getRaw(name: keyof typeof queries, offline: boolean) {
  const rawFile = path.join(ARTIFACTS, `geodata-${name}-raw.json`);
  const queryFile = path.join(ARTIFACTS, `geodata-${name}.overpassql`);
  const receiptFile = path.join(ARTIFACTS, `geodata-${name}-receipt.json`);
  const query = queries[name];
  let raw: string | undefined;
  let receipt: { endpoint: string; retrievedAt: string; query: string } | undefined;
  try {
    if ((await readFile(queryFile, "utf8")) === query) raw = await readFile(rawFile, "utf8");
    try { receipt = JSON.parse(await readFile(receiptFile, "utf8")); } catch { /* A cache without its receipt cannot prove which query produced it. */ }
    if (receipt?.query !== query) raw = undefined;
  } catch { /* Fetch only cache misses. */ }
  if (!raw && offline) throw new Error(`Missing cached ${name}; run once online.`);
  if (!raw) {
    await writeFile(queryFile, query);
    for (let attempt = 0; attempt < ENDPOINTS.length; attempt++) {
      const endpoint = ENDPOINTS[attempt];
      try {
        console.log(`Fetching ${name}: ${endpoint}`);
        const url = `${endpoint}?${new URLSearchParams({ data: query })}`;
        const response = await fetch(url, { headers: { "User-Agent": "SeongnamCityLocalDataPreparation/1.0 (static educational city visualization)" }, signal: AbortSignal.timeout(115_000) });
        if (!response.ok) {
          if ([429, 406].includes(response.status)) await new Promise((resolve) => setTimeout(resolve, 30_000));
          throw new Error(`HTTP ${response.status}`);
        }
        const candidate = await response.text();
        const parsed = JSON.parse(candidate) as Response;
        if (parsed.remark || !Array.isArray(parsed.elements)) throw new Error(parsed.remark ?? "Invalid Overpass response");
        raw = candidate;
        receipt = { endpoint, retrievedAt: new Date().toISOString(), query };
        await writeFile(rawFile, raw);
        await writeFile(receiptFile, JSON.stringify(receipt, null, 2) + "\n");
        break;
      } catch (error) {
        console.warn(`${name} attempt ${attempt + 1}: ${String(error)}`);
        if (attempt === ENDPOINTS.length - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
  }
  const data = JSON.parse(raw!) as Response;
  if (data.remark || !Array.isArray(data.elements)) throw new Error(`Incomplete ${name} response`);
  return { data, query, receipt: receipt!, bytes: Buffer.byteLength(raw!), sha256: createHash("sha256").update(raw!).digest("hex") };
}

function selfTest() {
  const box: Ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const hole: Ring = [[4, 4], [4, 6], [6, 6], [6, 4], [4, 4]];
  const clipper = new CityClipper([[box, hole]]);
  assert.deepEqual(clipper.line([[-1, 2], [11, 2]]), [[[0, 2], [10, 2]]]);
  assert.deepEqual(clipper.line([[2, 5], [8, 5]]), [[[2, 5], [4, 5]], [[6, 5], [8, 5]]]);
  assert(!clipper.contains([5, 5]));
  assert(clipper.fullyContains([[1, 1], [3, 1], [3, 3], [1, 1]]));
  assert(!clipper.fullyContains([[3, 5], [7, 5], [5, 9], [3, 5]]));
  assert(!validRing([[0, 0], [4, 4], [0, 4], [4, 0], [0, 0]]));
  const relation: Element = { type: "relation", id: 1, members: [
    { type: "way", ref: 1, role: "outer", geometry: box.slice(0, 3).map(([lon, lat]) => ({ lon, lat })) },
    { type: "way", ref: 2, role: "outer", geometry: box.slice(2).reverse().map(([lon, lat]) => ({ lon, lat })) },
    { type: "way", ref: 3, role: "inner", geometry: hole.map(([lon, lat]) => ({ lon, lat })) },
  ] };
  const polygons = polygonsOf(relation);
  assert.equal(polygons.length, 1);
  assert.equal(polygons[0].length, 2);
  assert(inPolygon(interiorPoint(polygons[0])!, polygons[0]));
  assert.throws(() => joinRings([[[0, 0], [1, 1]]]));
  const concave: Ring = [[0, 0], [4, 0], [4, 4], [3, 4], [3, 1], [1, 1], [1, 4], [0, 4], [0, 0]];
  assert.deepEqual(new CityClipper([[concave]]).line([[-1, 2], [5, 2]]), [[[0, 2], [1, 2]], [[3, 2], [4, 2]]]);
  console.log("Geometry self-tests passed: crossing clips, holes, concavity, invalid rings, reversed multipolygon members, interior points.");
}

async function buildLandcover(city: CityClipper, boundary: Awaited<ReturnType<typeof getRaw>>, offline: boolean) {
  const rawCount = await getRaw("landcover-counts", offline);
  const count = Number(rawCount.data.elements[0]?.tags?.total);
  if (!Number.isFinite(count) || count > 15_000) throw new Error(`Landcover count requires a narrower query: ${count}`);
  console.log(`Raw bbox landcover count: ${count}`);
  const raw = await getRaw("landcover", offline);
  const areas: Building[] = [];
  const exclusions: { id: string; reason: string }[] = [];
  const representedOuters = new Map<number, Tags[]>();
  const classificationKeys = ["natural", "landuse", "leisure", "waterway"];
  for (const element of raw.data.elements.toSorted((a, b) => (a.type === "relation" ? -1 : 0) - (b.type === "relation" ? -1 : 0))) {
    const id = sourceId(element), tags = element.tags ?? {};
    const exclude = (reason: string) => exclusions.push({ id, reason });
    if (element.type === "way" && (representedOuters.get(element.id) ?? []).some((parent) => classificationKeys.some((field) => tags[field] && tags[field] === parent[field]))) {
      exclude("outer-way-represented-by-same-class-multipolygon"); continue;
    }
    try {
      const polygons = polygonsOf(element);
      if (!polygons.some((polygon) => polygon[0].some((point) => city.contains(point)))) { exclude("outside-city"); continue; }
      if (!polygons.every((polygon) => polygon.every((ring) => city.fullyContains(ring)))) { exclude("crosses-city-boundary-preserve-original-outline"); continue; }
      areas.push({ id, polygons, tags });
      for (const member of element.members ?? []) if (member.type === "way" && member.role !== "inner") {
        representedOuters.set(member.ref, [...representedOuters.get(member.ref) ?? [], tags]);
      }
    } catch (error) { exclude(error instanceof Error ? error.message : "invalid-geometry"); }
  }
  areas.sort((a, b) => a.id.localeCompare(b.id));
  let invalidCoordinates = 0, outsideCoordinates = 0, invalidRings = 0;
  for (const feature of areas) for (const polygon of feature.polygons) for (const ring of polygon) {
    if (!validRing(ring)) invalidRings++;
    for (const point of ring) {
      if (!validCoordinate(point)) invalidCoordinates++;
      if (!city.contains(point)) outsideCoordinates++;
    }
  }
  const duplicateIds = areas.length - new Set(areas.map((feature) => feature.id)).size;
  const validation = { invalidCoordinates, outsideCoordinates, invalidRings, duplicateIds, passed: !invalidCoordinates && !outsideCoordinates && !invalidRings && !duplicateIds };
  const counts = {
    bboxElements: raw.data.elements.length, areas: areas.length,
    polygons: areas.reduce((sum, feature) => sum + feature.polygons.length, 0),
    holes: areas.reduce((sum, feature) => sum + feature.polygons.reduce((sum, polygon) => sum + polygon.length - 1, 0), 0),
    coordinates: areas.reduce((sum, feature) => sum + feature.polygons.flat().reduce((sum, ring) => sum + ring.length, 0), 0),
    water: areas.filter(({ tags }) => tags.natural === "water" || tags.waterway === "riverbank").length,
    woodland: areas.filter(({ tags }) => tags.natural === "wood" || tags.landuse === "forest").length,
    parks: areas.filter(({ tags }) => tags.leisure === "park").length,
    gardens: areas.filter(({ tags }) => tags.leisure === "garden").length,
    grass: areas.filter(({ tags }) => tags.landuse === "grass").length,
    recreationGrounds: areas.filter(({ tags }) => tags.landuse === "recreation_ground").length,
    natureReserves: areas.filter(({ tags }) => tags.leisure === "nature_reserve").length,
    exclusions: exclusions.reduce<Record<string, number>>((result, { reason }) => { result[reason] = (result[reason] ?? 0) + 1; return result; }, {}),
  };
  await writeFile(path.join(ARTIFACTS, "geodata-landcover-validation.json"), JSON.stringify({ ...validation, counts, exclusions }, null, 2) + "\n");
  if (!validation.passed) throw new Error(`Landcover validation failed: ${JSON.stringify(validation)}`);
  const dataset = {
    version: 1,
    metadata: {
      name: "Seongnam OSM landcover extract", coordinateSystem: "WGS84", coordinateOrder: "longitude,latitude", cityRelationId: 2409180, bbox: BBOX,
      attribution: "© OpenStreetMap contributors", license: "ODbL-1.0", attributionUrl: "https://www.openstreetmap.org/copyright", licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/", sourceUrlTemplate: "https://www.openstreetmap.org/{id}",
      inputs: Object.fromEntries(Object.entries({ boundary, landcover: raw }).map(([name, input]) => [name, { ...input.receipt, query: input.query, osmBaseTimestamp: input.data.osm3s.timestamp_osm_base, rawBytes: input.bytes, sha256: input.sha256 }])),
      counts,
      processing: "Original full-resolution WGS84 rings, multipolygon holes and raw tags. Keep only complete areas inside exact municipal boundary; same-class outer member ways deduplicated. No terrain or canopy height inferred.",
      limitations: ["OSM landcover is incomplete and is not an official land survey.", "Areas that cross the municipal boundary are excluded to preserve original outlines, including some large forests and river sections.", "Invalid, open or unresolved polygon topology is excluded and logged.", "Leisure park extents, grass, woodland and water may overlap semantically; these are independent mapped classifications.", "Missing tree nodes, canopy coverage, elevation and surface material are not invented.", "Layer acquisition is separate from the earlier roads, buildings and POIs snapshot."],
    },
    areas,
  };
  const serialized = JSON.stringify(dataset) + "\n";
  await writeFile(LANDCOVER_OUTPUT, serialized);
  const summary = { ...validation, counts, bytes: Buffer.byteLength(serialized), gzipBytes: gzipSync(serialized).byteLength, sha256: createHash("sha256").update(serialized).digest("hex"), namedAreas: areas.filter((feature) => feature.tags.name).map(({ id, tags }) => ({ id, name: tags.name, natural: tags.natural, leisure: tags.leisure })) };
  await writeFile(path.join(ARTIFACTS, "geodata-landcover-summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify({ ...validation, counts, bytes: summary.bytes, gzipBytes: summary.gzipBytes, sha256: summary.sha256 }, null, 2));
}

async function main() {
  selfTest();
  if (process.argv.includes("--self-test")) return;
  const offline = process.argv.includes("--offline");
  await mkdir(ARTIFACTS, { recursive: true });
  const boundary = await getRaw("boundary", offline);
  const city = new CityClipper(polygonsOf(boundary.data.elements.find((element) => element.type === "relation" && element.id === 2409180)!));
  if (process.argv.includes("--landcover")) return buildLandcover(city, boundary, offline);
  const rawRoads = await getRaw("roads", offline);
  console.log(`Raw bbox roads: ${rawRoads.data.elements.length}, ${rawRoads.bytes} bytes`);
  const rawBuildings = await getRaw("buildings", offline);
  console.log(`Raw bbox buildings: ${rawBuildings.data.elements.length}, ${rawBuildings.bytes} bytes`);
  const rawPois = await getRaw("pois", offline);
  console.log(`Raw bbox POIs: ${rawPois.data.elements.length}, ${rawPois.bytes} bytes`);
  const roads: Road[] = [], buildings: Building[] = [], pois: Poi[] = [], exclusions: Exclusion[] = [];
  const exclude = (element: Element, category: Exclusion["category"], reason: string) => exclusions.push({ id: sourceId(element), category, reason });
  for (const element of rawRoads.data.elements) {
    const points = coordinates(element.geometry);
    if (points.length < 2 || !points.every(validCoordinate)) { exclude(element, "road", "invalid-geometry"); continue; }
    const clipped = city.line(points);
    if (!clipped.length) { exclude(element, "road", "outside-city"); continue; }
    clipped.forEach((coordinates, segmentIndex) => roads.push({ id: sourceId(element), segmentIndex, coordinates, tags: element.tags ?? {} }));
  }
  const representedMemberWays = new Set<number>();
  for (const element of rawBuildings.data.elements.toSorted((a, b) => (a.type === "relation" ? -1 : 0) - (b.type === "relation" ? -1 : 0))) {
    if (element.type === "way" && representedMemberWays.has(element.id)) { exclude(element, "building", "represented-by-multipolygon-relation"); continue; }
    try {
      const polygons = polygonsOf(element);
      if (!polygons.some((polygon) => polygon[0].some((point) => city.contains(point)))) { exclude(element, "building", "outside-city"); continue; }
      if (!polygons.every((polygon) => polygon.every((ring) => city.fullyContains(ring)))) { exclude(element, "building", "crosses-city-boundary-preserve-original-footprint"); continue; }
      buildings.push({ id: sourceId(element), polygons, tags: element.tags ?? {} });
      for (const member of element.members ?? []) if (member.type === "way") representedMemberWays.add(member.ref);
    } catch (error) { exclude(element, "building", error instanceof Error ? error.message : "invalid-geometry"); }
  }
  for (const element of rawPois.data.elements) {
    let position: Coordinate | undefined;
    let positionSource: Poi["positionSource"] = "geometry-point";
    if (element.type === "node" && element.lon !== undefined && element.lat !== undefined) {
      position = [element.lon, element.lat]; positionSource = "node";
    } else {
      try {
        for (const polygon of polygonsOf(element).sort((a, b) => Math.abs(area(b[0])) - Math.abs(area(a[0])))) {
          const point = interiorPoint(polygon);
          if (point && city.contains(point)) { position = point; positionSource = "interior-point"; break; }
        }
      } catch { /* Linear or unresolved POIs retain an actual in-city geometry vertex. */ }
      if (!position) position = [...coordinates(element.geometry), ...(element.members ?? []).flatMap((m) => coordinates(m.geometry))].find((p) => city.contains(p));
    }
    if (!position || !validCoordinate(position) || !city.contains(position)) { exclude(element, "poi", "outside-city-or-missing-geometry"); continue; }
    pois.push({ id: sourceId(element), coordinates: position, positionSource, tags: element.tags ?? {} });
  }
  roads.sort((a, b) => a.id.localeCompare(b.id) || a.segmentIndex - b.segmentIndex);
  buildings.sort((a, b) => a.id.localeCompare(b.id));
  pois.sort((a, b) => a.id.localeCompare(b.id));

  const errors: string[] = [];
  const identities = new Set<string>();
  let outsideCoordinates = 0, invalidRings = 0, invalidCoordinates = 0;
  for (const feature of [...roads, ...buildings, ...pois]) {
    const identity = `${"segmentIndex" in feature ? "road" : "polygons" in feature ? "building" : "poi"}:${feature.id}:${"segmentIndex" in feature ? feature.segmentIndex : ""}`;
    if (identities.has(identity)) errors.push(`duplicate ${identity}`);
    identities.add(identity);
    const points: Coordinate[] = "polygons" in feature ? feature.polygons.flat(2) : "segmentIndex" in feature ? feature.coordinates : [feature.coordinates];
    for (const point of points) {
      if (!validCoordinate(point)) invalidCoordinates++;
      if (!city.contains(point)) outsideCoordinates++;
    }
    if ("polygons" in feature) for (const polygon of feature.polygons) for (const ring of polygon) if (!validRing(ring)) invalidRings++;
  }
  const tallies = (tags: Tags[], field: string) => tags.reduce<Record<string, number>>((counts, tag) => {
    if (tag[field]) counts[tag[field]] = (counts[tag[field]] ?? 0) + 1;
    return counts;
  }, {});
  const countExclusions = exclusions.reduce<Record<string, number>>((counts, exclusion) => {
    const reason = `${exclusion.category}:${exclusion.reason}`; counts[reason] = (counts[reason] ?? 0) + 1; return counts;
  }, {});
  const counts = {
    bboxRoadWays: rawRoads.data.elements.length, bboxBuildingElements: rawBuildings.data.elements.length, bboxPoiElements: rawPois.data.elements.length,
    roads: roads.length, roadWays: new Set(roads.map((r) => r.id)).size, roadCoordinates: roads.reduce((sum, road) => sum + road.coordinates.length, 0),
    buildings: buildings.length, buildingPolygons: buildings.reduce((sum, building) => sum + building.polygons.length, 0),
    buildingHoles: buildings.reduce((sum, building) => sum + building.polygons.reduce((sum, polygon) => sum + polygon.length - 1, 0), 0),
    buildingCoordinates: buildings.reduce((sum, building) => sum + building.polygons.flat().reduce((sum, ring) => sum + ring.length, 0), 0),
    buildingsWithHeight: buildings.filter((building) => !!building.tags.height).length,
    buildingsWithLevels: buildings.filter((building) => !!building.tags["building:levels"]).length,
    namedBuildings: buildings.filter((building) => !!building.tags.name).length,
    pois: pois.length, namedShops: pois.filter((poi) => !!poi.tags.shop).length,
    namedFoodVenues: pois.filter((poi) => /^(restaurant|cafe|fast_food|bar|pub|ice_cream|food_court)$/.test(poi.tags.amenity ?? "")).length,
    roadsByHighway: tallies(roads.map((road) => road.tags), "highway"), poisByTourism: tallies(pois.map((poi) => poi.tags), "tourism"),
    exclusions: countExclusions,
  };
  const validation = { invalidCoordinates, outsideCoordinates, invalidRings, errors, passed: !invalidCoordinates && !outsideCoordinates && !invalidRings && !errors.length };
  await writeFile(path.join(ARTIFACTS, "geodata-validation.json"), JSON.stringify({ ...validation, counts, exclusions }, null, 2) + "\n");
  if (!validation.passed) throw new Error(`Geographic validation failed: ${JSON.stringify(validation)}`);
  const inputs = { boundary, roads: rawRoads, buildings: rawBuildings, pois: rawPois };
  const dataset = {
    version: 1,
    metadata: {
      name: "Seongnam OSM urban extract", coordinateSystem: "WGS84", coordinateOrder: "longitude,latitude", cityRelationId: 2409180, bbox: BBOX,
      attribution: "© OpenStreetMap contributors", license: "ODbL-1.0", licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/", attributionUrl: "https://www.openstreetmap.org/copyright", sourceUrlTemplate: "https://www.openstreetmap.org/{id}",
      inputs: Object.fromEntries(Object.entries(inputs).map(([name, input]) => [name, { ...input.receipt, query: input.query, osmBaseTimestamp: input.data.osm3s.timestamp_osm_base, rawBytes: input.bytes, sha256: input.sha256 }])),
      counts,
      processing: { cityBoundary: "Full-resolution OSM relation 2409180, not the simplified display districts", roads: "Full source coordinates, intersected at the municipal boundary; original ID plus segmentIndex", buildings: "Original closed footprints and multipolygon holes; self-intersecting, unresolved and boundary-crossing footprints excluded with recorded reasons", pois: "Named OSM shop, amenity, tourism, leisure or historic; node coordinate or a derived interior point; geometry fallback explicitly marked", coordinateRounding: "None; original OSM precision and computed intersection coordinates retained" },
      limitations: ["OSM is a volunteered geographic database, not a complete city inventory or cadastral survey.", "Absence of a feature or height tag means unknown, not absence in the real city.", "Building heights, facade appearance and store interiors are not inferred in this dataset.", "Building parts with only building:part, underground buildings and unnamed POIs are outside the query scope unless also tagged building/name as applicable.", "Boundary-crossing building footprints are excluded rather than geometrically altered.", "POI names do not verify current opening status. Named amenities and shops are not automatically tourist attractions.", "Layer snapshots can differ by minutes; raw response timestamps and hashes identify each exact input."],
    },
    roads, buildings, pois,
  };
  const serialized = JSON.stringify(dataset) + "\n";
  await writeFile(OUTPUT, serialized);
  const namedRoads = new Map<string, { id: string; name: string; coordinates: Coordinate }>();
  for (const road of roads.toSorted((a, b) => b.coordinates.length - a.coordinates.length)) {
    if (road.tags.name && !namedRoads.has(road.tags.name)) namedRoads.set(road.tags.name, { id: road.id, name: road.tags.name, coordinates: road.coordinates[Math.floor(road.coordinates.length / 2)] });
  }
  const index = JSON.stringify({ version: dataset.version, metadata: dataset.metadata, pois, roads: [...namedRoads.values()].sort((a, b) => a.name.localeCompare(b.name, "ko")) }) + "\n";
  await writeFile(INDEX_OUTPUT, index);
  const summary = { ...validation, counts, output: OUTPUT, bytes: Buffer.byteLength(serialized), gzipBytes: gzipSync(serialized).byteLength, sha256: createHash("sha256").update(serialized).digest("hex"), indexBytes: Buffer.byteLength(index), indexNamedRoads: namedRoads.size };
  await writeFile(path.join(ARTIFACTS, "geodata-summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
