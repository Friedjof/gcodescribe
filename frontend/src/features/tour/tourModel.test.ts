import { describe, expect, it } from "vitest";
import { placeTourCard, readTour, TOUR_STEPS } from "./tourModel";
describe("tour records and placement", () => {
  it("rejects corrupt and future records and bounds a resumable step", () => {
    expect(readTour({ getItem: () => "broken" })).toBeNull();
    expect(
      readTour({
        getItem: () =>
          JSON.stringify({ version: 2, state: "finished", step: 3 }),
      }),
    ).toBeNull();
    expect(
      readTour({
        getItem: () =>
          JSON.stringify({ version: 1, state: "progress", step: 999 }),
      })?.step,
    ).toBe(TOUR_STEPS.length - 1);
    expect(
      readTour({
        getItem: () => {
          throw Error("Storage denied");
        },
      }),
    ).toBeNull();
  });
  it("keeps cards inside each supported desktop viewport, including edge targets", () => {
    for (const width of [1024, 1366, 1920])
      for (const side of ["left", "right", "top", "bottom"] as const) {
        const card = { width: 344, height: 310 };
        for (const anchor of [
          { left: 5, top: 5, width: 30, height: 30 },
          { left: width - 45, top: 700, width: 30, height: 30 },
          { left: 172, top: 130, width: width - 190, height: 550 },
          null,
        ]) {
          const point = placeTourCard(
            anchor,
            card,
            { width, height: 768 },
            side,
          );
          expect(point.left).toBeGreaterThanOrEqual(12);
          expect(point.top).toBeGreaterThanOrEqual(12);
          expect(point.left + card.width).toBeLessThanOrEqual(width - 12);
          expect(point.top + card.height).toBeLessThanOrEqual(768 - 12);
        }
      }
  });
});
