import * as THREE from "three";

type Point = readonly [number, number, number];

/** Coordinates and widths use the city's world units (one unit = 100 metres). */
export interface LifeRoute {
  id: string;
  points: readonly Point[];
  width: number;
  pedestrian: boolean;
  vehicle: boolean;
  oneway?: boolean;
}

export interface CityLifeConfiguration {
  /** 0 hides all instances; 1 is the default; 2 is the maximum. */
  density: number;
  /** Illustrative person size, independent of road geometry and driving speed. */
  peopleScale: number;
}

export interface CityLife {
  people: THREE.Group;
  traffic: THREE.Group;
  counts: { people: number; vehicles: number };
  update: (elapsedSeconds: number, moving: boolean) => void;
  configure: (options: Partial<CityLifeConfiguration>) => void;
  dispose: () => void;
}

interface Path {
  points: Point[];
  distances: number[];
  tangents: [number, number][];
  total: number;
  width: number;
  pedestrian: boolean;
  vehicle: boolean;
  oneway: boolean;
  closed: boolean;
  footfall: number;
}

interface Actor {
  path: Path;
  phase: number;
  speed: number;
  side: number;
  size: number;
  variation: number;
  cycle: number;
  hiddenAt: number;
  kind: "person" | "car" | "taxi" | "bus";
}

const DEFAULT_PEOPLE = 3600;
const DEFAULT_VEHICLES = 1500;
const MAX_DENSITY = 2;
const MAX_PERSON_SCALE = 3;
const TWO_PI = Math.PI * 2;
const FRACTION = 0.6180339887498949;
const fraction = (value: number) => value - Math.floor(value);
const random = (index: number, salt: number) => fraction(Math.sin(index * 127.1 + salt * 311.7) * 43758.5453);
const finitePoint = (point: Point) => point.every((value) => Number.isFinite(value) && Math.abs(value) < 1e6);

function landmarkDistance(points: readonly Point[], landmarks: readonly Point[]) {
  let closest = Infinity;
  for (const landmark of landmarks) {
    if (!finitePoint(landmark)) continue;
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1], b = points[index];
      const dx = b[0] - a[0], dz = b[2] - a[2];
      const lengthSquared = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((landmark[0] - a[0]) * dx + (landmark[2] - a[2]) * dz) / lengthSquared));
      closest = Math.min(closest, Math.hypot(landmark[0] - a[0] - dx * t, landmark[2] - a[2] - dz * t));
    }
  }
  return closest;
}

function preparePath(route: LifeRoute, landmarks: readonly Point[]): Path | undefined {
  // Reject broken source geometry as a whole: filtering an invalid interior point would invent a shortcut.
  if ((!route.pedestrian && !route.vehicle) || route.points.length < 2 || !route.points.every(finitePoint)) return;
  const points: Point[] = [];
  for (const point of route.points) {
    const previous = points[points.length - 1];
    if (!previous || Math.hypot(point[0] - previous[0], point[2] - previous[2]) > 1e-6) points.push([...point]);
  }
  if (points.length < 2) return;
  const first = points[0], last = points[points.length - 1];
  const closed = points.length > 2 && Math.hypot(first[0] - last[0], first[1] - last[1], first[2] - last[2]) < 1e-5;
  if (closed) points[points.length - 1] = first;
  const distances = [0];
  const directions: [number, number][] = [];
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index];
    const dx = b[0] - a[0], dz = b[2] - a[2];
    const horizontal = Math.hypot(dx, dz);
    distances.push(distances[index - 1] + Math.hypot(horizontal, b[1] - a[1]));
    directions.push([dx / horizontal, dz / horizontal]);
  }
  const tangents = points.map((_, index): [number, number] => {
    const before = directions[index - 1] ?? (closed ? directions[directions.length - 1] : directions[0]);
    const after = directions[index] ?? (closed ? directions[0] : directions[directions.length - 1]);
    const dx = before[0] + after[0], dz = before[1] + after[1];
    const length = Math.hypot(dx, dz);
    return length < 1e-6 ? after : [dx / length, dz / length];
  });
  const distance = landmarkDistance(points, landmarks);
  return {
    points, distances, tangents,
    total: distances[distances.length - 1],
    width: Number.isFinite(route.width) && route.width > 0 ? Math.min(route.width, 3) : 0.06,
    pedestrian: route.pedestrian,
    vehicle: route.vehicle,
    oneway: route.oneway === true,
    closed,
    footfall: 1 + 2.5 * Math.max(0, 1 - distance / 8),
  };
}

