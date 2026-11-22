import { expect, it } from "vitest";
import { backsideFlip, backsideFrame } from "./backside";
import type { Calibration } from "../../../api";

const calibration = (patch: Partial<Calibration> = {}) => ({ plot_width: 200, plot_height: 280,
  origin_x: 5, origin_y: 5, flip_y: true, paper_corners: {}, ...patch }) as Calibration;

it("flips portrait and landscape paper along their actual long or short edge without scaling", () => {
  expect(backsideFlip(calibration(), "long").transform).toBe("matrix(-1 0 0 1 200 0)");
  expect(backsideFlip(calibration(), "short").transform).toBe("matrix(1 0 0 -1 0 280)");
  expect(backsideFlip(calibration({ plot_width: 280, plot_height: 200 }), "long").transform).toBe("matrix(1 0 0 -1 0 200)");
  expect(backsideFlip(calibration({ plot_width: 280, plot_height: 200 }), "short").transform).toBe("matrix(-1 0 0 1 280 0)");
});

it("aligns the reflection with the real sheet despite asymmetric plot margins", () => {
  const cal = calibration({ plot_width: 180, plot_height: 260, origin_x: 20, origin_y: 30,
    paper_corners: { bl: [10, 10], tr: [220, 307] } });
  expect(backsideFrame(cal)).toEqual({ x: -10, y: -17, width: 210, height: 297 });
  expect(backsideFlip(cal, "long").transform).toBe("matrix(-1 0 0 1 190 0)");
  // Bed X=50 reflects to X=180 about the sheet's midpoint X=115.
  expect(190 - (50 - cal.origin_x) + cal.origin_x).toBe(180);
  expect(backsideFlip(cal, "short").transform).toBe("matrix(1 0 0 -1 0 263)");
  expect(backsideFrame({ ...cal, flip_y: false }).y).toBe(-20);
});

it("ignores an incomplete or invalid paper outline and falls back to the drawing area", () => {
  expect(backsideFrame(calibration({ paper_corners: { bl: [10, 20], br: [100, 20] } })))
    .toEqual({ x: 0, y: 0, width: 200, height: 280 });
});

it("mirrors about the measured edge of a rotated sheet rather than the printer axes", () => {
  const flip = backsideFlip(calibration({ plot_height: 50, origin_x: 0, origin_y: 0,
    paper_corners: { bl: [0, 0], br: [10, 10], tr: [-10, 30], tl: [-20, 20] } }), "long");
  expect(flip.transform).toBe("matrix(0 1 1 0 -40 40)");
  // The measured front top-left (-20,30) becomes the measured top-right (-10,20).
  expect([30 - 40, -20 + 40]).toEqual(flip.paper[1]);
});
