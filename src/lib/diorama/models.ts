import * as THREE from "three";

type PlaceId = "pangyo-museum" | "central-park" | "moran-market";
type Point = readonly [number, number, number];
type PlanPoint = readonly [number, number];
type Instance = { position: Point; scale: Point; rotation: number };
type Batch = { parent: THREE.Group; name: string; geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial; instances: Instance[] };

export interface DioramaModel {
  group: THREE.Group;
  visitors: THREE.Group;
  traffic?: THREE.Group;
  configurePopulation?: (options: { density: number; peopleScale: number }) => void;
  pickTargets: THREE.Object3D[];
  update: (elapsedSeconds: number, moving: boolean) => void;
  dispose: () => void;
}

const palette = {
  grass: "#a9bb82", grassLight: "#becd98", grassDark: "#91aa73",
  soil: "#c6b28d", soilLight: "#e0cfac", path: "#eee2cc", curb: "#f8eedb",
  bark: "#92735a", leaf: "#73976c", leafDark: "#527c65", leafLight: "#98b77b",
  pine: "#527968", charcoal: "#414d51", stone: "#899495", cream: "#f4ebd8",
  wood: "#ae7d56", woodLight: "#c39167", glass: "#75adb0", metal: "#637574",
  water: "#71b8bb", waterLight: "#a8d5ce", coral: "#d8886d", mustard: "#d6ae58",
};

/** Each build owns its GPU resources; repeated forms are instanced only within that build. */
class ModelBuilder {
  readonly group = this.makeGroup("diorama");
  readonly visitors = this.makeGroup("visitors", this.group);
  readonly pickTargets: THREE.Object3D[] = [];
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly batches = new Map<string, Batch>();
  private readonly instanceMeshes: THREE.InstancedMesh[] = [];
  private readonly walkers: { group: THREE.Group; route: PlanPoint[]; lengths: number[]; total: number; offset: number; speed: number }[] = [];

  makeGroup(name: string, parent?: THREE.Group) {
    const group = new THREE.Group();
    group.name = name;
    parent?.add(group);
    return group;
  }

  geometry(key: string, create: () => THREE.BufferGeometry) {
    let geometry = this.geometries.get(key);
    if (!geometry) {
      geometry = create();
      this.geometries.set(key, geometry);
    }
    return geometry;
  }

