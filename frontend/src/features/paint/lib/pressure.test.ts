import { describe, expect, it } from "vitest";
import type { Pt } from "./geometry";
import { pressurePreviewPaths, remapSegmentPressures, validSegmentPressures } from "./pressure";

const lines: Pt[][] = [[[0, 0], [10, 0], [10, 10]], [[30, 30], [40, 40]]];
describe("Xournal segment pressure", () => {
  it("rejects missing, misaligned, and invalid pressure values", () => {
    expect(validSegmentPressures(lines, [[0.2, 0.9], null])).toEqual([[0.2, 0.9], null]);
    for (const values of [[[0.2], null], [[0.2, NaN], null], [[0.2, 1.1], null], [[0.2, -0.1], null], [[0.2, 0.3]]]) {
      expect(validSegmentPressures(lines, values)).toBeUndefined();
    }
  });
  it("preserves pressure after clipping, reversing and splitting strokes", () => {
    const clipped: Pt[][] = [[[2, 0], [8, 0]], [[10, 8], [10, 4]], [[32, 32], [38, 38]]];
    expect(remapSegmentPressures(lines, [[0.2, 0.9], null], clipped)).toEqual([[0.2], [0.9], null]);
  });
  it("does not assign pressure to unrelated or newly created segments", () => {
    const changed: Pt[][] = [[[1, 1], [9, 9]], [[2, 0], [8, 0], [8, 8]]];
    expect(remapSegmentPressures(lines, [[0.2, 0.9], null], changed)).toEqual([null, [0.2, 0]]);
  });
  it("previews pressure without changing the points", () => {
    const before = structuredClone(lines);
    const paths = pressurePreviewPaths(lines, [[0, 1], null])!;
    expect(paths[0]).toContain("M0 0L10 0");
    expect(paths[7]).toBe("M10 0L10 10");
    expect(lines).toEqual(before);
  });
});
