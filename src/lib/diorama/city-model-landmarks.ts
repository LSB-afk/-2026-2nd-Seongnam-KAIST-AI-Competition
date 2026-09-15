import * as THREE from "three";
import type { DioramaLandmarkId } from "./data";
import { CityAssets, ellipse, type XYZ } from "./city-model-assets";

const colors = { cream: "#eee5d2", trim: "#f6eedb", glass: "#81b1b3", metal: "#819390", stone: "#aaa78f", wood: "#a47958", dark: "#4f6263", grass: "#b9c99b" };

function court(a: CityAssets, root: THREE.Group) {
  a.box(root, "landmark-courtyard", "#e9dfc8", [0, 0.045, 1], [27, 0.09, 21]);
  for (let i = 0; i < 6; i++) {
    a.tree(root, -12.5 + i * 5, 0, -10, 1.2, i);
    if (i === 0 || i === 5) a.tree(root, -12.5 + i * 5, 0, 9, 1.1, i + 1);
  }
}

function glazedBlock(a: CityAssets, root: THREE.Group, x: number, z: number, width: number, depth: number, height: number) {
  a.box(root, "civic-building-masses", colors.cream, [x, height / 2, z], [width, height, depth]);
  a.box(root, "civic-roofs", colors.trim, [x, height + 0.12, z], [width + 0.35, 0.24, depth + 0.35]);
  for (let y = 1; y < height - 0.5; y += 1.1) {
    a.box(root, "civic-glass-bands", colors.glass, [x, y, z + depth / 2 + 0.025], [width - 0.6, 0.69, 0.07]);
    a.box(root, "civic-glass-bands", colors.glass, [x + width / 2 + 0.025, y, z], [0.07, 0.69, depth - 0.6]);
    for (let dx = -width / 2 + 0.7; dx < width / 2; dx += 1.1) a.box(root, "civic-window-mullions", colors.metal, [x + dx, y, z + depth / 2 + 0.075], [0.07, 0.7, 0.08]);
  }
}

function cityHall(a: CityAssets, root: THREE.Group) {
  court(a, root);
  glazedBlock(a, root, 0, -4.5, 25, 6.8, 8.2);
  glazedBlock(a, root, -5.5, 2.1, 12, 7.3, 5.2);
  glazedBlock(a, root, 7.6, 0.2, 6.4, 4.8, 4.1);
  // Stepped blue canopy links the lower foreground wing to the broad upper civic block.
  const canopy: number[] = [];
  const profile: readonly [number, number][] = [[-1.8,5.5],[0.5,5.2],[2.2,4.2],[4.3,3.95],[10.8,3.95]];
  for (let i = 1; i < profile.length; i++) {
    const [x0,y0] = profile[i - 1], [x1,y1] = profile[i];
    canopy.push(x0,y0,0.8, x0,y0,6.1, x1,y1,0.8, x0,y0,6.1, x1,y1,6.1, x1,y1,0.8);
  }
  a.surface(root, "civic-stepped-glass-canopy", canopy, "#679da5");
  for (const x of [2.4, 6.3, 10.3]) a.cylinder(root, "civic-canopy-columns", colors.trim, [x, 1.9, 5.7], [0.33, 3.8, 0.33]);
  for (let i = 0; i < 7; i++) a.box(root, "civic-plaza-paving", "#d7cdb7", [-10.8 + i * 3.6, 0.105, 8.6], [1.5, 0.04, 2.7]);
  a.box(root, "civic-garden", colors.grass, [8.9, 0.15, 8.8], [5.2, 0.14, 2.9]);
  a.rock(root, "civic-sculpture", "#84b6bd", [5.3, 0.9, 9.2], [0.55, 0.85, 0.55], 0.4);
}