function createActors(paths: Path[], capacity: number, pedestrian: boolean): Actor[] {
  if (!paths.length) return [];
  const weights: number[] = [];
  let totalWeight = 0;
  for (const path of paths) {
    // A square-root length weight keeps short neighborhood paths represented beside long arterials.
    totalWeight += Math.sqrt(Math.min(path.total, 30)) * (pedestrian ? path.footfall : 1);
    weights.push(totalWeight);
  }
  return Array.from({ length: capacity }, (_, index) => {
    const target = fraction(0.37 + index * FRACTION) * totalWeight;
    let low = 0, high = paths.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (target < weights[middle]) high = middle;
      else low = middle + 1;
    }
    const path = paths[low];
    const phase = random(index + 1, pedestrian ? 11 : 29);
    return {
      path,
      phase: phase * path.total * (path.closed || (!pedestrian && path.oneway) ? 1 : 2),
      speed: pedestrian ? 0.009 + random(index, 7) * 0.009 : 0.075 + random(index, 17) * 0.065,
      side: random(index, 23) < 0.5 ? -1 : 1,
      size: 0.9 + random(index, 37) * 0.2,
      variation: random(index, 41) * TWO_PI,
      cycle: 0,
      hiddenAt: -1,
      kind: pedestrian ? "person" : index % 12 === 0 ? "bus" : index % 5 === 0 ? "taxi" : "car",
    };
  });
}