  material(color: string, roughness = 0.88) {
    const key = `${color}/${roughness}`;
    let material = this.materials.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, flatShading: true });
      this.materials.set(key, material);
    }
    return material;
  }

  instance(parent: THREE.Group, name: string, geometry: THREE.BufferGeometry, color: string, position: Point, scale: Point = [1, 1, 1], rotation = 0) {
    const material = this.material(color);
    const key = `${parent.id}/${geometry.id}/${material.uuid}`;
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { parent, name, geometry, material, instances: [] };
      this.batches.set(key, batch);
    }
    batch.instances.push({ position, scale, rotation });
  }

  box(parent: THREE.Group, color: string, position: Point, scale: Point, rotation = 0, name = "architectural-details") {
    this.instance(parent, name, this.geometry("box", () => new THREE.BoxGeometry(1, 1, 1)), color, position, scale, rotation);
  }

  cylinder(parent: THREE.Group, color: string, position: Point, scale: Point, name = "round-details") {
    this.instance(parent, name, this.geometry("cylinder", () => new THREE.CylinderGeometry(0.5, 0.5, 1, 10)), color, position, scale);
  }

  pebble(parent: THREE.Group, color: string, position: Point, scale: Point, rotation = 0, name = "faceted-details") {
    this.instance(parent, name, this.geometry("icosahedron", () => new THREE.IcosahedronGeometry(1, 0)), color, position, scale, rotation);
  }

  mesh(parent: THREE.Group, name: string, geometry: THREE.BufferGeometry, color: string, position: Point = [0, 0, 0], roughness = 0.88) {
    const mesh = new THREE.Mesh(geometry, this.material(color, roughness));
    mesh.name = name;
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  solid(parent: THREE.Group, name: string, points: readonly PlanPoint[], top: number, depth: number, color: string) {
    const shape = new THREE.Shape();
    points.forEach(([x, z], index) => index === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z));
    shape.closePath();
    const geometry = this.geometry(name, () => {
      const result = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
      result.rotateX(-Math.PI / 2);
      return result;
    });
    return this.mesh(parent, name, geometry, color, [0, top - depth, 0]);
  }

  hotspot(group: THREE.Object3D, id: string, anchor: Point) {
    group.userData.hotspotId = id;
    group.userData.labelAnchor = [...anchor];
    this.pickTargets.push(group);
  }

  tree(parent: THREE.Group, x: number, z: number, scale = 1, variant = 0, y = 0) {
    this.cylinder(parent, palette.bark, [x, y + 1.2 * scale, z], [0.35 * scale, 2.4 * scale, 0.35 * scale], "tree-trunks");
    const colors = [palette.leaf, palette.leafDark, palette.leafLight];
    this.pebble(parent, colors[variant % colors.length], [x, y + 3.2 * scale, z], [1.45 * scale, 1.7 * scale, 1.35 * scale], variant * 0.7, "tree-crowns");
    this.pebble(parent, colors[(variant + 1) % colors.length], [x - 0.6 * scale, y + 2.8 * scale, z + 0.35 * scale], [0.95 * scale, 1.05 * scale, 1.02 * scale], variant * 0.3, "tree-crowns");
  }

  pine(parent: THREE.Group, x: number, z: number, scale = 1) {
    this.cylinder(parent, palette.bark, [x, 1.7 * scale, z], [0.27 * scale, 3.4 * scale, 0.27 * scale], "pine-trunks");
    for (let i = 0; i < 3; i++) {
      const spread = 1.3 - i * 0.23;
      this.pebble(parent, i % 2 === 0 ? palette.pine : palette.leafDark,
        [x + (i - 1) * 0.33 * scale, (2.5 + i * 0.73) * scale, z - i * 0.2 * scale],
        [spread * scale, 0.63 * scale, spread * scale], i * 0.6, "pine-crowns");
    }
  }

  bench(parent: THREE.Group, x: number, z: number, rotation = 0) {
    const bench = this.makeGroup("park-bench", parent);
    bench.position.set(x, 0, z);
    bench.rotation.y = rotation;
    this.box(bench, palette.metal, [-0.7, 0.35, 0], [0.13, 0.7, 0.6]);
    this.box(bench, palette.metal, [0.7, 0.35, 0], [0.13, 0.7, 0.6]);
    for (const offset of [-0.2, 0, 0.2]) this.box(bench, palette.woodLight, [0, 0.7, offset], [1.9, 0.12, 0.16]);
    this.box(bench, palette.wood, [0, 1.03, -0.28], [1.9, 0.33, 0.1]);
  }

  lamp(parent: THREE.Group, x: number, z: number) {
    this.cylinder(parent, palette.metal, [x, 1.35, z], [0.09, 2.7, 0.09], "lamp-posts");
    this.cylinder(parent, palette.metal, [x, 0.12, z], [0.35, 0.24, 0.35], "lamp-bases");
    this.pebble(parent, palette.cream, [x, 2.8, z], [0.26, 0.34, 0.26], 0, "lamp-globes");
    this.cylinder(parent, palette.metal, [x, 3.04, z], [0.45, 0.08, 0.45], "lamp-caps");
  }

  walk(route: PlanPoint[], count: number, offset = 0) {
    const shirtColors = [palette.coral, palette.cream, palette.mustard, palette.leafDark, palette.glass];
    const lengths = route.map(([x, z], i) => {
      const next = route[(i + 1) % route.length];
      return Math.hypot(next[0] - x, next[1] - z);
    });
    const total = lengths.reduce((a, b) => a + b, 0);
    for (let i = 0; i < count; i++) {
      const person = this.makeGroup(`visitor-${this.walkers.length + 1}`, this.visitors);
      const size = 0.86 + (i % 3) * 0.06;
      person.scale.setScalar(size);
      this.box(person, palette.charcoal, [-0.11, 0.24, 0], [0.15, 0.46, 0.19]);
      this.box(person, palette.charcoal, [0.11, 0.24, 0], [0.15, 0.46, 0.19]);
      this.box(person, shirtColors[(i + offset) % shirtColors.length], [0, 0.67, 0], [0.46, 0.5, 0.29]);
      this.pebble(person, "#e2b897", [0, 1.08, 0], [0.25, 0.28, 0.24]);
      this.pebble(person, palette.charcoal, [0, 1.23, -0.025], [0.26, 0.14, 0.25]);
      if (i % 3 === 1) this.box(person, palette.woodLight, [0.33, 0.44, 0.04], [0.23, 0.3, 0.2]);
      this.walkers.push({ group: person, route, lengths, total, offset: total * (i + 0.3) / count, speed: 0.3 + (i % 3) * 0.055 });
    }
  }

  finish(): DioramaModel {
    const dummy = new THREE.Object3D();
    for (const batch of this.batches.values()) {
      const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.instances.length);
      mesh.name = batch.name;
      batch.instances.forEach((instance, index) => {
        dummy.position.set(...instance.position);
        dummy.scale.set(...instance.scale);
        dummy.rotation.set(0, instance.rotation, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      batch.parent.add(mesh);
      this.instanceMeshes.push(mesh);
    }
    this.batches.clear();
    // The renderer caches static shadows; moving or hidden visitors must not leave shadows behind.
    this.visitors.traverse((object) => { object.castShadow = false; });
    for (const target of this.pickTargets) {
      target.traverse((object) => { object.userData.hotspotId = target.userData.hotspotId; });
    }
    let disposed = false;
    let lastElapsed: number | undefined;
    let wasMoving = false;
    let activeSeconds = 0;
    const placeWalkers = () => {
      for (const walker of this.walkers) {
        let distance = (walker.offset + activeSeconds * walker.speed) % walker.total;
        let segment = 0;
        while (distance > walker.lengths[segment] && segment < walker.route.length - 1) distance -= walker.lengths[segment++];
        const a = walker.route[segment];
        const b = walker.route[(segment + 1) % walker.route.length];
        const t = distance / walker.lengths[segment];
        walker.group.position.set(a[0] + (b[0] - a[0]) * t, 0.08, a[1] + (b[1] - a[1]) * t);
        walker.group.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]);
      }
    };
    placeWalkers();
    this.group.updateMatrixWorld(true);
    return {
      group: this.group,
      visitors: this.visitors,
      pickTargets: this.pickTargets,
      update: (elapsedSeconds, moving) => {
        if (disposed || !Number.isFinite(elapsedSeconds)) return;
        if (moving && wasMoving && lastElapsed !== undefined && elapsedSeconds >= lastElapsed) {
          // Large tab/background gaps do not teleport the decorative crowd.
          activeSeconds += Math.min(elapsedSeconds - lastElapsed, 1);
          placeWalkers();
        }
        lastElapsed = elapsedSeconds;
        wasMoving = moving;
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        for (const mesh of this.instanceMeshes) mesh.dispose();
        for (const geometry of this.geometries.values()) geometry.dispose();
        for (const material of this.materials.values()) material.dispose();
        this.instanceMeshes.length = 0;
        this.geometries.clear();
        this.materials.clear();
        this.walkers.length = 0;
      },
    };
  }
}

