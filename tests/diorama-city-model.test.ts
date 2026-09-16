import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildCityModel } from "@/lib/diorama/city-model";
import { CITY_DISTRICTS, CITY_LANDMARKS, projectCityCoordinate } from "@/lib/diorama/city-data";
import { loopRibbon } from "@/lib/diorama/city-model-assets";
import boundaries from "@/lib/diorama/seongnam-boundaries.json";

function resources(group: THREE.Group) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const instances = new Set<THREE.InstancedMesh>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    if (object instanceof THREE.InstancedMesh) instances.add(object);
  });
  return { geometries, materials, instances };
}

function insideRing(x: number, z: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, , az] = projectCityCoordinate(ring[i][0], ring[i][1]);
    const [bx, , bz] = projectCityCoordinate(ring[j][0], ring[j][1]);
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

function matrices(group: THREE.Group) {
  group.updateMatrixWorld(true);
  const values: number[][] = [];
  group.traverse((object) => {
    values.push(object.matrixWorld.toArray());
    if (object instanceof THREE.InstancedMesh) values.push(Array.from(object.instanceMatrix.array));
  });
  return values;
}

describe("continuous Seongnam city model", () => {
  it("covers the supplied district polygons rather than separate landmark islands", () => {
    const model = buildCityModel();
    try {
      model.group.updateMatrixWorld(true);
      for (const district of CITY_DISTRICTS) {
        const land = model.group.getObjectByName(`city-district-${district.id}`);
        expect(land).toBeDefined();
        const feature = boundaries.features.find((item) => item.properties.name === district.name)!;
        let insideHits = 0;
        for (let x = -70; x <= 70; x += 14) {
          for (let z = -70; z <= 70; z += 14) {
            const expected = insideRing(x, z, feature.geometry.coordinates[0]);
            const ray = new THREE.Raycaster(new THREE.Vector3(x, 20, z), new THREE.Vector3(0, -1, 0));
            const hits = ray.intersectObject(land!, true);
            expect(hits.length > 0, `${district.id} at ${x}, ${z}`).toBe(expected);
            if (expected) insideHits++;
          }
        }
        expect(insideHits).toBeGreaterThan(5);
      }
    } finally { model.dispose(); }
  });

  it("joins outline corners so adjacent segments share vertices", () => {
    const verts = loopRibbon([[0, 0], [10, 0], [10, 10], [0, 10]], 1, 0);
    expect(verts.length).toBe(4 * 6 * 3);
    const vertex = (segment: number, index: number) => verts.slice((segment * 6 + index) * 3, (segment * 6 + index) * 3 + 3);
    for (let i = 0; i < 4; i++) {
      const next = (i + 1) % 4;
      expect(vertex(i, 1)).toEqual(vertex(next, 0));
      expect(vertex(i, 5)).toEqual(vertex(next, 2));
    }
  });

  it("outlines each district and keeps the emphasis stroke hidden until hover or selection", () => {
    const model = buildCityModel();
    try {
      const colors = CITY_DISTRICTS.map((district) => {
        const idle = model.group.getObjectByName(`city-district-edge-${district.id}`);
        const active = model.group.getObjectByName(`city-district-edge-active-${district.id}`);
        expect(idle).toBeInstanceOf(THREE.Mesh);
        expect(active).toBeInstanceOf(THREE.Mesh);
        expect(idle!.visible).toBe(true);
        expect(active!.visible).toBe(false);
        expect(model.pickTargets).not.toContain(idle);
        expect(model.pickTargets).not.toContain(active);
        const idleMaterial = (idle as THREE.Mesh).material as THREE.MeshBasicMaterial;
        const activeMaterial = (active as THREE.Mesh).material as THREE.MeshBasicMaterial;
        expect(idleMaterial.transparent).toBe(true);
        expect(`#${idleMaterial.color.getHexString()}`).toBe(district.color);
        expect(`#${activeMaterial.color.getHexString()}`).toBe(district.color);
        expect(idleMaterial.toneMapped).toBe(false);
        expect(active!.renderOrder).toBeGreaterThan(idle!.renderOrder);
        const land = model.group.getObjectByName(`city-district-${district.id}`) as THREE.Mesh;
        expect(`#${(land.material as THREE.MeshStandardMaterial).color.getHexString()}`).toBe('#c5d0b8');
        return idleMaterial.color.getHex();
      });
      expect(new Set(colors).size).toBe(3);
    } finally { model.dispose(); }
  });

  it("keeps every source-verified landmark present, positioned and pickable in one city", () => {
    const model = buildCityModel();
    try {
      model.group.updateMatrixWorld(true);
      const places = new Set(model.pickTargets.map((target) => target.userData.placeId));
      for (const landmark of CITY_LANDMARKS) {
        expect(places.has(landmark.placeId)).toBe(true);
        const root = model.group.getObjectByName(`landmark-${landmark.placeId}`)!;
        expect(root).toBeDefined();
        expect(root.visible).toBe(true);
        expect(root.position.toArray()).toEqual(landmark.position);
        expect(root.scale.x).toBe(landmark.scale);
        const picks = model.pickTargets.filter((target) => target.userData.placeId === landmark.placeId);
        let hits = 0;
        for (const pick of picks) {
          expect(model.group.getObjectById(pick.id)).toBe(pick);
          expect(typeof pick.userData.hotspotId).toBe("string");
          const bounds = new THREE.Box3().setFromObject(pick);
          const center = bounds.getCenter(new THREE.Vector3());
          for (const offset of [new THREE.Vector3(0, 25, 0), new THREE.Vector3(0, 15, 25)]) {
            const eye = center.clone().add(offset);
            for (const hit of new THREE.Raycaster(eye, center.clone().sub(eye).normalize()).intersectObject(pick, true)) {
              expect(hit.object.userData.placeId).toBe(landmark.placeId);
              hits++;
            }
          }
        }
        expect(hits, landmark.placeId).toBeGreaterThan(0);
      }
      for (const id of ["pangyo-museum", "central-park", "moran-market"]) {
        expect(model.group.getObjectByName(`landmark-${id}`)!.getObjectByName("terrain-pedestal")).toBeUndefined();
        expect(model.group.getObjectByName(`landmark-${id}`)!.getObjectByName("landmark-location-marker")).toBeDefined();
      }
    } finally { model.dispose(); }
  });

  it("uses finite source geometry and bounded batches within a bounded rendering budget", () => {
    const model = buildCityModel();
    try {
      const { geometries, instances } = resources(model.group);
      expect(model.group.userData.buildings).toBeGreaterThan(32_000);
      expect(model.group.userData.roads).toBeGreaterThan(14_000);
      expect(model.group.getObjectByName('city-building-bodies')).toBeUndefined();
      expect(model.group.getObjectByName('connected-city-streets')).toBeUndefined();
      expect(model.group.getObjectByName('tancheon-water')).toBeDefined();
      for (const geometry of geometries) {
        expect(Array.from(geometry.getAttribute("position").array).every(Number.isFinite)).toBe(true);
      }
      for (const instance of instances) expect(Array.from(instance.instanceMatrix.array).every(Number.isFinite)).toBe(true);
      let meshes = 0, triangles = 0;
      model.group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        meshes++;
        triangles += (object.geometry.index?.count ?? object.geometry.getAttribute("position").count) / 3 * (object instanceof THREE.InstancedMesh ? object.count : 1);
      });
      expect(meshes).toBeLessThan(220);
      expect(triangles).toBeLessThan(1_600_000);
      const size = new THREE.Box3().setFromObject(model.group).getSize(new THREE.Vector3());
      expect(size.x).toBeGreaterThan(140);
      expect(size.x).toBeLessThan(160);
      expect(size.z).toBeGreaterThan(150);
      expect(size.z).toBeLessThan(170);
    } finally { model.dispose(); }
  });

  it("aggregates visitor transforms and stops hidden visitors without stale shadows", () => {
    const model = buildCityModel();
    try {
      expect(model.group.getObjectById(model.visitors.id)).toBe(model.visitors);
      expect(model.visitors.children.length).toBeGreaterThanOrEqual(3);
      expect(model.traffic).toBeDefined();
      expect(model.group.userData.population).toEqual({ people: 3600, vehicles: 1500 });
      model.configurePopulation?.({ density: 2, peopleScale: 2.5 });
      expect(model.group.userData.population).toEqual({ people: 7200, vehicles: 3000 });
      const before = matrices(model.visitors);
      model.update(0, true);
      model.update(1, true);
      const walked = matrices(model.visitors);
      expect(walked).not.toEqual(before);
      model.visitors.visible = false;
      model.update(10, true);
      model.update(20, true);
      expect(matrices(model.visitors)).toEqual(walked);
      model.visitors.visible = true;
      model.update(30, true);
      expect(matrices(model.visitors)).toEqual(walked);
      model.update(31, true);
      expect(matrices(model.visitors)).not.toEqual(walked);
      model.visitors.traverse((object) => expect(object.castShadow).toBe(false));
    } finally { model.dispose(); }
  });

  it("disposes city geometry and population resources exactly once with independent ownership", () => {
    const model = buildCityModel(), other = buildCityModel();
    const owned = resources(model.group), otherResources = resources(other.group);
    const counts = new Map<object, number>();
    for (const set of Object.values(owned)) for (const resource of set) {
      counts.set(resource, 0);
      const disposed = () => { counts.set(resource, counts.get(resource)! + 1); };
      if (resource instanceof THREE.InstancedMesh) resource.addEventListener("dispose", disposed);
      else if (resource instanceof THREE.BufferGeometry) resource.addEventListener("dispose", disposed);
      else resource.addEventListener("dispose", disposed);
    }
    let independentDisposals = 0;
    for (const resource of otherResources.geometries) resource.addEventListener("dispose", () => independentDisposals++);
    model.dispose(); model.dispose();
    expect(counts.size).toBeGreaterThan(50);
    expect([...counts.values()].every((count) => count === 1)).toBe(true);
    expect(independentDisposals).toBe(0);
    expect(() => model.update(100, true)).not.toThrow();
    other.dispose();
  });
});
