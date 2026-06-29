import { describe, expect, it } from "vitest";
import type { Calibration, MazeResponse } from "../api";
import { buildMazeTemplate, mazeRequestArea, MAZE_HEADER_BAND } from "./maze";
import { PAGE_MARGIN } from "./constants";

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
  park_after_plot: true,
  paper_corners: {},
  paper_margin: 0,
  obstacles: [],
  merge_tolerance: 0.5,
};

const t = (key: string) => key;

const maze: MazeResponse = {
  type: "classic",
  seed: "12345",
  size: 20,
  width: 172,
  height: 143,
  viewBox: "0 0 172 143",
  maze_svg: "<svg/>",
  solution_svg: "<svg/>",
  start: { x: 5, y: 5 },
  end: { x: 167, y: 138 },
  wall_lines: [
    [[0, 0], [10, 0]],
    [[10, 0], [20, 0]],
    [[0, 0], [0, 10]],
  ],
  marker_lines: [[[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]],
  solution_lines: [[[5, 0], [5, 5], [15, 5]]],
  metadata: { algorithm: "growing_tree", unique_solution: true },
};

describe("maze template", () => {
  it("reserves a header band inside the usable plot area", () => {
    const area = mazeRequestArea(cal);
    expect(area.width).toBe(cal.plot_width - 2 * PAGE_MARGIN);
    expect(area.height).toBe(cal.plot_height - 2 * PAGE_MARGIN - MAZE_HEADER_BAND);
  });

  it("rounds fractional plot areas down so the returned maze always fits", () => {
    const fractional = { ...cal, plot_width: 152.8, plot_height: 200.0 };
    const area = mazeRequestArea(fractional);
    expect(area.width).toBe(144);
    expect(area.height).toBe(183);

    const template = buildMazeTemplate(
      { ...maze, width: area.width, height: area.height },
      fractional,
      t,
      "medium",
    );
    expect(template.height).toBe(area.height + MAZE_HEADER_BAND);
  });

  it("offsets walls, markers and solution below the header and adds lettering", () => {
    const template = buildMazeTemplate(maze, cal, t, "medium");
    const x0 = (cal.plot_width - maze.width) / 2;
    const y0 = (cal.plot_height - maze.height - MAZE_HEADER_BAND) / 2;

    // The two collinear wall segments are merged into one.
    expect(template.lines).toContainEqual([[x0, y0 + MAZE_HEADER_BAND], [x0 + 20, y0 + MAZE_HEADER_BAND]]);
    // Marker polyline is offset the same way.
    expect(template.lines).toContainEqual(
      maze.marker_lines[0].map(([x, y]) => [x0 + x, y0 + MAZE_HEADER_BAND + y]),
    );
    // Header lettering sits above the maze body.
    const headerLines = template.lines.filter((line) => line.every(([, y]) => y < y0 + MAZE_HEADER_BAND));
    expect(headerLines.length).toBeGreaterThan(5);
    expect(template.solutionLines?.[0][0]).toEqual([x0 + 5, y0 + MAZE_HEADER_BAND]);
    expect(template.height).toBe(maze.height + MAZE_HEADER_BAND);
  });

  it("is deterministic for identical responses", () => {
    const a = buildMazeTemplate(maze, cal, t, "medium");
    const b = buildMazeTemplate(maze, cal, t, "medium");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
