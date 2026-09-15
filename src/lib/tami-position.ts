export type Point = { x: number; y: number };
export type DockSize = { width: number; height: number };
export type Viewport = DockSize & { left: number; top: number };
export const TAMI_POSITION_KEY = "timestory:tami-position:v1";

function bounds(dock: DockSize, viewport: Viewport) {
  const left = viewport.left + 8, top = viewport.top + 8;
  return { left, top, width: Math.max(0, viewport.width - dock.width - 16), height: Math.max(0, viewport.height - dock.height - 16) };
}
export function clampDockPosition(point: Point, dock: DockSize, viewport: Viewport): Point {
  const box = bounds(dock, viewport);
  return { x: Math.max(box.left, Math.min(point.x, box.left + box.width)), y: Math.max(box.top, Math.min(point.y, box.top + box.height)) };
}
/** Ratios preserve the chosen location through resizing without saving temporary keyboard offsets. */
export function anchorForPosition(point: Point, dock: DockSize, viewport: Viewport): Point {
  const box = bounds(dock, viewport), clamped = clampDockPosition(point, dock, viewport);
  return { x: box.width ? (clamped.x - box.left) / box.width : 0, y: box.height ? (clamped.y - box.top) / box.height : 0 };
}
export function positionForAnchor(anchor: Point, dock: DockSize, viewport: Viewport): Point {
  const box = bounds(dock, viewport);
  return clampDockPosition({ x: box.left + anchor.x * box.width, y: box.top + anchor.y * box.height }, dock, viewport);
}
export type DockObstacle = { left: number; top: number; right: number; bottom: number };

/** Automatic placement avoids controls; an explicit user anchor always takes precedence. */
export function resolveDockPosition(preferred: Point, dock: DockSize, viewport: Viewport, obstacles: readonly DockObstacle[], anchor: Point | null = null): Point {
  if (anchor) return positionForAnchor(anchor, dock, viewport);
  let position = clampDockPosition(preferred, dock, viewport);
  const overlaps = (point: Point, obstacle: DockObstacle) => point.x < obstacle.right && point.x + dock.width > obstacle.left && point.y < obstacle.bottom && point.y + dock.height > obstacle.top;
  for (const obstacle of [...obstacles].sort((a, b) => b.top - a.top)) {
    if (overlaps(position, obstacle)) position = clampDockPosition({ x: position.x, y: obstacle.top - dock.height - 12 }, dock, viewport);
  }
  if (!obstacles.some(obstacle => overlaps(position, obstacle))) return position;

  // A tall panel can leave no room above it. Try viewport and obstacle edges on
  // both axes, retaining the closest clear location to the normal dock position.
  const origin = clampDockPosition(preferred, dock, viewport);
  const box = bounds(dock, viewport);
  const xs = new Set([origin.x, box.left, box.left + box.width, ...obstacles.flatMap(obstacle => [obstacle.left - dock.width - 12, obstacle.right + 12])].map(x => clampDockPosition({ x, y: origin.y }, dock, viewport).x));
  const ys = new Set([origin.y, box.top, box.top + box.height, ...obstacles.flatMap(obstacle => [obstacle.top - dock.height - 12, obstacle.bottom + 12])].map(y => clampDockPosition({ x: origin.x, y }, dock, viewport).y));
  let closestDistance = Infinity;
  for (const x of xs) for (const y of ys) {
    const candidate = { x, y };
    if (obstacles.some(obstacle => overlaps(candidate, obstacle))) continue;
    const distance = (x - origin.x) ** 2 + (y - origin.y) ** 2;
    if (distance < closestDistance) { position = candidate; closestDistance = distance; }
  }
  return position;
}

export function restoreTamiPosition(raw: string | null): Point | null {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("x" in value) || !("y" in value)) return null;
    if (typeof value.x !== "number" || typeof value.y !== "number" || !Number.isFinite(value.x) || !Number.isFinite(value.y) || value.x < 0 || value.x > 1 || value.y < 0 || value.y > 1) return null;
    return { x: value.x, y: value.y };
  } catch { return null; }
}
export function hasDragged(start: Point, current: Point): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= 6;
}
