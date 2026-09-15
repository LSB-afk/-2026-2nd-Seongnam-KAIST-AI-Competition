import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildCityLife, type LifeRoute } from "@/lib/diorama/city-life";

const routes: LifeRoute[] = [
  { id: "north-street", points: [[-5, 0.1, -2], [0, 0.1, -2], [0, 0.1, 3]], width: 0.14, pedestrian: true, vehicle: true },
  { id: "south-path", points: [[5, 0.2, 6], [9, 0.2, 6]], width: 0.08, pedestrian: true, vehicle: false },
  { id: "east-road", points: [[12, 0.15, 1], [12, 0.15, 7]], width: 0.18, pedestrian: false, vehicle: true },
];

function instances(group: THREE.Group) {
  const meshes: THREE.InstancedMesh[] = [];
  group.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) meshes.push(object);
    else if (object instanceof THREE.Mesh) throw new Error("City actors must be instanced");
  });
  return meshes;
}

function snapshot(group: THREE.Group) {
  return instances(group).map((mesh) => Array.from(mesh.instanceMatrix.array.slice(0, mesh.count * 16)));
}

function position(mesh: THREE.InstancedMesh, index: number) {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return new THREE.Vector3().setFromMatrixPosition(matrix);
}

function scale(mesh: THREE.InstancedMesh, index: number) {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return new THREE.Vector3().setFromMatrixScale(matrix);
}

