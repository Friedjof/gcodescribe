import { expect, it } from "vitest";
import { clipToPlot } from "./clipToPlot";
import { IDENTITY } from "./geometry";

it("clips crossings at all four boundaries while retaining edge strokes", () => {
  expect(clipToPlot([[[-5, 5], [15, 5]], [[5, -5], [5, 15]], [[0, 0], [10, 0]]], IDENTITY, 10, 10).lines)
    .toEqual([[[0, 5], [10, 5]], [[5, 0], [5, 10]], [[0, 0], [10, 0]]]);
});
it("splits exits and reentries without drawing a connector across a gap", () => {
  expect(clipToPlot([[[5, 5], [15, 5], [15, 8], [5, 8]]], IDENTITY, 10, 10).lines)
    .toEqual([[[5, 5], [10, 5]], [[10, 8], [5, 8]]]);
});
it("clips transformed geometry and removes fully outside strokes", () => {
  const result = clipToPlot([[[0, 0], [20, 0]], [[0, 20], [20, 20]]], { ...IDENTITY, x: -5, y: 5, scaleX: 2 }, 10, 10);
  expect(result.lines).toEqual([[[0, 5], [10, 5]]]);
  expect(result.changed).toBe(true);
});
it("keeps source pressure and interpolates feed at clipped endpoints", () => {
  const result = clipToPlot([[[-5, 5], [5, 5], [15, 5]]], IDENTITY, 10, 10, [[0.2, 0.8]], [[1, 2, 4]]);
  expect(result.lines).toEqual([[[0, 5], [5, 5], [10, 5]]]);
  expect(result.pressures).toEqual([[0.2, 0.8]]);
  expect(result.feeds).toEqual([[1.5, 2, 3]]);
});
it("does not flag an inside drawing or produce NaN at parallel boundaries", () => {
  expect(clipToPlot([[[0, 0], [0, 10]]], IDENTITY, 10, 10).changed).toBe(false);
  expect(clipToPlot([[[-1, -1], [-1, 15]]], IDENTITY, 10, 10).lines).toEqual([]);
});
