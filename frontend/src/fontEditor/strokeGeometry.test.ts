import { describe, expect, it } from "vitest";
import {
  boundsOf,
  emToView,
  nearestStrokeId,
  pointToSegmentDistance,
  pointsToPath,
  viewBoxFor,
  viewToEm,
} from "./strokeGeometry";
import type { Stroke, StrokeFontMetrics } from "../api";

const metrics: StrokeFontMetrics = {
  em: 1000,
  baseline: 0,
  xHeight: 460,
  capHeight: 700,
  ascender: 780,
  descender: -230,
  defaultAdvance: 560,
  wordSpacing: 280,
};

describe("strokeGeometry", () => {
  it("emToView and viewToEm are inverses", () => {
    const top = 880;
    const p = { x: 123, y: 456 };
    const round = viewToEm(emToView(p, top), top);
    expect(round.x).toBeCloseTo(p.x);
    expect(round.y).toBeCloseTo(p.y);
  });

  it("flips y-up to y-down around top", () => {
    // baseline (y=0 em) maps to y=top in view space; ascender maps near 0.
    const top = 880;
    expect(emToView({ x: 0, y: 0 }, top).y).toBe(880);
    expect(emToView({ x: 0, y: 780 }, top).y).toBe(100);
  });

  it("viewBox spans ascender..descender plus margin", () => {
    const vb = viewBoxFor(metrics);
    expect(vb.w).toBe(1000);
    // top = 780 + 100, bottom = -230 - 100 → height 1210
    expect(vb.h).toBe(1210);
  });

  it("builds an SVG path with a move then lines", () => {
    const path = pointsToPath([{ x: 0, y: 0 }, { x: 10, y: 20 }], 100);
    expect(path.startsWith("M ")).toBe(true);
    expect(path).toContain(" L ");
  });

  it("measures distance from a point to a segment", () => {
    expect(pointToSegmentDistance({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(3);
    // Beyond the segment end clamps to the endpoint.
    expect(pointToSegmentDistance({ x: 15, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(5);
  });

  it("finds the nearest stroke within the threshold", () => {
    const mk = (id: string, y: number): Stroke => ({
      id,
      rawPoints: [],
      points: [{ x: 0, y }, { x: 100, y }],
    });
    const strokes = [mk("s1", 0), mk("s2", 200)];
    expect(nearestStrokeId(strokes, { x: 50, y: 10 }, 30)).toBe("s1");
    expect(nearestStrokeId(strokes, { x: 50, y: 190 }, 30)).toBe("s2");
    expect(nearestStrokeId(strokes, { x: 50, y: 100 }, 30)).toBeNull();
  });

  it("computes bounds and returns null for empty input", () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([{ x: 1, y: 5 }, { x: 3, y: -2 }])).toEqual({
      xMin: 1,
      yMin: -2,
      xMax: 3,
      yMax: 5,
    });
  });
});
