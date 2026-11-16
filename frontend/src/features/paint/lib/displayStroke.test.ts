import { expect, it } from "vitest";
import { canvasUnitsPerPixel } from "./canvasTransforms";
import { DISPLAY_INK_PX, displayStrokeWorld } from "../../../lib/displayStroke";
it("keeps ink below one display pixel at different zoom levels and pane sizes", () => {
  for (const size of [
    { width: 1200, height: 700 },
    { width: 450, height: 650 },
  ])
    for (const zoom of [0.5, 1, 2, 12, 48]) {
      const view = { x: 0, y: 0, w: 300 / zoom, h: 300 / zoom };
      const pixel = canvasUnitsPerPixel(view, size);
      expect(displayStrokeWorld(pixel) / pixel).toBeCloseTo(DISPLAY_INK_PX);
      expect(DISPLAY_INK_PX).toBeLessThan(1);
    }
});

it("switches to vector detail before a capped raster would become enlarged", async () => {
  const { rasterFitsDisplay } = await import("../hooks/useGeometryRaster");
  const lines: [number, number][][] = [
    [
      [0, 0],
      [200, 200],
    ],
  ];
  expect(rasterFitsDisplay(lines, 0.3)).toBe(true);
  expect(rasterFitsDisplay(lines, 0.01)).toBe(false);
});
