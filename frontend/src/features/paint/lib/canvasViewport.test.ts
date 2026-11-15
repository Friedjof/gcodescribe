import { expect, it } from "vitest";
import { fitCanvasView, rulerStep, rulerTicks } from "./canvasViewport";
it("fits the whole sheet with a real pixel gutter on wide and narrow viewports", () => {
  for (const size of [{width:1200,height:600},{width:400,height:900}]) {
    const view = fitCanvasView([0, 0, 210, 297], size, 32);
    const scale = size.width / view.w;
    expect(scale).toBeCloseTo(size.height / view.h);
    expect(-view.x * scale).toBeGreaterThanOrEqual(31.999);
    expect(-view.y * scale).toBeGreaterThanOrEqual(31.999);
    expect((view.x + view.w - 210) * scale).toBeGreaterThanOrEqual(31.999);
    expect((view.y + view.h - 297) * scale).toBeGreaterThanOrEqual(31.999);
  }
});
it("allows zero gutter and handles rotated physical bounds", () => {
  expect(fitCanvasView([-43.5,43.5,253.5,253.5], {width:594,height:420}, 0)).toEqual({x:-43.5,y:43.5,w:297,h:210});
});
it("keeps ruler labels at a legible distance and bounds work at any zoom", () => {
  for (const pixel of [.001, .1, 1, 1000]) {
    expect(rulerStep(pixel) / pixel).toBeGreaterThanOrEqual(60);
    expect(rulerTicks(-1000 * pixel, 2000 * pixel, pixel).length).toBeLessThan(40);
  }
  expect(rulerTicks(-10,30,.1)).toEqual([-10,0,10,20]);
});
