import { describe, expect, it } from "vitest";
import type { Pt } from "./geometry";
import { isMaskObject, subtractPolygon } from "./masks";

const SQUARE: Pt[] = [[2, 2], [8, 2], [8, 8], [2, 8]]; // convex box

describe("isMaskObject", () => {
  it("matches the designer's erase masks", () => {
    expect(isMaskObject({ id: "m", type: "mask", data: { mask: "erase" } } as any)).toBe(true);
    expect(isMaskObject({ id: "m", type: "mask-rect" } as any)).toBe(true);
    expect(isMaskObject({ id: "o", type: "line" } as any)).toBe(false);
  });
});

describe("subtractPolygon", () => {
  it("cuts out the part of a line crossing the mask", () => {
    const pieces = subtractPolygon([[0, 5], [10, 5]], SQUARE);
    expect(pieces).toHaveLength(2);
    expect(pieces[0][0]).toEqual([0, 5]);
    expect(pieces[0][pieces[0].length - 1]).toEqual([2, 5]);
    expect(pieces[1][0]).toEqual([8, 5]);
    expect(pieces[1][pieces[1].length - 1]).toEqual([10, 5]);
  });

  it("removes a line fully inside the mask", () => {
    expect(subtractPolygon([[3, 5], [7, 5]], SQUARE)).toEqual([]);
  });

  it("keeps a line fully outside the mask", () => {
    const pieces = subtractPolygon([[0, 0], [10, 0]], SQUARE);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toEqual([[0, 0], [10, 0]]);
  });
});