const island: readonly PlanPoint[] = [
  [-14.3, -13], [14.3, -13], [16, -11.3], [16, 11.3], [14.3, 13], [-14.3, 13], [-16, 11.3], [-16, -11.3],
];

function terrain(b: ModelBuilder, color: string) {
  const ground = b.makeGroup("terrain-pedestal", b.group);
  b.solid(ground, "island-stone-base", island.map(([x, z]) => [x * 0.975, z * 0.975] as PlanPoint), -0.38, 1.4, palette.soil);
  b.solid(ground, "island-rim", island, -0.06, 0.32, palette.soilLight);
  b.solid(ground, "ground-surface", island, 0, 0.09, color);
  return ground;
}

function street(b: ModelBuilder, parent: THREE.Group, z = 10.6) {
  b.box(parent, "#b7b6a5", [0, 0.035, z], [29, 0.07, 2.6], 0, "street");
  b.box(parent, palette.curb, [0, 0.095, z - 1.45], [29, 0.19, 0.3], 0, "curbs");
  b.box(parent, palette.curb, [0, 0.095, z + 1.45], [28, 0.19, 0.3], 0, "curbs");
  for (let x = -13; x < 14; x += 2.9) b.box(parent, palette.cream, [x, 0.078, z], [1.3, 0.022, 0.07], 0, "road-markings");
  for (let i = 0; i < 6; i++) b.box(parent, palette.cream, [6.4, 0.085, z - 0.95 + i * 0.38], [1.7, 0.03, 0.2], 0, "crosswalk");
}

