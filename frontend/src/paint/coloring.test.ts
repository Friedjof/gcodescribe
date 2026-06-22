import { describe, expect, it } from "vitest";
import type { Pt } from "./geometry";
import { colourRuns, densify, distToSeg, strokesForColor } from "./coloring";

describe("densify", () => {
  it("splits a long straight segment without changing its geometry", () => {
    const out = densify([[0, 0], [10, 0]], 2.5);
    expect(out.length).toBe(5); // ceil(10/2.5) = 4 segments -> 5 points
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([10, 0]);
    // every point stays on the original line (y === 0) and is monotonic in x
    for (let i = 1; i < out.length; i++) {
      expect(out[i][1]).toBe(0);
      expect(out[i][0]).toBeGreaterThan(out[i - 1][0]);
    }
  });

  it("keeps short lines untouched and never mutates the input", () => {
    const input: Pt[] = [[0, 0], [1, 0]];
    const out = densify(input, 2.5);
    expect(out).toEqual([[0, 0], [1, 0]]);
    expect(out).not.toBe(input);
  });
});

describe("distToSeg", () => {
  it("measures perpendicular distance and clamps at the endpoints", () => {
    expect(distToSeg([5, 3], [0, 0], [10, 0])).toBeCloseTo(3);
    expect(distToSeg([-4, 0], [0, 0], [10, 0])).toBeCloseTo(4); // before start
    expect(distToSeg([0, 0], [0, 0], [0, 0])).toBe(0); // degenerate segment
  });
});

describe("colourRuns / strokesForColor", () => {
  // 5 points -> 4 segments. Colour the middle two segments red.
  const pts: Pt[] = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];

  it("groups contiguous same-colour segments into one sub-path", () => {
    const runs = colourRuns(pts, [null, "red", "red", null]);
    expect(runs).toHaveLength(1);
    expect(runs[0].color).toBe("red");
    expect(runs[0].pts).toEqual([[1, 0], [2, 0], [3, 0]]);
  });

  it("separates non-adjacent runs of the same colour", () => {
    const strokes = strokesForColor(pts, ["red", null, "red", "red"], "red");
    expect(strokes).toHaveLength(2);
    expect(strokes[0]).toEqual([[0, 0], [1, 0]]);
    expect(strokes[1]).toEqual([[2, 0], [3, 0], [4, 0]]);
  });

  it("returns nothing for a colour that was never applied", () => {
    expect(strokesForColor(pts, ["red", "red", null, null], "blue")).toEqual([]);
  });
});