function artsCenter(a: CityAssets, root: THREE.Group) {
  court(a, root);
  glazedBlock(a, root, -7.7, -3.1, 10.2, 8.5, 7);
  a.cylinder(root, "concert-hall-rounded-volume", "#d9d5c4", [-7.7, 3.4, -0.8], [11, 6.8, 8.1]);
  a.cylinder(root, "concert-hall-roof", colors.trim, [-7.7, 6.9, -0.8], [11.5, 0.24, 8.5]);
  a.box(root, "concert-hall-glass-front", colors.glass, [-7.7, 2.8, 3.2], [6.1, 3.8, 0.11]);
  for (let i = 0; i < 6; i++) a.box(root, "concert-hall-front-columns", colors.trim, [-10.5 + i * 1.13, 2.8, 3.32], [0.16, 4.3, 0.18]);
  for (let i = 0; i < 3; i++) {
    const x = 0.6 + i * 4.2, height = 4.8 - i * 0.5;
    glazedBlock(a, root, x, -1.6, 3.7, 8.1, height);
    const roof = [x - 2, height + 0.2, -5.9, x - 2, height + 0.2, 2.65, x + 2, height + 0.65, -5.9, x - 2, height + 0.2, 2.65, x + 2, height + 0.65, 2.65, x + 2, height + 0.65, -5.9];
    a.surface(root, `gallery-sawtooth-roof-${i}`, roof, "#a5b3b1");
    a.box(root, "arts-exhibition-banners", ["#b48868", "#618e8e", "#bca369"][i], [x, 2.7, 2.57], [2.2, 2.7, 0.12]);
  }
  a.box(root, "arts-promenade", colors.trim, [0, 0.14, 6.3], [24, 0.15, 3.1]);
  for (let i = 0; i < 5; i++) a.cylinder(root, "arts-court-planters", colors.stone, [-9 + i * 4.5, 0.27, 8.5], [1.5, 0.5, 1.5]);
  a.rock(root, "arts-public-sculpture", "#bd9270", [-1.3, 1.35, 6.3], [0.72, 1.3, 0.5], 0.3);
}

function yuldong(a: CityAssets, root: THREE.Group) {
  const shore = ellipse(0, 0.5, 12.3, 9, 26).map(([x,z], i) => [x * (1 + Math.sin(i * 2.6) * 0.035), z] as const);
  a.solid(root, "yuldong-lake-walking-loop", [shore.map(([x,z]) => [x * 1.13, z * 1.13] as const)], 0.07, 0.07, "#ece1c7");
  a.solid(root, "yuldong-lakeshore", [shore], 0.09, 0.09, "#a6bd91");
  const lake = a.solid(root, "yuldong-blue-lake", [shore.map(([x,z]) => [x * 0.93, z * 0.93] as const)], 0.11, 0.06, "#6eb4ba");
  lake.castShadow = false;
  for (let i = 0; i < 20; i++) {
    const angle = i * Math.PI * 2 / 20;
    a.tree(root, Math.cos(angle) * 14.3, 0, Math.sin(angle) * 11.2, 1.1 + (i % 3) * 0.16, i);
  }
  for (const [x,z,length] of [[-1,0,3.2],[4,3,2.3],[-6,2,1.8],[2,-4,2.3]]) a.box(root, "lake-highlights", "#add8d4", [x,0.145,z], [length,0.025,0.07]);
  a.box(root, "lakeside-deck", "#c6ab7d", [-8.2,0.24,2.5], [3.5,0.4,3.8]);
  a.cylinder(root, "lakeside-tower", "#9fc5b5", [-8.4,4.35,1.6], [0.52,8.3,0.52]);
  a.box(root, "lakeside-tower-platform", colors.trim, [-8.4,8.55,1.6], [2.4,0.23,1.8]);
  a.box(root, "lakeside-tower-arm", "#86ada7", [-7.3,8.13,1.6], [3,0.2,0.2]);
}