function museum(b: ModelBuilder) {
  b.group.name = "pangyo-museum-diorama";
  const ground = terrain(b, palette.grass);
  street(b, ground);
  const plaza = b.makeGroup("museum-forecourt", b.group);
  b.box(plaza, palette.path, [0.5, 0.055, 5.4], [23, 0.11, 6.6]);
  b.box(plaza, palette.path, [11.5, 0.04, -1.7], [3.2, 0.08, 14]);
  for (let x = -10; x <= 10; x += 1.35) {
    b.box(plaza, "#d6ccb6", [x, 0.12, 5.4], [0.025, 0.015, 6.3], 0, "plaza-joints");
  }
  for (let z = 2.6; z < 8.7; z += 1.3) b.box(plaza, "#d6ccb6", [0.4, 0.12, z], [22.5, 0.015, 0.025], 0, "plaza-joints");
  const building = b.makeGroup("pangyo-museum-building", b.group);
  b.hotspot(building, "museum-exterior", [2, 5, 3.4]);
  b.box(building, palette.stone, [-0.9, 0.25, -1.55], [21.8, 0.5, 9.3]);
  b.box(building, palette.charcoal, [2.7, 3.57, -1.65], [14.2, 6.5, 8.9]);
  // The reference's uninterrupted upper dark wall is kept dominant over the lower glass bands.
  for (let y = 0.8; y < 6.75; y += 0.24) {
    b.box(building, y > 3.3 ? "#5c686a" : palette.stone, [2.7, y, 2.823], [14.22, 0.046, 0.048], 0, "horizontal-stone-courses");
    b.box(building, "#5c686a", [9.823, y, -1.65], [0.048, 0.046, 8.92], 0, "horizontal-stone-courses");
    b.box(building, "#5c686a", [2.7, y, -6.123], [14.22, 0.046, 0.048], 0, "horizontal-stone-courses");
  }
  for (const y of [0.9, 1.75, 2.62]) {
    b.box(building, palette.cream, [3.6, y, 2.86], [11.8, 0.68, 0.09], 0, "window-surrounds");
    b.box(building, palette.glass, [3.6, y, 2.92], [11.5, 0.44, 0.04], 0, "museum-glass-bands");
    b.box(building, palette.glass, [9.86, y, -1.48], [0.045, 0.46, 8.4], 0, "museum-glass-bands");
    for (let x = -1.8; x < 9.2; x += 1.32) b.box(building, palette.stone, [x, y, 2.96], [0.075, 0.47, 0.075], 0, "window-mullions");
    for (let z = -5.3; z < 2.6; z += 1.4) b.box(building, palette.stone, [9.91, y, z], [0.075, 0.5, 0.075], 0, "window-mullions");
  }
  b.box(building, palette.wood, [-6.9, 3.68, -1.1], [4.6, 6.7, 8.2]);
  for (let y = 0.52; y < 7; y += 0.29) b.box(building, palette.woodLight, [-6.9, y, 3.026], [4.57, 0.055, 0.05], 0, "timber-cladding");
  for (const x of [-9.24, -7.7, -6.1, -4.54]) b.box(building, "#745d4d", [x, 3.72, 3.08], [0.14, 7.02, 0.24], 0, "timber-piers");
  b.box(building, palette.glass, [-10.55, 3.1, -1.9], [2.05, 5.5, 7.45]);
  for (let y = 0.72; y < 5.7; y += 1.05) b.box(building, palette.metal, [-10.55, y, 1.84], [2.1, 0.06, 0.07], 0, "atrium-glazing-frames");
  for (const x of [-11.56, -10.55, -9.52]) b.box(building, palette.metal, [x, 3.1, 1.87], [0.06, 5.5, 0.07], 0, "atrium-glazing-frames");
  b.box(building, "#aeb5ad", [2.7, 6.92, -1.65], [14.6, 0.2, 9.25], 0, "flat-roof-coping");
  b.box(building, "#737f7c", [2.7, 7.045, -1.65], [13.98, 0.055, 8.67], 0, "flat-roof");
  b.box(building, "#745d4d", [-6.9, 7.08, -1.1], [5.05, 0.2, 8.55], 0, "timber-roof-coping");
  b.box(building, "#aeb5ad", [-10.55, 5.93, -1.9], [2.24, 0.13, 7.6]);
  // An abstract bronze plaque gives the real facade's relief a restrained visual counterpart.
  for (let i = 0; i < 7; i++) b.box(building, "#b99b6c", [1.3 + i * 0.55, 4.48 + Math.abs(i - 3) * 0.095, 2.97], [0.49, 0.47, 0.12], 0, "bronze-facade-relief");
  b.box(building, palette.cream, [3, 5.23, 2.98], [4.75, 0.12, 0.08], 0, "facade-sign-bar");
  for (let i = 0; i < 8; i++) b.box(building, palette.cream, [0.85 + i * 0.6, 5.54, 2.99], [0.36, 0.4, 0.07], 0, "facade-sign-forms");
  // Ground-level entrance is a facade opening, with no fabricated interior behind it.
  b.box(building, palette.cream, [6.1, 1.74, 3.04], [2, 3, 0.25]);
  b.box(building, palette.glass, [6.1, 1.53, 3.19], [1.62, 2.55, 0.07]);
  b.box(building, palette.stone, [6.1, 1.53, 3.25], [0.08, 2.55, 0.05]);
  b.box(building, palette.cream, [6.1, 3.18, 3.56], [2.4, 0.17, 1.38]);
  for (let i = 0; i < 3; i++) b.box(building, palette.curb, [6.1, 0.12 + i * 0.1, 4.14 - i * 0.33], [2.7, 0.2, 0.75], 0, "entrance-steps");

  const garden = b.makeGroup("museum-garden", b.group);
  b.hotspot(garden, "museum-garden", [-9, 1.2, 6.5]);
  b.box(garden, palette.grassDark, [-8.6, 0.1, 6.4], [5.4, 0.2, 2.5], 0, "garden-bed");
  b.box(garden, palette.soilLight, [-8.6, 0.16, 7.7], [5.6, 0.32, 0.17], 0, "garden-edge");
  b.pine(garden, -10.2, 6.5, 1);
  b.pine(garden, -6.75, 6.8, 0.86);
  for (let i = 0; i < 10; i++) b.pebble(garden, i % 3 === 0 ? palette.mustard : palette.leafLight, [-10.8 + i * 0.5, 0.42, 7.16], [0.34, 0.32, 0.28], i * 0.4, "low-garden-planting");
  const landscape = b.makeGroup("museum-surrounding-trees", b.group);
  [[-13.6, -9, 1.03], [-13.3, -4, 0.9], [-13.1, 1.3, 0.92], [12.8, -8.1, 0.92], [13.2, -3.7, 0.82], [13.4, 1.2, 0.8], [-7.5, -10.5, 0.8], [-2, -10.5, 0.92], [3.8, -10.5, 0.86], [10, -10.4, 0.8]].forEach(([x, z, s], i) => b.tree(landscape, x, z, s, i));
  b.bench(plaza, -2.9, 7.4);
  b.bench(plaza, 9.4, 6.7, -Math.PI / 2);
  b.lamp(plaza, -3.8, 4.2);
  b.lamp(plaza, 11.3, 5.2);
  b.walk([[-3, 7.3], [4.5, 7.3], [9.6, 5.5], [1.6, 5.5]], 5);
}

