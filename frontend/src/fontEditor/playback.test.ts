import { describe, expect, it } from "vitest";
import { buildTimeline, revealCounts } from "./playback";
import type { Stroke } from "../api";

function stroke(id: string, pts: { x: number; y: number; t: number }[]): Stroke {
  return { id, rawPoints: [], points: pts };
}

// "i" — a vertical stem (multi-point) plus a dot (single point). Each stroke's
// timestamps start near 0, as captured per-stroke.
const stem = stroke("stem", [
  { x: 0, y: 0, t: 0 },
  { x: 0, y: 100, t: 100 },
  { x: 0, y: 200, t: 200 },
]);
const dot = stroke("dot", [{ x: 0, y: 300, t: 0 }]);

describe("playback timeline", () => {
  it("orders multiple strokes after one another with a gap", () => {
    const { seq, total } = buildTimeline([stem, dot]);
    const stemItems = seq.filter((i) => i.stroke === 0);
    const dotItems = seq.filter((i) => i.stroke === 1);
    expect(stemItems).toHaveLength(3);
    expect(dotItems).toHaveLength(1);
    // The dot starts only after the stem finished + the pen-up gap.
    expect(dotItems[0].time).toBeGreaterThan(stemItems[2].time);
    expect(total).toBe(dotItems[0].time);
  });

  it("reveals every stroke as time advances (not just the first)", () => {
    const timeline = buildTimeline([stem, dot]);

    // Start: only the stem's first point.
    expect(revealCounts(timeline, 0, 2)).toEqual([1, 0]);

    // Midway through the stem.
    expect(revealCounts(timeline, 100, 2)).toEqual([2, 0]);

    // At the very end every stroke is fully revealed — the dot included.
    const end = revealCounts(timeline, timeline.total, 2);
    expect(end).toEqual([3, 1]);
  });

  it("handles three strokes", () => {
    const a = stroke("a", [{ x: 0, y: 0, t: 0 }, { x: 10, y: 0, t: 50 }]);
    const b = stroke("b", [{ x: 0, y: 0, t: 0 }, { x: 0, y: 10, t: 50 }]);
    const c = stroke("c", [{ x: 5, y: 5, t: 0 }]);
    const timeline = buildTimeline([a, b, c]);
    expect(revealCounts(timeline, timeline.total, 3)).toEqual([2, 2, 1]);
  });

  it("skips empty strokes without breaking indices", () => {
    const empty: Stroke = { id: "empty", rawPoints: [], points: [] };
    const timeline = buildTimeline([empty, dot]);
    // Only the dot contributes; its stroke index (1) is preserved.
    expect(timeline.seq.every((i) => i.stroke === 1)).toBe(true);
  });
});