describe("instanced decorative city life", () => {
  it("draws a busy deterministic crowd with bounded resources and readable colored silhouettes", () => {
    const life = buildCityLife(routes);
    const duplicate = buildCityLife(routes);
    try {
      expect(life.counts.people).toBeGreaterThanOrEqual(1000);
      expect(life.counts.vehicles).toBeGreaterThanOrEqual(400);
      const meshes = [...instances(life.people), ...instances(life.traffic)];
      expect(meshes.length).toBeLessThanOrEqual(20);
      expect(new Set(meshes.map((mesh) => mesh.geometry)).size).toBeLessThanOrEqual(4);
      expect(new Set(meshes.map((mesh) => mesh.material)).size).toBeLessThanOrEqual(3);
      expect(meshes.every((mesh) => !mesh.castShadow)).toBe(true);
      expect(meshes.every((mesh) => mesh.instanceColor !== null)).toBe(true);
      expect(snapshot(life.people)).toEqual(snapshot(duplicate.people));
      expect(snapshot(life.traffic)).toEqual(snapshot(duplicate.traffic));
      const bodies = life.people.getObjectByName("city-person-bodies") as THREE.InstancedMesh;
      expect(bodies.count).toBe(life.counts.people);
      expect(scale(bodies, 0).y).toBeGreaterThan(0.02);
      const colorValues = bodies.instanceColor!.array;
      const colors = new Set(Array.from({ length: bodies.count }, (_, i) => Array.from(colorValues.slice(i * 3, i * 3 + 3)).join(",")));
      expect(colors.size).toBeGreaterThan(5);
    } finally { life.dispose(); duplicate.dispose(); }
  });

  it("follows the supplied polylines without crossing the empty space between their endpoints", () => {
    const life = buildCityLife(routes);
    try {
      life.update(0, true);
      const before = snapshot(life.people);
      for (let second = 1; second <= 30; second++) life.update(second, true);
      expect(snapshot(life.people)).not.toEqual(before);
      const bodies = life.people.getObjectByName("city-person-bodies") as THREE.InstancedMesh;
      let north = 0, south = 0;
      for (let i = 0; i < bodies.count; i++) {
        const { x, y, z } = position(bodies, i);
        const onNorth = (x >= -5.12 && x <= 0.12 && Math.abs(z + 2) < 0.12)
          || (Math.abs(x) < 0.12 && z >= -2.12 && z <= 3.12);
        const onSouth = x >= 4.9 && x <= 9.1 && Math.abs(z - 6) < 0.1;
        expect(onNorth || onSouth, `off-path person at ${x}, ${z}`).toBe(true);
        expect(y).toBeGreaterThan(0.1);
        if (onNorth) north++;
        if (onSouth) south++;
      }
      expect(north).toBeGreaterThan(100);
      expect(south).toBeGreaterThan(100);
      const cars = life.traffic.getObjectByName("city-vehicle-bodies") as THREE.InstancedMesh;
      for (let i = 0; i < cars.count; i++) {
        const { x, z } = position(cars, i);
        const onNorth = (x >= -5.12 && x <= 0.12 && Math.abs(z + 2) < 0.12)
          || (Math.abs(x) < 0.12 && z >= -2.12 && z <= 3.12);
        const onEast = Math.abs(x - 12) < 0.12 && z >= 0.9 && z <= 7.1;
        expect(onNorth || onEast, `off-road car at ${x}, ${z}`).toBe(true);
      }
      for (const group of [life.people, life.traffic]) {
        const bounds = new THREE.Box3().setFromObject(group);
        expect(bounds.isEmpty()).toBe(false);
        expect([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)).toBe(true);
        expect(bounds.min.x).toBeGreaterThan(-5.5);
        expect(bounds.max.x).toBeLessThan(12.5);
        expect(bounds.min.z).toBeGreaterThan(-2.5);
        expect(bounds.max.z).toBeLessThan(7.5);
      }
    } finally { life.dispose(); }
  });

  it("keeps one-way vehicles facing forward and invisible when crossing an open-route seam", () => {
    const life = buildCityLife([{ id: "one-way", points: [[0, 0, 0], [0.6, 0, 0]], width: 0.1, pedestrian: false, vehicle: true, oneway: true }]);
    try {
      life.configure({ density: 0.04 });
      life.update(0, true);
      const bodies = life.traffic.getObjectByName("city-vehicle-bodies") as THREE.InstancedMesh;
      let wraps = 0;
      for (let second = 1; second <= 20; second++) {
        const previous = Array.from({ length: bodies.count }, (_, index) => ({ x: position(bodies, index).x, size: scale(bodies, index).x }));
        life.update(second, true);
        for (let index = 0; index < bodies.count; index++) {
          const x = position(bodies, index).x, size = scale(bodies, index).x;
          const matrix = new THREE.Matrix4();
          bodies.getMatrixAt(index, matrix);
          expect(matrix.elements[8]).toBeGreaterThanOrEqual(0);
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(0.6);
          if (x < previous[index].x) {
            wraps++;
            expect(previous[index].size === 0 || size === 0, "A visible car jumped from the route end to its start").toBe(true);
          }
        }
      }
      expect(wraps).toBeGreaterThan(0);
    } finally { life.dispose(); }
  });

  it("loops a closed route continuously while an open route turns back at its actual end", () => {
    for (const points of [
      [[0, 0, 0], [0.3, 0, 0], [0.3, 0, 0.3], [0, 0, 0.3], [0, 0, 0]],
      [[0, 0, 0], [0.3, 0, 0], [0.3, 0, 0.3]],
    ] as const) {
      const life = buildCityLife([{ id: "corners", points, width: 0.04, pedestrian: true, vehicle: true }]);
      try {
        life.configure({ density: 0.025 });
        life.update(0, true);
        for (let frame = 1; frame <= 300; frame++) {
          const bodies = life.traffic.getObjectByName("city-vehicle-bodies") as THREE.InstancedMesh;
          const previous = Array.from({ length: bodies.count }, (_, i) => position(bodies, i));
          life.update(frame / 10, true);
          for (let i = 0; i < bodies.count; i++) expect(position(bodies, i).distanceTo(previous[i])).toBeLessThan(0.025);
        }
      } finally { life.dispose(); }
    }
  });

  it("freezes people and traffic independently and resumes without consuming hidden or paused time", () => {
    const life = buildCityLife(routes);
    try {
      life.update(0, true);
      life.update(1, true);
      const people = snapshot(life.people), traffic = snapshot(life.traffic);
      life.people.visible = false;
      life.update(2, true);
      expect(snapshot(life.people)).toEqual(people);
      expect(snapshot(life.traffic)).not.toEqual(traffic);
      life.update(50, true);
      life.people.visible = true;
      life.update(51, true);
      expect(snapshot(life.people)).toEqual(people);
      life.update(52, true);
      expect(snapshot(life.people)).not.toEqual(people);
      const walked = snapshot(life.people), driven = snapshot(life.traffic);
      life.update(80, false);
      life.update(100, false);
      life.update(101, true);
      expect(snapshot(life.people)).toEqual(walked);
      expect(snapshot(life.traffic)).toEqual(driven);
      life.update(102, true);
      expect(snapshot(life.people)).not.toEqual(walked);
      life.traffic.visible = false;
      const stoppedCars = snapshot(life.traffic);
      life.update(103, true);
      life.traffic.visible = true;
      life.update(150, true);
      expect(snapshot(life.traffic)).toEqual(stoppedCars);
    } finally { life.dispose(); }
  });

  it("ignores invalid clocks and rebases backwards clocks without a catch-up jump", () => {
    const life = buildCityLife(routes);
    const reference = buildCityLife(routes);
    try {
      for (const model of [life, reference]) { model.update(0, true); model.update(1, true); }
      const before = snapshot(life.people);
      life.update(Number.NaN, true);
      life.update(Infinity, true);
      life.update(-10, true);
      expect(snapshot(life.people)).toEqual(before);
      life.update(-9, true);
      reference.update(2, true);
      expect(snapshot(life.people)).toEqual(snapshot(reference.people));
      life.update(10000, true);
      reference.update(3, true);
      expect(snapshot(life.people)).toEqual(snapshot(reference.people));
    } finally { life.dispose(); reference.dispose(); }
  });

  it("changes density and person size without reallocating instance buffers", () => {
    const life = buildCityLife(routes);
    try {
      const meshes = [...instances(life.people), ...instances(life.traffic)];
      const buffers = meshes.map((mesh) => mesh.instanceMatrix.array);
      const initialPeople = life.counts.people, initialCars = life.counts.vehicles;
      const bodies = life.people.getObjectByName("city-person-bodies") as THREE.InstancedMesh;
      const initialHeight = scale(bodies, 0).y;
      life.configure({ density: 0.5, peopleScale: 2.4 });
      expect(life.counts).toEqual({ people: initialPeople / 2, vehicles: initialCars / 2 });
      expect(bodies.count).toBe(life.counts.people);
      expect(scale(bodies, 0).y).toBeGreaterThan(initialHeight);
      life.configure({ density: 100, peopleScale: 100 });
      expect(life.counts.people).toBeLessThanOrEqual(initialPeople * 2);
      expect(life.counts.vehicles).toBeLessThanOrEqual(initialCars * 2);
      expect(scale(bodies, 0).y).toBeLessThan(0.1);
      life.configure({ density: Number.NaN, peopleScale: Infinity });
      expect(snapshot(life.people).flat().every(Number.isFinite)).toBe(true);
      meshes.forEach((mesh, index) => expect(mesh.instanceMatrix.array).toBe(buffers[index]));
      life.configure({ density: 0, peopleScale: 1 });
      expect(life.counts).toEqual({ people: 0, vehicles: 0 });
      expect(meshes.every((mesh) => mesh.count === 0)).toBe(true);
    } finally { life.dispose(); }
  });

  it("adds landmark footfall to nearby supplied paths without inventing routes", () => {
    const nearby: LifeRoute[] = [
      { id: "near", points: [[0, 0, 0], [1, 0, 0]], width: 0.06, pedestrian: true, vehicle: false },
      { id: "far", points: [[40, 0, 0], [41, 0, 0]], width: 0.06, pedestrian: true, vehicle: false },
    ];
    const plain = buildCityLife(nearby);
    const clustered = buildCityLife(nearby, [[0.5, 0, 0]]);
    const nearCount = (model: typeof plain) => {
      const bodies = model.people.getObjectByName("city-person-bodies") as THREE.InstancedMesh;
      return Array.from({ length: bodies.count }, (_, i) => position(bodies, i)).filter((p) => p.x < 2).length;
    };
    try {
      expect(nearCount(clustered)).toBeGreaterThan(nearCount(plain) * 1.2);
      expect(clustered.counts.vehicles).toBe(0);
      expect(clustered.counts.people - nearCount(clustered)).toBeGreaterThan(100);
    } finally { plain.dispose(); clustered.dispose(); }
  });

  it("rejects unusable routes without bridging invalid points", () => {
    const life = buildCityLife([
      { ...routes[0], points: [[0, 0, 0]] },
      { ...routes[0], id: "duplicate", points: [[0, 0, 0], [0, 0, 0]] },
      { ...routes[0], id: "invalid", points: [[0, 0, 0], [Number.NaN, 0, 0], [10, 0, 0]] },
      { ...routes[0], id: "disabled", pedestrian: false, vehicle: false },
    ]);
    try {
      expect(life.counts).toEqual({ people: 0, vehicles: 0 });
      expect(() => { life.update(0, true); life.configure({ density: 2, peopleScale: 2 }); }).not.toThrow();
      expect([...instances(life.people), ...instances(life.traffic)].every((mesh) => mesh.count === 0)).toBe(true);
    } finally { life.dispose(); }
  });

  it("disposes owned mesh buffers, shared geometries and materials exactly once", () => {
    const life = buildCityLife(routes);
    const other = buildCityLife(routes);
    const meshes = [...instances(life.people), ...instances(life.traffic)];
    const owned = new Set<THREE.InstancedMesh | THREE.BufferGeometry | THREE.Material>();
    for (const mesh of meshes) {
      owned.add(mesh); owned.add(mesh.geometry);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) owned.add(material);
    }
    const disposals = new Map<object, number>();
    for (const resource of owned) {
      disposals.set(resource, 0);
      const onDispose = () => { disposals.set(resource, disposals.get(resource)! + 1); };
      if (resource instanceof THREE.InstancedMesh) resource.addEventListener("dispose", onDispose);
      else if (resource instanceof THREE.BufferGeometry) resource.addEventListener("dispose", onDispose);
      else resource.addEventListener("dispose", onDispose);
    }
    let otherDisposals = 0;
    for (const mesh of [...instances(other.people), ...instances(other.traffic)]) mesh.addEventListener("dispose", () => otherDisposals++);
    life.dispose(); life.dispose();
    expect([...disposals.values()].every((count) => count === 1)).toBe(true);
    expect(otherDisposals).toBe(0);
    expect(() => { life.update(50, true); life.configure({ density: 2, peopleScale: 2 }); }).not.toThrow();
    other.dispose();
  });
});