function koreanRoof(b: ModelBuilder, parent: THREE.Group, width: number, depth: number, y: number, key: string) {
  const geometry = b.geometry(key, () => {
    const ring: PlanPoint[] = [[-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0]];
    const rings = ring.map(([x, z], i) => [x * width / 2, i % 2 === 0 ? 0.17 : 0, z * depth / 2]);
    for (const [x, z] of ring) rings.push([x * width * 0.36, 0.48, z * depth * 0.36]);
    for (const [x, z] of ring) rings.push([x * width * 0.23, 1.32, z * 0.13]);
    const vertices: number[] = [];
    const triangle = (a: number[], c: number[], d: number[]) => vertices.push(...a, ...c, ...d);
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 8; i++) {
        const next = (i + 1) % 8;
        triangle(rings[row * 8 + i], rings[row * 8 + next], rings[(row + 1) * 8 + i]);
        triangle(rings[row * 8 + next], rings[(row + 1) * 8 + next], rings[(row + 1) * 8 + i]);
      }
    }
    for (let i = 0; i < 8; i++) triangle(rings[16 + i], rings[16 + (i + 1) % 8], [0, 1.36, 0]);
    const result = new THREE.BufferGeometry();
    result.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    result.computeVertexNormals();
    return result;
  });
  const roof = b.mesh(parent, "curved-tile-roof", geometry, palette.charcoal, [0, y, 0]);
  roof.material.side = THREE.DoubleSide;
  b.box(parent, "#697677", [0, y + 1.4, 0], [width * 0.54, 0.15, 0.32], 0, "roof-ridge");
  for (const side of [-1, 1]) {
    b.box(parent, "#899495", [0, y + 0.005, side * depth / 2], [width - 0.3, 0.1, 0.09], 0, "roof-eave-trim");
    for (let x = -width / 2 + 0.25; x < width / 2; x += 0.33) {
      b.cylinder(parent, "#899495", [x, y + 0.035, side * (depth / 2 - 0.03)], [0.17, 0.12, 0.17], "tile-end-caps");
    }
  }
}

