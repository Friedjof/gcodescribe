import { expect, it } from "vitest";
import { DISPLAY_INK_PX } from "../../../lib/displayStroke";
import { rasterStrokeWidth, RASTER_MAX_EDGE } from "./rasterPreview";

it("reuses a decoded preview for small zoom adjustments", () => {
  const edge = 200;
  expect(rasterStrokeWidth(edge, .29, .3)).toBe(.3);
  expect(rasterStrokeWidth(edge, .31, .3)).toBe(.3);
  expect(rasterStrokeWidth(edge, .15, .3)).toBe(.15);
});
it("keeps cosmetic ink close to its requested size with a bounded texture", () => {
  for (const stroke of [.1, .15, .2, .3, .4, .6, 1, 2]) {
    const width = rasterStrokeWidth(200, stroke);
    expect(width / stroke).toBeGreaterThanOrEqual(1 / 1.1);
    expect(width / stroke).toBeLessThanOrEqual(1.1);
    expect(width).toBeGreaterThanOrEqual(200 * DISPLAY_INK_PX / RASTER_MAX_EDGE);
  }
  expect(rasterStrokeWidth(200, .00001)).toBe(200 * DISPLAY_INK_PX / RASTER_MAX_EDGE);
});
