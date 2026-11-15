import { expect, it } from "vitest";
import type { Calibration } from "../../api";
import { PAPER_FORMATS, formatSize, paperCornerAngles, plotAreaBase } from "./paperLayout";

it("compares DIN formats in actual millimetres for both orientations", () => {
  const a5 = PAPER_FORMATS.find((format) => format.id === "A5")!;
  expect(formatSize(a5, false)).toEqual({ w: 148, h: 210 });
  expect(formatSize(a5, true)).toEqual({ w: 210, h: 148 });
});

it("uses the stored plot base or reconstructs it from legacy effective area and margin", () => {
  const legacy = { origin_x: 30, origin_y: 13, plot_width: 130, plot_height: 180,
    paper_margin: 5 } as Calibration;
  const base = { x: 25, y: 8, w: 140, h: 190 };
  expect(plotAreaBase(legacy)).toEqual(base);
  expect(plotAreaBase({ ...legacy, paper_margin: 0, plot_area_base: base })).toEqual(base);
  expect(plotAreaBase({ ...legacy, paper_margin: 0 })).toEqual({ x: 30, y: 13, w: 130, h: 180 });
});

it("calculates each paper corner angle and rejects missing or degenerate corners", () => {
  const square = { tl: [0, 100], tr: [100, 100], br: [100, 0], bl: [0, 0] } as Record<string, [number, number]>;
  expect(paperCornerAngles(square)).toEqual({ tl: 90, tr: 90, br: 90, bl: 90 });
  const skewed = paperCornerAngles({ ...square, tr: [110, 100] })!;
  expect(skewed.tr).toBeLessThan(90);
  expect(skewed.br).toBeGreaterThan(90);
  expect(paperCornerAngles({ tl: square.tl, br: square.br })).toBeNull();
  expect(paperCornerAngles({ ...square, tr: square.tl })).toBeNull();
});