function pavilion(b: ModelBuilder) {
  const pavilion = b.makeGroup("lakeside-korean-pavilion", b.group);
  pavilion.position.set(-3.8, 0, -3);
  b.hotspot(pavilion, "park-pavilion", [-3.8, 3.5, -2.8]);
  b.box(pavilion, palette.stone, [0, 0.33, 0], [5.7, 0.66, 4.55]);
  b.box(pavilion, palette.curb, [0, 0.69, 0], [5.9, 0.16, 4.7]);
  b.box(pavilion, palette.wood, [0, 0.87, 0], [5.45, 0.2, 4.22]);
  for (const x of [-2.25, 0, 2.25]) {
    for (const z of [-1.65, 1.65]) {
      b.cylinder(pavilion, palette.stone, [x, 1.01, z], [0.54, 0.2, 0.54]);
      b.cylinder(pavilion, "#875c4e", [x, 2.2, z], [0.28, 2.5, 0.28], "pavilion-columns");
      b.box(pavilion, palette.leafDark, [x, 3.27, z], [0.68, 0.14, 0.62], 0, "painted-brackets");
      b.box(pavilion, "#b66d52", [x, 3.48, z], [0.95, 0.15, 0.84], 0, "painted-brackets");
    }
  }
  for (const z of [-1.69, 1.69]) {
    b.box(pavilion, palette.leafDark, [0, 3.15, z], [5.25, 0.27, 0.22]);
    b.box(pavilion, palette.woodLight, [0, 1.52, z], [5.25, 0.1, 0.11]);
    for (let x = -2.5; x <= 2.5; x += 0.42) b.box(pavilion, palette.woodLight, [x, 1.24, z], [0.07, 0.55, 0.07], 0, "pavilion-balustrade");
  }
  for (const x of [-2.6, 2.6]) {
    b.box(pavilion, palette.leafDark, [x, 3.15, 0], [0.22, 0.27, 3.6]);
    b.box(pavilion, palette.woodLight, [x, 1.52, 0], [0.11, 0.1, 3.5]);
    for (let z = -1.4; z <= 1.4; z += 0.4) b.box(pavilion, palette.woodLight, [x, 1.24, z], [0.07, 0.55, 0.07], 0, "pavilion-balustrade");
  }
  koreanRoof(b, pavilion, 7.2, 5.9, 3.5, "pavilion-roof-geometry");
  b.box(pavilion, palette.leafDark, [0, 3.1, 1.85], [1.4, 0.47, 0.12], 0, "pavilion-signboard");
  for (let i = 0; i < 4; i++) b.box(pavilion, palette.curb, [0, 0.1 + i * 0.16, 3.27 - i * 0.28], [1.65, 0.18, 0.6], 0, "pavilion-steps");
}

function park(b: ModelBuilder) {
  b.group.name = "central-park-diorama";
  terrain(b, palette.grassLight);
  const parkland = b.makeGroup("parkland-and-walking-loop", b.group);
  const shore: readonly PlanPoint[] = [[-10.9, 1], [-10.1, -3.5], [-7.5, -5.8], [-2.1, -6.9], [3.7, -6.5], [8, -4.5], [10.9, -1.5], [11, 2], [8, 5.5], [2.7, 6.9], [-2, 6.5], [-7.5, 4.8]];
  b.solid(parkland, "lake-walking-loop", shore.map(([x, z]) => [x * 1.17, z * 1.23] as PlanPoint), 0.035, 0.08, palette.path);
  b.solid(parkland, "inner-grass-bank", shore.map(([x, z]) => [x * 1.06, z * 1.08] as PlanPoint), 0.07, 0.08, palette.grassDark);
  b.solid(parkland, "stone-shoreline", shore, 0.1, 0.14, palette.soilLight);
  const lake = b.solid(parkland, "central-park-lake", shore.map(([x, z]) => [x * 0.966, z * 0.955] as PlanPoint), 0.13, 0.1, palette.water);
  b.hotspot(lake, "park-lake", [2, 0.3, 1]);
  lake.material.roughness = 0.48;
  lake.castShadow = false;
  const ripples = b.makeGroup("still-water-highlights", b.group);
  [[3.5, 1.9, 2], [6, 0.8, 1.25], [2.7, 3.8, 1.6], [6.5, -2.8, 1.1], [-6.8, 2.2, 1.3], [0.8, -4.8, 1.4], [0.6, 0, 0.65]].forEach(([x, z, length]) => {
    b.box(ripples, palette.waterLight, [x, 0.145, z], [length, 0.015, 0.045], -0.2, "water-ripples");
    b.box(ripples, palette.waterLight, [x + 0.26, 0.145, z + 0.22], [length * 0.46, 0.015, 0.035], -0.2, "water-ripples");
  });
  const pavilionIsland = [[-8, -5.9], [-0.7, -5.9], [-0.2, -3.4], [-0.5, 0.3], [-3.5, 0.9], [-7.7, -0.2]] as const;
  b.solid(parkland, "pavilion-island-stone", pavilionIsland, 0.26, 0.22, palette.stone);
  b.solid(parkland, "pavilion-island-lawn", pavilionIsland.map(([x, z]) => [x * 0.99 - 0.04, z * 0.98 - 0.04] as PlanPoint), 0.3, 0.04, palette.grass);
  pavilion(b);
  const bridge = b.makeGroup("garden-footbridge", b.group);
  bridge.position.set(-3.6, 0, 4.05);
  b.box(bridge, palette.woodLight, [0, 0.53, 0], [1.9, 0.22, 6.5]);
  for (let z = -3.1; z < 3.3; z += 0.3) b.box(bridge, palette.wood, [0, 0.655, z], [1.9, 0.025, 0.045], 0, "bridge-planks");
  for (const x of [-0.92, 0.92]) {
    b.box(bridge, palette.curb, [x, 1.18, 0], [0.11, 0.12, 6.5]);
    for (let z = -3; z <= 3; z += 0.75) b.box(bridge, palette.curb, [x, 0.91, z], [0.12, 0.66, 0.12], 0, "bridge-railings");
  }
  const forest = b.makeGroup("faceted-park-forest", b.group);
  const trees = [[-13.2,-9.4,1],[-10,-9.7,1.1],[-6.5,-10.5,1.07],[-3,-10.2,1.05],[0.5,-10.5,1.12],[4,-10.2,1.2],[7.5,-9.7,1.03],[11,-9.8,1.11],[13,-6.8,0.95],[13.8,-3.2,0.8],[13.8,0.8,0.86],[12.9,5,0.8],[10,8,0.74],[13,9.7,0.66],[7.7,10.3,0.68],[3.5,10.5,0.63],[-0.3,10.6,0.58],[-6.8,9.8,0.62],[-10,8.7,0.79],[-13.2,6.5,0.95],[-13.8,2.8,0.92],[-13.8,-1.7,0.89],[-13.5,-5.4,0.94]];
  trees.forEach(([x,z,s], i) => b.tree(forest,x,z,s,i));
  for (let i = 0; i < 15; i++) {
    const angle = i / 15 * Math.PI * 2;
    b.pebble(forest, i % 2 ? palette.leafLight : palette.leaf, [Math.cos(angle) * 12.8, 0.3, Math.sin(angle) * 9.5], [0.54, 0.38, 0.6], angle, "low-shore-planting");
  }
  b.bench(parkland, 3.7, 8.7, Math.PI);
  b.bench(parkland, 10.2, 5.8, -Math.PI / 3);
  b.bench(parkland, -11, -5.3, Math.PI / 2);
  b.lamp(parkland, -7.8, 7.5);
  b.lamp(parkland, 8.5, 7.1);
  b.walk([[-7, 6.8], [-2.2, 8.05], [3, 8.3], [8.9, 6.25], [11.8, 2.25], [11.8, -1.9], [8.6, -5.65], [4, -7.9], [-2.3, -8.3], [-8.4, -7], [-11.75, -3.8], [-12.25, 1]], 7, 2);
}

