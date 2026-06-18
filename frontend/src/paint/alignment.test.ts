import { describe, it, expect } from "vitest";
import { alignmentCandidates, snapToGuides, type Bounds } from "./geometry";

describe("alignmentCandidates", () => {
  it("includes canvas edges and midlines on both axes", () => {
    const { vertical, horizontal } = alignmentCandidates([], 100, 80);
    expect(vertical.map((c) => c.pos)).toEqual([0, 50, 100]);
    expect(horizontal.map((c) => c.pos)).toEqual([0, 40, 80]);
  });

  it("adds left/center/right and top/center/bottom per object", () => {
    const obj: Bounds = [10, 20, 30, 60];
    const { vertical, horizontal } = alignmentCandidates([obj], 100, 80);
    expect(vertical.map((c) => c.pos)).toContain(10); // left
    expect(vertical.map((c) => c.pos)).toContain(20); // center x
    expect(vertical.map((c) => c.pos)).toContain(30); // right
    expect(horizontal.map((c) => c.pos)).toContain(20); // top
    expect(horizontal.map((c) => c.pos)).toContain(40); // center y
    expect(horizontal.map((c) => c.pos)).toContain(60); // bottom
  });
});

describe("snapToGuides", () => {
  const { vertical, horizontal } = alignmentCandidates([], 100, 80);

  it("snaps the selection center to the canvas midline within tolerance", () => {
    // Selection 40..60 (center 50 already aligned at dx=0): pull from a small offset.
    const sel: Bounds = [38, 30, 58, 50]; // center x = 48
    const out = snapToGuides(sel, 0, 0, vertical, horizontal, 5);
    expect(out.dx).toBeCloseTo(2); // 48 -> 50
    expect(out.guides.some((g) => g.axis === "x" && g.pos === 50)).toBe(true);
  });

  it("leaves the move untouched when nothing is within tolerance", () => {
    const sel: Bounds = [12, 12, 20, 20];
    const out = snapToGuides(sel, 3, 3, vertical, horizontal, 1);
    expect(out.dx).toBe(3);
    expect(out.dy).toBe(3);
    expect(out.guides).toHaveLength(0);
  });

  it("snaps a moving edge to another object's edge", () => {
    const ref: Bounds = [60, 10, 80, 30];
    const cands = alignmentCandidates([ref], 100, 80);
    const sel: Bounds = [38, 10, 58, 30]; // right edge 58, want it on ref left (60)
    const out = snapToGuides(sel, 0, 0, cands.vertical, cands.horizontal, 5);
    expect(out.dx).toBeCloseTo(2); // 58 -> 60
  });

  it("snaps x and y independently", () => {
    const sel: Bounds = [47, 37, 53, 43]; // center (50,40) = canvas center, offset slightly
    const out = snapToGuides(sel, 1, -1, vertical, horizontal, 5);
    expect(out.dx).toBeCloseTo(0); // 51 -> 50
    expect(out.dy).toBeCloseTo(0); // 39 -> 40
    expect(out.guides).toHaveLength(2);
  });
});
