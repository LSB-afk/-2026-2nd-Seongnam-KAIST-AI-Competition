import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildDiorama } from "@/lib/diorama/models";

const places = ["pangyo-museum", "central-park", "moran-market"] as const;
const hotspotIds = {
  "pangyo-museum": ["museum-exterior", "museum-garden"],
  "central-park": ["park-lake", "park-pavilion"],
  "moran-market": ["market-stalls", "market-aisle"],
};

function resources(group: THREE.Group) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const instances = new Set<THREE.InstancedMesh>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
    }
    if (object instanceof THREE.InstancedMesh) instances.add(object);
  });
  return { geometries, materials, instances };
}

function visitorTransforms(visitors: THREE.Group) {
  visitors.updateMatrixWorld(true);
  const matrices: number[][] = [];
  visitors.traverse((object) => matrices.push(object.matrixWorld.toArray()));
  return matrices;
}

describe.each(places)("%s diorama", (placeId) => {
  it("keeps every visible vertex and instance inside the shared camera envelope", () => {
    const model = buildDiorama(placeId);
    try {
      const bounds = new THREE.Box3().setFromObject(model.group);
      expect(bounds.isEmpty()).toBe(false);
      expect(bounds.min.x).toBeGreaterThanOrEqual(-17);
      expect(bounds.max.x).toBeLessThanOrEqual(17);
      expect(bounds.min.z).toBeGreaterThanOrEqual(-14);
      expect(bounds.max.z).toBeLessThanOrEqual(14);
      expect(bounds.min.y).toBeGreaterThanOrEqual(-3);
      expect(bounds.max.y).toBeLessThanOrEqual(10);
      expect(bounds.getSize(new THREE.Vector3()).x).toBeGreaterThan(25);

      const { geometries, instances } = resources(model.group);
      expect(instances.size).toBeGreaterThan(0);
      for (const geometry of geometries) {
        const position = geometry.getAttribute("position");
        expect(position.count).toBeGreaterThan(0);
        expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
        const normal = geometry.getAttribute("normal");
        if (normal) expect(Array.from(normal.array).every(Number.isFinite)).toBe(true);
      }
      for (const instance of instances) {
        expect(Array.from(instance.instanceMatrix.array).every(Number.isFinite)).toBe(true);
      }
    } finally {
      model.dispose();
    }
  });

  it("exposes raycastable hotspot geometry belonging to this scene", () => {
    const model = buildDiorama(placeId);
    try {
      model.group.updateMatrixWorld(true);
      expect(new Set(model.pickTargets.map((target) => target.userData.hotspotId))).toEqual(
        new Set(hotspotIds[placeId]),
      );
      for (const target of model.pickTargets) {
        expect(model.group.getObjectById(target.id)).toBe(target);
        const bounds = new THREE.Box3().setFromObject(target);
        expect(bounds.isEmpty()).toBe(false);
        const anchor = new THREE.Vector3(...target.userData.labelAnchor as [number, number, number]);
        const hit = [new THREE.Vector3(0, 25, 0), new THREE.Vector3(0, 16, 22)]
          .flatMap((offset) => {
            const eye = anchor.clone().add(offset);
            return new THREE.Raycaster(eye, anchor.clone().sub(eye).normalize()).intersectObject(target, true);
          })[0];
        expect(hit).toBeDefined();
        expect(hit.object.userData.hotspotId).toBe(target.userData.hotspotId);
      }
    } finally {
      model.dispose();
    }
  });

  it("moves visitors only when enabled and resumes without consuming paused time", () => {
    const model = buildDiorama(placeId);
    try {
      expect(model.group.getObjectById(model.visitors.id)).toBe(model.visitors);
      const initial = visitorTransforms(model.visitors);
      model.update(0, true);
      model.update(1, true);
      const walked = visitorTransforms(model.visitors);
      expect(walked).not.toEqual(initial);
      model.update(20, false);
      expect(visitorTransforms(model.visitors)).toEqual(walked);
      model.update(21, true);
      expect(visitorTransforms(model.visitors)).toEqual(walked);
      model.update(22, true);
      expect(visitorTransforms(model.visitors)).not.toEqual(walked);
      model.visitors.visible = false;
      expect(model.group.visible).toBe(true);
    } finally {
      model.dispose();
    }
  });

  it("releases each owned resource once without disposing another scene", () => {
    const model = buildDiorama(placeId);
    const other = buildDiorama(placeId);
    const owned = resources(model.group);
    const separate = resources(other.group);
    const disposals = new Map<object, number>();
    for (const collection of Object.values(owned)) {
      for (const resource of collection) {
        disposals.set(resource, 0);
        const disposed = () => { disposals.set(resource, disposals.get(resource)! + 1); };
        if (resource instanceof THREE.InstancedMesh) resource.addEventListener("dispose", disposed);
        else if (resource instanceof THREE.BufferGeometry) resource.addEventListener("dispose", disposed);
        else resource.addEventListener("dispose", disposed);
      }
    }
    let otherDisposals = 0;
    for (const material of separate.materials) material.addEventListener("dispose", () => otherDisposals++);
    model.dispose();
    model.dispose();
    expect(disposals.size).toBeGreaterThan(5);
    expect([...disposals.values()].every((count) => count === 1)).toBe(true);
    expect(otherDisposals).toBe(0);
    expect(() => model.update(100, true)).not.toThrow();
    other.dispose();
  });

  it("keeps moving visitors out of the static shadow map while scenery still casts shadows", () => {
    const model = buildDiorama(placeId);
    try {
      const visitorMeshes: THREE.Mesh[] = [];
      model.visitors.traverse((object) => {
        if (object instanceof THREE.Mesh) visitorMeshes.push(object);
      });
      expect(visitorMeshes.length).toBeGreaterThan(0);
      expect(visitorMeshes.every((mesh) => !mesh.castShadow)).toBe(true);

      const tree = model.group.getObjectByName("tree-crowns");
      let sceneryCastsShadow = false;
      for (const scenery of model.pickTargets) {
        scenery.traverse((object) => {
          if (object instanceof THREE.Mesh && object.castShadow) sceneryCastsShadow = true;
        });
      }
      expect(sceneryCastsShadow).toBe(true);
      expect(tree?.castShadow).toBe(true);

      model.update(0, true);
      model.update(1, true);
      model.visitors.visible = false;
      expect(visitorMeshes.some((mesh) => mesh.castShadow)).toBe(false);
    } finally {
      model.dispose();
    }
  });
});