function tentGeometry(b: ModelBuilder) {
  return b.geometry("market-canopy-geometry", () => {
    const vertices = [
      -1.8,0,-1.65, 1.8,0,-1.65, 1.8,0.95,0, -1.8,0,-1.65, 1.8,0.95,0, -1.8,0.95,0,
      -1.8,0.95,0, 1.8,0.95,0, 1.8,0,1.65, -1.8,0.95,0, 1.8,0,1.65, -1.8,0,1.65,
      -1.8,0,-1.65, -1.8,0.95,0, -1.8,0,1.65, 1.8,0,1.65, 1.8,0.95,0, 1.8,0,-1.65,
    ];
    const geometry = new THREE.BufferGeometry();
    // The authored strips run clockwise from above; reverse each face to expose the roof exterior.
    for (let i = 0; i < vertices.length; i += 9) {
      for (let axis = 0; axis < 3; axis++) {
        [vertices[i + 3 + axis], vertices[i + 6 + axis]] = [vertices[i + 6 + axis], vertices[i + 3 + axis]];
      }
    }
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    return geometry;
  });
}

function market(b: ModelBuilder) {
  b.group.name = "moran-market-diorama";
  const ground = terrain(b, palette.path);
  street(b, ground, 10.8);
  const stalls = b.makeGroup("moran-colorful-canopy-stalls", b.group);
  b.hotspot(stalls, "market-stalls", [-5, 2.8, 3.5]);
  const aisle = b.makeGroup("moran-market-walking-aisle", b.group);
  b.hotspot(aisle, "market-aisle", [0, 0.5, 3]);
  b.box(aisle, "#d7c8aa", [0, 0.035, -0.2], [3.2, 0.07, 18], 0, "central-market-aisle");
  b.box(aisle, "#d7c8aa", [0, 0.04, 6.6], [27, 0.08, 2.2], 0, "market-forecourt");
  const colors = [palette.coral, palette.mustard, palette.glass, palette.leafDark, "#c27468", "#8ea888"];
  const columns = [-10.6, -6.1, 6.1, 10.6];
  const rows = [-6.8, -2.3, 2.2];
  const canopy = tentGeometry(b);
  for (let row = 0; row < rows.length; row++) {
    for (let col = 0; col < columns.length; col++) {
      const x = columns[col], z = rows[row];
      const color = colors[(row * 2 + col) % colors.length];
      b.instance(stalls, "colorful-market-canopies", canopy, color, [x, 2.65, z]);
      b.box(stalls, color, [x, 2.5, z + 1.66], [3.6, 0.31, 0.07], 0, "canopy-valances");
      b.box(stalls, color, [x, 2.5, z - 1.66], [3.6, 0.31, 0.07], 0, "canopy-valances");
      // A narrow cream stripe and pale end trim keep the colored roofs readable at overview scale.
      b.box(stalls, palette.cream, [x, 3.62, z], [3.62, 0.07, 0.16], 0, "canopy-ridge-trim");
      for (const dx of [-1.57, 1.57]) {
        for (const dz of [-1.38, 1.38]) b.cylinder(stalls, palette.metal, [x + dx, 1.28, z + dz], [0.075, 2.56, 0.075], "stall-poles");
      }
      b.box(stalls, palette.wood, [x, 0.71, z + 0.45], [3.17, 0.22, 1.05], 0, "market-countertops");
      b.box(stalls, "#a68b63", [x, 0.35, z + 0.64], [3, 0.63, 0.15], 0, "counter-fronts");
      for (const dx of [-1.2, 1.2]) b.box(stalls, palette.metal, [x + dx, 0.35, z + 0.3], [0.13, 0.7, 0.73], 0, "counter-legs");
      for (let item = 0; item < 4; item++) {
        const dx = -1.12 + item * 0.74;
        const grainColor = [palette.mustard, palette.cream, "#65745d", "#93665b"][(item + col + row) % 4];
        b.cylinder(stalls, item % 2 ? palette.coral : palette.cream, [x + dx, 0.99, z + 0.42], [0.65, 0.35, 0.65], "grain-baskets");
        b.pebble(stalls, grainColor, [x + dx, 1.16, z + 0.42], [0.28, 0.11, 0.28], item * 0.4, "grain-mounds");
        b.box(stalls, palette.cream, [x + dx, 1.32, z + 0.15], [0.2, 0.24, 0.035], 0, "produce-cards");
      }
      for (const dx of [-1.04, 0, 1.04]) {
        b.cylinder(stalls, dx === 0 ? palette.mustard : palette.cream, [x + dx, 0.37, z + 1.2], [0.64, 0.65, 0.62], "front-grain-sacks");
        b.pebble(stalls, dx === 0 ? palette.cream : "#65745d", [x + dx, 0.7, z + 1.2], [0.28, 0.09, 0.26], dx, "sack-grain");
      }
    }
  }
  const surroundings = b.makeGroup("schematic-market-neighborhood", b.group);
  // Restrained background masses give scale; these are not named or surveyed real buildings.
  [[-10.2,3.2,5.7],[-4.4,2.8,4.9],[2.1,3.4,5.1],[8.8,2.8,4.6]].forEach(([x,width,height], i) => {
    b.box(surroundings, i % 2 ? "#e2d3b7" : "#ede2c9", [x, height / 2, -11.2], [width, height, 2.6], 0, "background-shop-blocks");
    b.box(surroundings, palette.soilLight, [x, height + 0.1, -11.2], [width + 0.24, 0.2, 2.8], 0, "shop-flat-roofs");
    for (let y = 1.5; y < height - 0.4; y += 1.2) {
      for (const dx of [-0.8, 0.8]) b.box(surroundings, palette.glass, [x + dx, y, -9.88], [0.66, 0.69, 0.07], 0, "background-shop-windows");
    }
    b.box(surroundings, colors[i], [x, 1.1, -9.69], [width - 0.35, 0.33, 0.42], 0, "shop-awning");
  });
  // A modest decorative entrance frame anchors the front without inventing a monumental gate.
  for (const x of [-1.9, 1.9]) b.box(surroundings, palette.wood, [x, 1.78, 7.55], [0.19, 3.56, 0.19], 0, "market-entry-posts");
  b.box(surroundings, palette.leafDark, [0, 3.35, 7.55], [4.22, 0.68, 0.2], 0, "market-entry-board");
  for (let i = 0; i < 5; i++) b.box(surroundings, palette.cream, [-1.2 + i * 0.6, 3.35, 7.675], [0.29, 0.29, 0.04], 0, "market-entry-sign-forms");
  b.tree(surroundings, -13.9, 6.9, 0.78, 1);
  b.tree(surroundings, 13.9, 6.9, 0.78, 2);
  b.lamp(surroundings, -8.8, 8.1);
  b.lamp(surroundings, 8.8, 8.1);
  b.bench(surroundings, -4.2, 8.15);
  b.walk([[-0.75, 6.5], [-0.75, -8.5], [0.75, -8.5], [0.75, 6.5]], 7, 1);
  b.walk([[-12, 6.5], [-3, 6.5], [-3, 5.7], [-12, 5.7]], 3, 3);
}

/** Build a deterministic, self-contained, low-poly interpretation of one Seongnam place. */
export function buildDiorama(placeId: PlaceId): DioramaModel {
  const builder = new ModelBuilder();
  if (placeId === "pangyo-museum") museum(builder);
  else if (placeId === "central-park") park(builder);
  else market(builder);
  return builder.finish();
}
