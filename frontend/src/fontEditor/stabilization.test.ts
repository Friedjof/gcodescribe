import { describe, expect, it } from "vitest";
import { STABILIZATION_PRESETS, rdp, stabilize } from "./stabilization";
import type { StrokePoint } from "../api";

// A horizontal line from (0,0) to (100,0) with alternating ±5 jitter in y.
function jitteryLine(n = 41, amp = 5): StrokePoint[] {
  const pts: StrokePoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const x = (100 * i) / (n - 1);
    const y = i === 0 || i === n - 1 ? 0 : (i % 2 === 0 ? amp : -amp);
    pts.push({ x, y, t: i * 8 });
  }
  return pts;
}

// High-frequency roughness: sum of |second differences| in y.
function roughness(pts: StrokePoint[]): number {
  let s = 0;
  for (let i = 1; i < pts.length - 1; i += 1) {
    s += Math.abs(pts[i - 1].y - 2 * pts[i].y + pts[i + 1].y);
  }
  return s;
}

describe("stabilization", () => {
  it("off preset returns an identical copy", () => {
    const raw = jitteryLine();
    const out = stabilize(raw, STABILIZATION_PRESETS.off);
    expect(out).toHaveLength(raw.length);
    expect(out).toEqual(raw);
    expect(out).not.toBe(raw); // copy, not the same array
  });

  it("medium preset visibly calms touchpad jitter", () => {
    const raw = jitteryLine();
    const out = stabilize(raw, STABILIZATION_PRESETS.medium);
    expect(roughness(out)).toBeLessThan(roughness(raw) * 0.3);
  });

  it("closeStrokeEnd keeps the last point at the true raw end", () => {
    const raw = jitteryLine();
    const out = stabilize(raw, STABILIZATION_PRESETS.medium);
    expect(out[out.length - 1].x).toBeCloseTo(raw[raw.length - 1].x, 5);
    expect(out[out.length - 1].y).toBeCloseTo(raw[raw.length - 1].y, 5);
    // The start follows the smoothed line rather than the jittery raw start.
    expect(Math.abs(out[0].y)).toBeLessThan(5);
  });

  it("never increases the point count and simplifies a straight line", () => {
    const raw = jitteryLine(60);
    const out = stabilize(raw, STABILIZATION_PRESETS.medium);
    expect(out.length).toBeLessThanOrEqual(raw.length);

    const straight: StrokePoint[] = Array.from({ length: 50 }, (_, i) => ({
      x: i * 2,
      y: 0,
      t: i * 8,
    }));
    const simplified = stabilize(straight, STABILIZATION_PRESETS.medium);
    expect(simplified.length).toBeLessThan(10);
  });

  it("drops leading start artifacts", () => {
    const raw = jitteryLine();
    // Wild artifact at the very start.
    raw[0] = { ...raw[0], x: -40, y: 60 };
    const params = STABILIZATION_PRESETS.strong; // ignoreStartEvents = 4
    const out = stabilize(raw, params);
    // The artifact (x=-40, y=60) is dropped, not carried into the output.
    expect(out[0].x).toBeGreaterThan(0);
    expect(Math.abs(out[0].y)).toBeLessThan(10);
  });

  it("preserves timing metadata on surviving points", () => {
    const raw = jitteryLine();
    const out = stabilize(raw, STABILIZATION_PRESETS.light);
    expect(out.every((p) => typeof p.t === "number")).toBe(true);
  });

  it("rdp keeps both endpoints", () => {
    const pts: StrokePoint[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0.1 },
      { x: 10, y: 0 },
    ];
    const out = rdp(pts, 1);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(pts[0]);
    expect(out[1]).toEqual(pts[2]);
  });
});
