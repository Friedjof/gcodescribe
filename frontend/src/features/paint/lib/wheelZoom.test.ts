import { expect, it } from "vitest";
import { wheelZoomFactor } from "./wheelZoom";

it("gives pixel, line and page wheels the same zoom for the same distance", () => {
  const pixels = wheelZoomFactor(-120, 0, 800);
  expect(wheelZoomFactor(-3, 1, 800)).toBeCloseTo(pixels);
  expect(wheelZoomFactor(-0.15, 2, 800)).toBeCloseTo(pixels);
  expect(pixels).toBeGreaterThan(1);
  expect(wheelZoomFactor(120, 0, 800) * pixels).toBeCloseTo(1);
});

it("ignores invalid deltas and bounds extreme input", () => {
  expect(wheelZoomFactor(NaN, 0, 800)).toBe(1);
  expect(wheelZoomFactor(Infinity, 0, 800)).toBe(1);
  expect(Number.isFinite(wheelZoomFactor(-Number.MAX_VALUE, 0, 800))).toBe(true);
});
