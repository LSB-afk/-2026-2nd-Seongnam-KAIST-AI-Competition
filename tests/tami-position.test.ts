import { describe, expect, it } from "vitest";
import { anchorForPosition, clampDockPosition, hasDragged, positionForAnchor, restoreTamiPosition } from "../src/lib/tami-position";

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