function templeRoof(a: CityAssets, root: THREE.Group, name: string, center: XYZ, width: number, depth: number) {
  const vertices: number[] = [];
  const point = (x: number, t: number, side: number): XYZ => [center[0] + x, center[1] + 2.1 * (1 - t) ** 2 + 0.22 * t ** 5 + Math.abs(x / (width / 2)) ** 4 * 0.18, center[2] + side * t * depth / 2];
  for (const side of [-1, 1]) {
    for (let step = 0; step < 5; step++) {
      const left0 = point(-width / 2, step / 5, side), left1 = point(-width / 2, (step + 1) / 5, side);
      const right0 = point(width / 2, step / 5, side), right1 = point(width / 2, (step + 1) / 5, side);
      if (side > 0) vertices.push(...left0, ...left1, ...right0, ...left1, ...right1, ...right0);
      else vertices.push(...left0, ...right0, ...left1, ...left1, ...right0, ...right1);
    }
  }
  a.surface(root, name, vertices, colors.dark);
  a.box(root, "traditional-roof-ridge", "#899592", [center[0], center[1] + 2.22, center[2]], [width + 0.3, 0.26, 0.33]);
  for (const side of [-1, 1]) {
    a.box(root, "traditional-eaves", colors.dark, [center[0], center[1] + 0.22, center[2] + side * depth / 2], [width, 0.16, 0.18]);
    for (let x = -width / 2 + 0.2; x < width / 2; x += 0.55) a.cylinder(root, "traditional-tile-ends", "#8c9791", [center[0] + x,center[1] + 0.27,center[2] + side * depth / 2], [0.27,0.15,0.27]);
  }
}

function temple(a: CityAssets, root: THREE.Group, rocky: boolean) {
  a.box(root, "temple-court", "#dfd3b7", [0,0.08,1], [21,0.16,17]);
  const x = rocky ? -3.7 : 0, z = rocky ? -2.4 : -1;
  const width = rocky ? 9 : 14, depth = rocky ? 6.3 : 8;
  a.box(root, "temple-stone-foundation", colors.stone, [x,0.7,z], [width + 1,1.4,depth + 1]);
  a.box(root, "temple-timber-hall", "#8a674f", [x,2.75,z], [width,3.2,depth]);
  for (let dx = -width / 2 + 0.45; dx < width / 2; dx += 2.1) {
    a.box(root, "temple-painted-doors", "#72a292", [x + dx + 0.7,2.65,z + depth / 2 + 0.03], [1.4,2.55,0.08]);
    a.box(root, "temple-wooden-columns", "#725747", [x + dx,2.95,z + depth / 2 + 0.12], [0.26,3.8,0.32]);
    a.box(root, "temple-painted-brackets", "#58866f", [x + dx,4.35,z + depth / 2 + 0.3], [0.9,0.27,1]);
  }
  templeRoof(a, root, "traditional-curved-roof", [x,4.4,z], width + 2.7, depth + 2.8);
  for (let i = 0; i < 5; i++) a.box(root, "temple-stone-steps", "#b6b09d", [x,0.13 + i * 0.23,z + depth / 2 + 3.1 - i * 0.44], [3.4,0.25,0.7]);
  if (rocky) {
    a.rock(root, "manggyeongam-rockface", "#aaa88f", [6.9,2.35,-1.7], [3.2,3.3,3.2], 0.3);
    a.cylinder(root, "manggyeongam-stone-monument", "#e1ded0", [3.4,2.0,2.8], [0.95,3.1,0.95]);
    a.rock(root, "manggyeongam-stone-monument", "#e1ded0", [3.4,3.85,2.8], [0.58,0.7,0.52]);
    a.box(root, "manggyeongam-monument-cap", "#d0d0bd", [3.4,4.62,2.8], [1.6,0.18,1.35]);
  }
  for (const [tx,tz] of [[-9,-6],[9,-6],[-9,6],[9,6]]) a.tree(root,tx,0,tz,1.6,tx < 0 ? 1 : 3);
}

/** Symbolic exterior silhouettes; no interiors, measured dimensions or operational claims. */
export function buildSymbolicLandmark(a: CityAssets, root: THREE.Group, placeId: DioramaLandmarkId) {
  if (placeId === "seongnam-city-hall") cityHall(a, root);
  else if (placeId === "seongnam-arts-center") artsCenter(a, root);
  else if (placeId === "yuldong-park") yuldong(a, root);
  else temple(a, root, placeId === "manggyeongam");
}
