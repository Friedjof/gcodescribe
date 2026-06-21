import { describe, expect, it } from "vitest";
import type { Calibration } from "../api";
import { buildDotsBoxesTemplate } from "./dotsBoxes";
import { buildSudokuTemplate } from "./sudoku";

const cal: Calibration = {
  bed_width: 220,
  bed_height: 220,
  z_max: 205,
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
  trust_axis_home: false,
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
    const settings = sudokuResponse("12345");
    const otherSeed = sudokuResponse("54321");

    expect(signature(buildSudokuTemplate(cal, t, settings)))
      .toBe(signature(buildSudokuTemplate(cal, t, settings)));
    expect(signature(buildSudokuTemplate(cal, t, settings)))
      .not.toBe(signature(buildSudokuTemplate(cal, t, otherSeed)));
  });

});

function sudokuResponse(seed: string) {
  return {
    seed,
    difficulty: "medium" as const,
    puzzle: [
      [5, 3, 0, 0, 7, 0, 0, 0, 0],
      [6, 0, 0, 1, 9, 5, 0, 0, 0],
      [0, 9, 8, 0, 0, 0, 0, 6, 0],
      [8, 0, 0, 0, 6, 0, 0, 0, 3],
      [4, 0, 0, 8, 0, 3, 0, 0, 1],
      [7, 0, 0, 0, 2, 0, 0, 0, 6],
      [0, 6, 0, 0, 0, 0, 2, 8, 0],
      [0, 0, 0, 4, 1, 9, 0, 0, 5],
      [0, 0, 0, 0, 8, 0, 0, 7, 9],
    ],
    solution: [
      [5, 3, 4, 6, 7, 8, 9, 1, 2],
      [6, 7, 2, 1, 9, 5, 3, 4, 8],
      [1, 9, 8, 3, 4, 2, 5, 6, 7],
      [8, 5, 9, 7, 6, 1, 4, 2, 3],
      [4, 2, 6, 8, 5, 3, 7, 9, 1],
      [7, 1, 3, 9, 2, 4, 8, 5, 6],
      [9, 6, 1, 5, 3, 7, 2, 8, 4],
      [2, 8, 7, 4, 1, 9, 6, 3, 5],
      [3, 4, 5, 2, 8, 6, 1, 7, 9],
    ],
    metadata: { unique_solution: true },
  };
}
