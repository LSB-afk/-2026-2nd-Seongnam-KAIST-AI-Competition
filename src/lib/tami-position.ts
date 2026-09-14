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
