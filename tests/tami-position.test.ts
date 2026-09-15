import { describe, expect, it } from "vitest";
import { anchorForPosition, clampDockPosition, hasDragged, positionForAnchor, resolveDockPosition, restoreTamiPosition } from "../src/lib/tami-position";

const viewport = { left: 0, top: 0, width: 390, height: 844 };
const dock = { width: 140, height: 56 };

describe("Tami dock position", () => {
  it("retains a free position without snapping to a corner", () => {
    expect(clampDockPosition({ x: 80, y: 290 }, dock, viewport)).toEqual({ x: 80, y: 290 });
    const anchor = anchorForPosition({ x: 80, y: 290 }, dock, viewport);
    const restored = positionForAnchor(anchor, dock, viewport);
    expect(restored.x).toBeCloseTo(80); expect(restored.y).toBeCloseTo(290);
  });
  it("keeps the entire dock inside every viewport edge", () => {
    expect(clampDockPosition({ x: -900, y: -40 }, dock, viewport)).toEqual({ x: 8, y: 8 });
    expect(clampDockPosition({ x: 900, y: 1000 }, dock, viewport)).toEqual({ x: 242, y: 780 });
  });
  it("restores relative position when desktop changes to mobile", () => {
    expect(positionForAnchor({ x: 1, y: 1 }, dock, viewport)).toEqual({ x: 242, y: 780 });
    expect(positionForAnchor({ x: 0.5, y: 0.5 }, dock, viewport)).toEqual({ x: 125, y: 394 });
  });
  it("keeps the dock inside the visible area with the mobile keyboard or zoom open", () => {
    expect(positionForAnchor({ x: 1, y: 1 }, dock, { left: 20, top: 120, width: 320, height: 300 })).toEqual({ x: 192, y: 356 });
  });
  it("remains finite when the visible area is smaller than the dock", () => {
    const tiny = { left: 20, top: 60, width: 80, height: 40 };
    expect(positionForAnchor({ x: 1, y: 1 }, dock, tiny)).toEqual({ x: 28, y: 68 });
    expect(anchorForPosition({ x: 28, y: 68 }, dock, tiny)).toEqual({ x: 0, y: 0 });
  });
  it("validates the version and coordinates before restoring storage", () => {
    expect(restoreTamiPosition('{"version":1,"x":0.25,"y":0.75}')).toEqual({ x: 0.25, y: 0.75 });
    for (const value of [null, "", "{", "null", "[]", '{"version":2,"x":0,"y":0}', '{"version":1,"x":"0","y":0}', '{"version":1,"x":-1,"y":0}', '{"version":1,"x":0,"y":2}', '{"version":1,"x":1e999,"y":0}'])
      expect(restoreTamiPosition(value)).toBeNull();
  });
  it("distinguishes tapping jitter from a drag in any direction", () => {
    expect(hasDragged({ x: 10, y: 10 }, { x: 13, y: 14 })).toBe(false);
    expect(hasDragged({ x: 10, y: 10 }, { x: 16, y: 10 })).toBe(true);
    expect(hasDragged({ x: 10, y: 10 }, { x: 6, y: 5 })).toBe(true);
  });
});

describe("automatic Tami obstacle avoidance", () => {
  const tablet = { left: 0, top: 0, width: 1024, height: 900 };
  const size = { width: 172, height: 72 };
  const preferred = { x: 832, y: 812 };
  const tallPanel = { left: 704, top: 20, right: 1004, bottom: 880 };
  const overlaps = (point: { x: number; y: number }, obstacle: { left: number; top: number; right: number; bottom: number }) =>
    point.x < obstacle.right && point.x + size.width > obstacle.left && point.y < obstacle.bottom && point.y + size.height > obstacle.top;

  it("moves beside a viewport-tall panel when lifting cannot clear its header", () => {
    const result = resolveDockPosition(preferred, size, tablet, [tallPanel]);
    expect(overlaps(result, tallPanel)).toBe(false);
    expect(result.x + size.width).toBeLessThanOrEqual(tallPanel.left);
    expect(clampDockPosition(result, size, tablet)).toEqual(result);
  });

  it("finds a position clear of both a tall panel and the bottom playback bar", () => {
    const player = { left: 20, top: 810, right: 684, bottom: 876 };
    const result = resolveDockPosition(preferred, size, tablet, [tallPanel, player]);
    expect([tallPanel, player].some(obstacle => overlaps(result, obstacle))).toBe(false);
    expect(clampDockPosition(result, size, tablet)).toEqual(result);
  });

  it("keeps the existing upward avoidance when there is space above a bottom sheet", () => {
    const sheet = { left: 12, top: 435, right: 378, bottom: 722 };
    expect(resolveDockPosition({ x: 238, y: 650 }, dock, viewport, [sheet])).toEqual({ x: 238, y: 367 });
  });

  it("preserves a saved manual position even when it overlaps protected content", () => {
    const chosen = { x: 832, y: 24 };
    const anchor = anchorForPosition(chosen, size, tablet);
    expect(resolveDockPosition(preferred, size, tablet, [tallPanel], anchor)).toEqual(positionForAnchor(anchor, size, tablet));
    expect(overlaps(resolveDockPosition(preferred, size, tablet, [tallPanel], anchor), tallPanel)).toBe(true);
  });
});