/** Decorative actors on supplied road/path geometry; this does not represent observed traffic. */
export function buildCityLife(routes: readonly LifeRoute[], landmarkPositions: readonly Point[] = []): CityLife {
  const people = new THREE.Group();
  const traffic = new THREE.Group();
  people.name = "city-people";
  traffic.name = "city-traffic";
  people.userData.decorative = traffic.userData.decorative = true;
  const paths = routes.map((route) => preparePath(route, landmarkPositions)).filter((path): path is Path => path !== undefined);
  const walkers = createActors(paths.filter((path) => path.pedestrian), DEFAULT_PEOPLE * MAX_DENSITY, true);
  const drivers = createActors(paths.filter((path) => path.vehicle), DEFAULT_VEHICLES * MAX_DENSITY, false);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const round = new THREE.IcosahedronGeometry(0.5, 0);
  const material = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.8, metalness: 0, flatShading: true });
  const allMeshes: THREE.InstancedMesh[] = [];
  const humanMeshes: THREE.InstancedMesh[] = [];
  const vehicleMeshes: THREE.InstancedMesh[] = [];
  const personBounds = new THREE.Box3(), trafficBounds = new THREE.Box3();
  const vector = new THREE.Vector3();
  for (const path of paths) {
    for (const point of path.points) {
      vector.set(...point);
      if (path.pedestrian) personBounds.expandByPoint(vector);
      if (path.vehicle) trafficBounds.expandByPoint(vector);
    }
  }
  const margin = 0.25 + Math.max(0, ...paths.map((path) => path.width / 2));
  personBounds.expandByScalar(margin);
  trafficBounds.expandByScalar(margin);
  const batch = (parent: THREE.Group, name: string, capacity: number, geometry: THREE.BufferGeometry = box) => {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // Path envelopes remain valid while instances move, avoiding per-frame bounding-volume scans.
    mesh.boundingBox = (parent === people ? personBounds : trafficBounds).clone();
    mesh.boundingSphere = mesh.boundingBox.getBoundingSphere(new THREE.Sphere());
    parent.add(mesh);
    allMeshes.push(mesh);
    (parent === people ? humanMeshes : vehicleMeshes).push(mesh);
    return mesh;
  };
  const personBodies = batch(people, "city-person-bodies", walkers.length);
  const personHeads = batch(people, "city-person-heads", walkers.length, round);
  const personHair = batch(people, "city-person-hair", walkers.length, round);
  const personArms = batch(people, "city-person-arms", walkers.length * 2);
  const personLegs = batch(people, "city-person-legs", walkers.length * 2);
  const carBodies = batch(traffic, "city-vehicle-bodies", drivers.length);
  const carWindows = batch(traffic, "city-vehicle-windows", drivers.length);
  const carRoofs = batch(traffic, "city-vehicle-roofs", drivers.length);
  const carWheels = batch(traffic, "city-vehicle-wheels", drivers.length * 4);
  const headlights = batch(traffic, "city-vehicle-headlights", drivers.length * 2);
  const taillights = batch(traffic, "city-vehicle-taillights", drivers.length * 2);
  const taxiSigns = batch(traffic, "city-taxi-signs", drivers.length);
  const colors = (values: string[]) => values.map((value) => new THREE.Color(value));
  const shirts = colors(["#f04b40", "#ffd147", "#2468d4", "#11bfa4", "#faf7ec", "#cf40bb", "#ef861f", "#7250cc"]);
  const skin = colors(["#f6d0a9", "#d4a074", "#a87554", "#82543c"]);
  const hair = colors(["#302626", "#583923", "#242736", "#8a5e35"]);
  const trousers = colors(["#243954", "#34323c", "#4b5264", "#e2d4b4"]);
  const paint = colors(["#fbfaf4", "#dc4439", "#3a72c4", "#73c5bc", "#e4bc51", "#55596d", "#b9bbc4"]);
  const taxi = new THREE.Color("#ffb52c"), busBlue = new THREE.Color("#1676bc"), busGreen = new THREE.Color("#31a85c");
  const glass = new THREE.Color("#223e56"), tire = new THREE.Color("#25303a");
  const lamp = new THREE.Color("#fff0b1"), rearLamp = new THREE.Color("#ed3838");
  walkers.forEach((_, index) => {
    personBodies.setColorAt(index, shirts[index % shirts.length]);
    personHeads.setColorAt(index, skin[index % skin.length]);
    personHair.setColorAt(index, hair[index % hair.length]);
    for (let side = 0; side < 2; side++) {
      personArms.setColorAt(index * 2 + side, shirts[index % shirts.length]);
      personLegs.setColorAt(index * 2 + side, trousers[index % trousers.length]);
    }
  });
  drivers.forEach((driver, index) => {
    const color = driver.kind === "taxi" ? taxi : driver.kind === "bus" ? (index % 24 === 0 ? busBlue : busGreen) : paint[index % paint.length];
    carBodies.setColorAt(index, color);
    carRoofs.setColorAt(index, color);
    carWindows.setColorAt(index, glass);
    taxiSigns.setColorAt(index, lamp);
    for (let wheel = 0; wheel < 4; wheel++) carWheels.setColorAt(index * 4 + wheel, tire);
    for (let side = 0; side < 2; side++) {
      headlights.setColorAt(index * 2 + side, lamp);
      taillights.setColorAt(index * 2 + side, rearLamp);
    }
  });
  for (const mesh of allMeshes) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  const counts = { people: 0, vehicles: 0 };
  let density = 1, peopleScale = 1.7;
  let disposed = false;
  let lastElapsed: number | undefined;
  let peopleMoving = false, trafficMoving = false;
  let walkingSeconds = 0, drivingSeconds = 0;
  // Reused for every actor/part; animation never allocates Object3Ds, vectors or matrices.
  const sample = { x: 0, y: 0, z: 0, sin: 0, cos: 1, fade: 1 };
  const sampleActor = (actor: Actor, seconds: number) => {
    const path = actor.path;
    const pedestrian = actor.kind === "person";
    const looping = path.closed || (!pedestrian && path.oneway);
    const period = path.total * (looping ? 1 : 2);
    const unwrapped = actor.phase + seconds * actor.speed;
    const travel = unwrapped % period;
    const direction = looping || travel <= path.total ? 1 : -1;
    const distance = direction === 1 ? travel : period - travel;
    let low = 0, high = path.distances.length - 2;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (distance <= path.distances[middle + 1]) high = middle;
      else low = middle + 1;
    }
    const a = path.points[low], b = path.points[low + 1];
    const t = (distance - path.distances[low]) / (path.distances[low + 1] - path.distances[low]);
    const ta = path.tangents[low], tb = path.tangents[low + 1];
    let dx = ta[0] + (tb[0] - ta[0]) * t, dz = ta[1] + (tb[1] - ta[1]) * t;
    const tangentLength = Math.hypot(dx, dz);
    if (tangentLength > 1e-6) { dx /= tangentLength; dz /= tangentLength; }
    else { const length = Math.hypot(b[0] - a[0], b[2] - a[2]); dx = (b[0] - a[0]) / length; dz = (b[2] - a[2]) / length; }
    const endpointDistance = Math.min(distance, path.total - distance);
    const turn = path.closed || path.oneway || pedestrian ? 1 : Math.min(1, endpointDistance / 0.12);
    const lateral = pedestrian
      ? actor.side * path.width * (path.vehicle ? 0.45 : 0.18) * (0.75 + actor.size * 0.2)
      : path.width * (path.oneway ? 0.08 : 0.22) * direction * turn;
    sample.x = a[0] + (b[0] - a[0]) * t + dz * lateral;
    sample.y = a[1] + (b[1] - a[1]) * t + 0.003;
    sample.z = a[2] + (b[2] - a[2]) * t - dx * lateral;
    sample.sin = dx * direction;
    sample.cos = dz * direction;
    // Open one-way roads never reverse or visibly teleport between disconnected endpoints.
    sample.fade = 1;
    if (!pedestrian && path.oneway && !path.closed) {
      const cycle = Math.floor(unwrapped / period);
      if (cycle !== actor.cycle) actor.hiddenAt = seconds;
      actor.cycle = cycle;
      // Also hide the crossing frame when a slow frame skips over the endpoint's fade interval.
      sample.fade = actor.hiddenAt === seconds ? 0
        : Math.max(0, Math.min(1, (endpointDistance - Math.min(0.015, path.total * 0.08)) / Math.min(0.08, path.total * 0.2)));
    }
  };
  const stamp = (mesh: THREE.InstancedMesh, index: number, ox: number, oy: number, oz: number,
    sx: number, sy: number, sz: number, size: number, pitch = 0) => {
    const array = mesh.instanceMatrix.array;
    const offset = index * 16;
    const sin = sample.sin, cos = sample.cos, sp = Math.sin(pitch), cp = Math.cos(pitch);
    sx *= size; sy *= size; sz *= size;
    array[offset] = cos * sx; array[offset + 1] = 0; array[offset + 2] = -sin * sx; array[offset + 3] = 0;
    array[offset + 4] = sin * sp * sy; array[offset + 5] = cp * sy; array[offset + 6] = cos * sp * sy; array[offset + 7] = 0;
    array[offset + 8] = sin * cp * sz; array[offset + 9] = -sp * sz; array[offset + 10] = cos * cp * sz; array[offset + 11] = 0;
    array[offset + 12] = sample.x + (cos * ox + sin * oz) * size;
    array[offset + 13] = sample.y + oy * size;
    array[offset + 14] = sample.z + (-sin * ox + cos * oz) * size;
    array[offset + 15] = 1;
  };
  const upload = (meshes: THREE.InstancedMesh[]) => {
    for (const mesh of meshes) {
      if (!mesh.count) continue;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
  };
  const placePeople = () => {
    for (let index = 0; index < counts.people; index++) {
      const actor = walkers[index];
      sampleActor(actor, walkingSeconds);
      const size = actor.size * peopleScale;
      const gait = Math.sin(walkingSeconds * (6 + actor.speed * 100) + actor.variation) * 0.42;
      const bob = Math.abs(gait) * 0.001;
      stamp(personBodies, index, 0, 0.03 + bob, 0, 0.019, 0.021, 0.012, size);
      stamp(personHeads, index, 0, 0.047 + bob, 0, 0.018, 0.019, 0.017, size);
      stamp(personHair, index, 0, 0.054 + bob, -0.002, 0.0185, 0.009, 0.0175, size);
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? -1 : 1;
        stamp(personArms, index * 2 + side, sign * 0.012, 0.029 + bob, 0, 0.006, 0.021, 0.007, size, -sign * gait);
        stamp(personLegs, index * 2 + side, sign * 0.005, 0.011, 0, 0.007, 0.022, 0.009, size, sign * gait);
      }
    }
    upload(humanMeshes);
  };
  const placeTraffic = () => {
    for (let index = 0; index < counts.vehicles; index++) {
      const actor = drivers[index];
      sampleActor(actor, drivingSeconds);
      const bus = actor.kind === "bus";
      const size = actor.size * sample.fade;
      const width = bus ? 0.043 : 0.035, length = bus ? 0.125 : 0.075;
      const cabinY = bus ? 0.028 : 0.024, roofY = bus ? 0.041 : 0.034;
      stamp(carBodies, index, 0, 0.012, 0, width, 0.017, length, size);
      stamp(carWindows, index, 0, cabinY, bus ? 0 : -0.002, width * 0.88, bus ? 0.02 : 0.015, length * (bus ? 0.92 : 0.59), size);
      stamp(carRoofs, index, 0, roofY, bus ? 0 : -0.002, width * 0.96, 0.005, length * (bus ? 0.94 : 0.52), size);
      for (let wheel = 0; wheel < 4; wheel++) {
        stamp(carWheels, index * 4 + wheel, (wheel % 2 === 0 ? -1 : 1) * width * 0.49, 0.008,
          (wheel < 2 ? -1 : 1) * length * 0.31, 0.007, 0.012, 0.012, size);
      }
      for (let side = 0; side < 2; side++) {
        const x = (side === 0 ? -1 : 1) * width * 0.3;
        stamp(headlights, index * 2 + side, x, 0.015, length * 0.505, 0.009, 0.005, 0.002, size);
        stamp(taillights, index * 2 + side, x, 0.015, -length * 0.505, 0.007, 0.005, 0.002, size);
      }
      stamp(taxiSigns, index, 0, roofY + 0.006, 0, 0.014, 0.006, 0.007, actor.kind === "taxi" ? size : 0);
    }
    upload(vehicleMeshes);
  };
  const applyConfiguration = () => {
    counts.people = walkers.length ? Math.round(DEFAULT_PEOPLE * density) : 0;
    counts.vehicles = drivers.length ? Math.round(DEFAULT_VEHICLES * density) : 0;
    for (const mesh of humanMeshes) mesh.count = counts.people * (mesh === personArms || mesh === personLegs ? 2 : 1);
    for (const mesh of vehicleMeshes) mesh.count = counts.vehicles * (mesh === carWheels ? 4 : mesh === headlights || mesh === taillights ? 2 : 1);
    placePeople();
    placeTraffic();
    if (!counts.people) peopleMoving = false;
    if (!counts.vehicles) trafficMoving = false;
  };
  applyConfiguration();

  return {
    people, traffic, counts,
    update: (elapsedSeconds, moving) => {
      if (disposed || !Number.isFinite(elapsedSeconds)) return;
      const walking = moving && people.visible && counts.people > 0;
      const driving = moving && traffic.visible && counts.vehicles > 0;
      // First frames after pause/hidden state establish a baseline; long background gaps are capped.
      const delta = lastElapsed === undefined || elapsedSeconds < lastElapsed ? 0 : Math.min(1, elapsedSeconds - lastElapsed);
      if (walking && peopleMoving && delta > 0) { walkingSeconds += delta; placePeople(); }
      if (driving && trafficMoving && delta > 0) { drivingSeconds += delta; placeTraffic(); }
      lastElapsed = elapsedSeconds;
      peopleMoving = walking;
      trafficMoving = driving;
    },
    configure: (options) => {
      if (disposed) return;
      const nextDensity = Number.isFinite(options.density) ? Math.max(0, Math.min(MAX_DENSITY, options.density!)) : density;
      const nextScale = Number.isFinite(options.peopleScale) ? Math.max(0.6, Math.min(MAX_PERSON_SCALE, options.peopleScale!)) : peopleScale;
      if (density === nextDensity && peopleScale === nextScale) return;
      density = nextDensity;
      peopleScale = nextScale;
      applyConfiguration();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const mesh of allMeshes) mesh.dispose();
      box.dispose(); round.dispose(); material.dispose();
    },
  };
}
