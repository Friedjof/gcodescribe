import { describe, expect, it } from "vitest";
import type { Calibration } from "../api";
import { buildDotsBoxesTemplate } from "./dotsBoxes";
import { buildSudokuTemplate } from "./sudoku";

const cal: Calibration = {
  bed_width: 220,
  bed_height: 220,
  plot_width: 180,
  plot_height: 160,
  origin_x: 0,
  origin_y: 0,
  pen_up_z: 5,
  pen_down_z: 0,
  pen_calibrated: true,
  travel_feed: 3000,
  draw_feed: 1200,
  z_feed: 600,
  fit_to_area: true,
  flip_y: false,
  paper_corners: {},
  paper_margin: 0,
};

const t = (key: string) => key;
type GeneratedTemplate = ReturnType<typeof buildDotsBoxesTemplate> | ReturnType<typeof buildSudokuTemplate>;

const signature = (template: GeneratedTemplate) => JSON.stringify({
  lines: template.lines,
  solutionLines: template.solutionLines,
  width: template.width,
  height: template.height,
  details: template.details,
});

describe("seeded game templates", () => {
  it("builds identical dots and boxes boards for the same seed and settings", () => {
    const settings = { density: "balanced", seed: 12345, jitter: "organic", playable: "balanced" } as const;
    const otherSeed = { ...settings, seed: 54321 };

    expect(signature(buildDotsBoxesTemplate(cal, t, settings)))
      .toBe(signature(buildDotsBoxesTemplate(cal, t, settings)));
    expect(signature(buildDotsBoxesTemplate(cal, t, settings)))
      .not.toBe(signature(buildDotsBoxesTemplate(cal, t, otherSeed)));
  });

  it("builds identical sudoku puzzles for the same seed and difficulty", () => {
    const settings = { difficulty: "medium", seed: 12345 } as const;
    const otherSeed = { ...settings, seed: 54321 };

    expect(signature(buildSudokuTemplate(cal, t, settings)))
      .toBe(signature(buildSudokuTemplate(cal, t, settings)));
    expect(signature(buildSudokuTemplate(cal, t, settings)))
      .not.toBe(signature(buildSudokuTemplate(cal, t, otherSeed)));
  });
});
