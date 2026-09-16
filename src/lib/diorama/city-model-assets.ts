import * as THREE from "three";

export type XZ = readonly [number, number];
export type XYZ = readonly [number, number, number];
type Instance = { position: XYZ; scale: XYZ; rotation: number; color: string };
type Batch = { parent: THREE.Group; name: string; geometry: THREE.BufferGeometry; instances: Instance[] };

/** City-only resources. Reused landmark models retain their own disposal boundary. */
export class CityAssets {
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly materials = new Map<string, THREE.Material>();
  private readonly batches = new Map<string, Batch>();
  private readonly instances: THREE.InstancedMesh[] = [];

  group(name: string, parent?: THREE.Group) {
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

  material(color: string) {
    let material = this.materials.get(color);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true });
      this.materials.set(color, material);
    }
    return material as THREE.MeshStandardMaterial;
  }

  instance(parent: THREE.Group, name: string, geometry: THREE.BufferGeometry, color: string, position: XYZ, scale: XYZ, rotation = 0) {
    const key = `${parent.id}/${name}/${geometry.uuid}`;
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { parent, name, geometry, instances: [] };
      this.batches.set(key, batch);
    }
    batch.instances.push({ position, scale, rotation, color });
  }

  box(parent: THREE.Group, name: string, color: string, position: XYZ, scale: XYZ, rotation = 0) {
    this.instance(parent, name, this.geometry("unit-box", () => new THREE.BoxGeometry(1, 1, 1)), color, position, scale, rotation);
  }

  cylinder(parent: THREE.Group, name: string, color: string, position: XYZ, scale: XYZ) {
    this.instance(parent, name, this.geometry("unit-cylinder", () => new THREE.CylinderGeometry(0.5, 0.5, 1, 12)), color, position, scale);
  }

  rock(parent: THREE.Group, name: string, color: string, position: XYZ, scale: XYZ, rotation = 0) {
    this.instance(parent, name, this.geometry("unit-icosahedron", () => new THREE.IcosahedronGeometry(1, 0)), color, position, scale, rotation);
  }

  mesh(parent: THREE.Group, name: string, geometry: THREE.BufferGeometry, color: string) {
    const mesh = new THREE.Mesh(geometry, this.material(color));
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  band(parent: THREE.Group, name: string, ring: readonly XZ[], width: number, y: number, color: string, opacity: number) {
    const geometry = this.geometry(`${parent.id}/${name}`, () => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(loopRibbon(ring, width, y), 3));
      geometry.computeVertexNormals();
      return geometry;
    });
    const key = `${color}/band/${opacity}`;
    let material = this.materials.get(key);
    if (!material) {
      material = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      });
      this.materials.set(key, material);
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 4;
    parent.add(mesh);
    return mesh;
  }

  surface(parent: THREE.Group, name: string, vertices: number[], color: string) {
    const geometry = this.geometry(`${parent.id}/${name}`, () => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      geometry.computeVertexNormals();
      return geometry;
    });
    return this.mesh(parent, name, geometry, color);
  }

  solid(parent: THREE.Group, name: string, rings: readonly (readonly XZ[])[], top: number, depth: number, color: string) {
    const shape = new THREE.Shape(rings[0].map(([x, z]) => new THREE.Vector2(x, -z)));
    for (const hole of rings.slice(1)) shape.holes.push(new THREE.Path(hole.map(([x, z]) => new THREE.Vector2(x, -z))));
    const geometry = this.geometry(`${parent.id}/${name}`, () => {
      const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, top - depth, 0);
      return geometry;
    });
    return this.mesh(parent, name, geometry, color);
  }

  tree(parent: THREE.Group, x: number, y: number, z: number, size: number, variant: number) {
    const colors = ["#6b906b", "#789b73", "#88a77b", "#597d63"];
    this.cylinder(parent, "tree-trunks", "#a1845e", [x, y + 0.55 * size, z], [0.13 * size, 1.1 * size, 0.13 * size]);
    this.rock(parent, "tree-crowns", colors[variant % colors.length], [x, y + 1.34 * size, z], [0.66 * size, 0.84 * size, 0.66 * size], variant * 0.37);
  }

  flush() {
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (const batch of this.batches.values()) {
      const mesh = new THREE.InstancedMesh(batch.geometry, this.material("#ffffff"), batch.instances.length);
      mesh.name = batch.name;
      batch.instances.forEach((instance, i) => {
        dummy.position.set(...instance.position);
        dummy.scale.set(...instance.scale);
        dummy.rotation.set(0, instance.rotation, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, color.set(instance.color));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      batch.parent.add(mesh);
      this.instances.push(mesh);
    }
    this.batches.clear();
  }

  dispose() {
    for (const instance of this.instances) instance.dispose();
    for (const geometry of this.geometries.values()) geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.instances.length = 0;
    this.geometries.clear();
    this.materials.clear();
    this.batches.clear();
  }
}

export function inRing(x: number, z: number, ring: readonly XZ[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[j];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

export function distanceToPath(x: number, z: number, path: readonly XZ[]) {
  let nearest = Infinity;
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1], [bx, bz] = path[i];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    nearest = Math.min(nearest, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return nearest;
}

/** Independent triangles allow actual boundary clipping without an external polygon library. */
export function loopRibbon(ring: readonly XZ[], width: number, y: number) {
  const vertices: number[] = [];
  const points: XZ[] = [];
  for (const point of ring) {
    const previous = points.at(-1);
    if (!previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 1e-8) points.push(point);
  }
  if (points.length > 1 && Math.hypot(points[0][0] - points.at(-1)![0], points[0][1] - points.at(-1)![1]) < 1e-8) points.pop();
  if (points.length < 3) return vertices;
  const half = width / 2;
  const count = points.length;
  const offsets: XZ[] = [];
  for (let i = 0; i < count; i++) {
    const previous = points[(i + count - 1) % count], current = points[i], next = points[(i + 1) % count];
    const inDx = current[0] - previous[0], inDz = current[1] - previous[1];
    const outDx = next[0] - current[0], outDz = next[1] - current[1];
    const inLength = Math.hypot(inDx, inDz), outLength = Math.hypot(outDx, outDz);
    if (inLength < 1e-8 || outLength < 1e-8) { offsets.push([0, 0]); continue; }
    const nx1 = -inDz / inLength, nz1 = inDx / inLength;
    const nx2 = -outDz / outLength, nz2 = outDx / outLength;
    let mx = nx1 + nx2, mz = nz1 + nz2;
    const miterLength = Math.hypot(mx, mz);
    if (miterLength < 1e-5) { offsets.push([nx1 * half, nz1 * half]); continue; }
    mx /= miterLength; mz /= miterLength;
    const join = mx * nx1 + mz * nz1;
    const scale = half / Math.max(0.4, Math.abs(join));
    offsets.push([mx * scale, mz * scale]);
  }
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    const [ax, az] = points[i], [bx, bz] = points[next];
    const [anx, anz] = offsets[i], [bnx, bnz] = offsets[next];
    const a: XYZ = [ax + anx, y, az + anz], b: XYZ = [ax - anx, y, az - anz];
    const c: XYZ = [bx + bnx, y, bz + bnz], d: XYZ = [bx - bnx, y, bz - bnz];
    vertices.push(...a, ...c, ...b, ...b, ...c, ...d);
  }
  return vertices;
}

export function ribbon(path: readonly XZ[], width: number, y: number, contains: (x: number, z: number) => boolean, step = 0.7) {
  const vertices: number[] = [];
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1], [bx, bz] = path[i];
    const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz);
    if (length === 0) continue;
    const nx = -dz / length * width / 2, nz = dx / length * width / 2;
    const pieces = Math.max(1, Math.ceil(length / step));
    for (let j = 0; j < pieces; j++) {
      const x0 = ax + dx * j / pieces, z0 = az + dz * j / pieces;
      const x1 = ax + dx * (j + 1) / pieces, z1 = az + dz * (j + 1) / pieces;
      const a: XYZ = [x0 + nx, y, z0 + nz], b: XYZ = [x0 - nx, y, z0 - nz];
      const c: XYZ = [x1 + nx, y, z1 + nz], d: XYZ = [x1 - nx, y, z1 - nz];
      if ([a, b, c, d].every(([x, , z]) => contains(x, z))) vertices.push(...a, ...c, ...b, ...b, ...c, ...d);
    }
  }
  return vertices;
}

export function ellipse(x: number, z: number, rx: number, rz: number, count = 24): XZ[] {
  return Array.from({ length: count }, (_, i) => [x + Math.cos(i * Math.PI * 2 / count) * rx, z + Math.sin(i * Math.PI * 2 / count) * rz] as XZ);
}
