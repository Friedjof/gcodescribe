import { describe, expect, it } from "vitest";
import { IDENTITY, objectWorldBounds, type Pt, type Transform } from "./geometry";
import { canvasUnitsPerPixel, clampedTransform, gestureRotation, resizeTransform } from "./canvasTransforms";
import { resizeLocals, worldPoint } from "./viewTransform";
const frame: Pt[][] = [[[-10, -5], [10, 5]]];
function expectInside(transform: Transform) {
  const bounds = objectWorldBounds(frame, transform);
  expect(bounds[0]).toBeGreaterThanOrEqual(-1e-8);
  expect(bounds[1]).toBeGreaterThanOrEqual(-1e-8);
  expect(bounds[2]).toBeLessThanOrEqual(100 + 1e-8);
  expect(bounds[3]).toBeLessThanOrEqual(80 + 1e-8);
}
describe("plot boundary transforms", () => {
  it.each([0, Math.PI / 4, Math.PI / 2, -Math.PI / 3])("contains enlarged mirrored objects at rotation %s", rotation => {
    const result = clampedTransform({ ...IDENTITY, x: -80, y: 120, scaleX: -12, scaleY: -6, rotation }, frame, 100, 80);
    expectInside(result);
    expect(result.scaleX).toBeLessThan(0); expect(result.scaleY).toBeLessThan(0);
    expect(result.scale).toBeGreaterThan(0);
    expect(Math.abs(result.scaleX! / result.scaleY!)).toBeCloseTo(2);
  });
  it("leaves a fitting transform untouched", () => {
    const transform = { ...IDENTITY, x: 20, y: 30 };
    expect(clampedTransform(transform, frame, 100, 80)).toBe(transform);
  });
});
describe("resize gestures", () => {
  it.each([0, Math.PI / 3, Math.PI, -Math.PI / 2])("preserves the opposite anchor for rotation %s", rotation => {
    const start = { ...IDENTITY, x: 40, y: 30, rotation, scaleX: -1, scaleY: 2 };
    const { anchor, handle } = resizeLocals("br", [-10, -5, 10, 5]);
    const anchorWorld = worldPoint(anchor, start);
    const pointer = worldPoint(handle, { ...start, scaleX: -2, scaleY: 3 });
    const result = resizeTransform({ startTransform: start, startLocalBounds: [-10, -5, 10, 5], anchorLocal: anchor,
      handleLocal: handle, anchorWorld }, pointer, false);
    const actual = worldPoint(anchor, result);
    expect(actual[0]).toBeCloseTo(anchorWorld[0]); expect(actual[1]).toBeCloseTo(anchorWorld[1]);
    expect(result.scaleX).toBeLessThan(0);
  });
  it("locks proportions for a side handle", () => {
    const { anchor, handle } = resizeLocals("mr", [-10, -5, 10, 5]);
    const result = resizeTransform({ startTransform: IDENTITY, startLocalBounds: [-10, -5, 10, 5],
      anchorLocal: anchor, handleLocal: handle, anchorWorld: anchor }, [30, 0], true);
    expect(result.scaleX).toBeCloseTo(2); expect(result.scaleY).toBeCloseTo(2);
  });
  it("resizes a vertical line without exploding the degenerate dimension", () => {
    const { anchor, handle } = resizeLocals("br", [0, -5, 0, 5]);
    const result = resizeTransform({ startTransform: IDENTITY, startLocalBounds: [0, -5, 0, 5],
      anchorLocal: anchor, handleLocal: handle, anchorWorld: anchor }, [0, 15], true);
    expect(result.scaleX).toBeCloseTo(2); expect(result.scaleY).toBeCloseTo(2);
  });
});
it("uses Shift for 15-degree rotation and Alt to bypass angle snapping", () => {
  const rad = 89 * Math.PI / 180;
  expect(gestureRotation(rad, false, false)).toBeCloseTo(Math.PI / 2);
  expect(gestureRotation(37 * Math.PI / 180, true, false)).toBeCloseTo(Math.PI / 6);
  expect(gestureRotation(rad, true, true)).toBe(rad);
});
it("keeps grips the same pixel size at different zooms and viewport shapes", () => {
  expect(canvasUnitsPerPixel({ w: 200, h: 100 }, { width: 800, height: 400 })).toBe(.25);
  expect(canvasUnitsPerPixel({ w: 100, h: 50 }, { width: 800, height: 400 })).toBe(.125);
  expect(canvasUnitsPerPixel({ w: 200, h: 100 }, { width: 800, height: 200 })).toBe(.5);
});
it("moves a selection as a unit when its outer edge reaches the plot boundary", async () => {
  const { moveSelection } = await import("./canvasTransforms");
  const original = new Map([["a", { ...IDENTITY, x: 30, y: 20 }], ["b", { ...IDENTITY, x: 60, y: 20 }]]);
  const moved = moveSelection({ primaryId: "a", startMouse: [30, 20], startBoundsAll: [20, 15, 70, 25],
    startTs: original, vGuides: [], hGuides: [] }, [130, 120],
    { width: 100, height: 80, gridStep: 10, grid: true, free: false, tolerance: 2 })!;
  expect(moved.updates.get("a")?.x).toBe(60);
  expect(moved.updates.get("b")?.x).toBe(90);
  expect(moved.updates.get("b")!.x - moved.updates.get("a")!.x).toBe(30);
  expect(moved.constrained).toBe(true);
});
it("preserves layout and relative sizes when a selection grows beyond the plot", async () => {
  const { boundedSelectionTransforms } = await import("./canvasTransforms");
  const wanted = new Map<string, Transform>([
    ["a", { ...IDENTITY, x: -40, y: -20, scaleX: -3, scaleY: 3 }],
    ["b", { ...IDENTITY, x: 110, y: 70, scale: 3 }],
  ]);
  const wide: Pt[][] = [[[-20, -10], [20, 10]]];
  const frames = new Map([["a", frame], ["b", wide]]);
  const result = boundedSelectionTransforms(wanted, frames, 100, 80);
  const a = result.updates.get("a")!, b = result.updates.get("b")!;
  const factor = Math.abs(a.scaleX!) / 3;
  expect(b.x - a.x).toBeCloseTo(150 * factor);
  expect(b.y - a.y).toBeCloseTo(90 * factor);
  expect(b.scale).toBeCloseTo(Math.abs(a.scaleX!));
  expect(a.scaleX).toBeLessThan(0);
  for (const [id, transform] of result.updates) {
    const [x0, y0, x1, y1] = objectWorldBounds(frames.get(id)!, transform);
    expect(x0).toBeGreaterThanOrEqual(-1e-8); expect(y0).toBeGreaterThanOrEqual(-1e-8);
    expect(x1).toBeLessThanOrEqual(100 + 1e-8); expect(y1).toBeLessThanOrEqual(80 + 1e-8);
  }
  expect(result.constrained).toBe(true);
});
it("shifts a rotated selection together without resizing when its dimensions fit", async () => {
  const { boundedSelectionTransforms } = await import("./canvasTransforms");
  const wanted = new Map<string, Transform>([["a", { ...IDENTITY, x: -5, y: 20, rotation: Math.PI / 2 }],
    ["b", { ...IDENTITY, x: 15, y: 50, rotation: Math.PI / 2 }]]);
  const result = boundedSelectionTransforms(wanted, new Map([["a", frame], ["b", frame]]), 100, 80);
  const a = result.updates.get("a")!, b = result.updates.get("b")!;
  expect(b.x - a.x).toBeCloseTo(20); expect(b.y - a.y).toBeCloseTo(30);
  expect(a.scale).toBe(1); expect(b.scale).toBe(1);
  expectInside(a); expectInside(b);
});
it("keeps the grab offset when the user hits the larger resize target off-center", () => {
  const { anchor, handle } = resizeLocals("br", [-10, -5, 10, 5]);
  const result = resizeTransform({ startTransform: IDENTITY, startLocalBounds: [-10, -5, 10, 5],
    anchorLocal: anchor, handleLocal: handle, anchorWorld: anchor, pointerOffset: [3, 2] }, [13, 7], false);
  expect(result.x).toBeCloseTo(0); expect(result.y).toBeCloseTo(0);
  expect(result.scaleX).toBeCloseTo(1); expect(result.scaleY).toBeCloseTo(1);
});
