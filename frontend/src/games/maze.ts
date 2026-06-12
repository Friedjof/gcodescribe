import type { Calibration, MazeResponse } from "../api";
import type { Pt } from "../paint/geometry";
import type { MazeSize, TemplateSpec, Translator } from "./types";
import { gameTextWorld } from "./lettering";
import { centeredOrigin, mergeAxisAlignedSegments, usableArea } from "./utils";

// Band above the maze for the plotted header label, like the sudoku seed row.
export const MAZE_HEADER_BAND = 9;
const HEADER_TEXT_H = 5.5;

// The backend additionally clamps to its calibrated plot area, so oversized
// requests can never produce a maze that does not fit the paper. Dimensions
// are rounded down because the API works in whole millimetres — rounding up
// would make the returned maze overflow a fractional plot area.
export function mazeRequestArea(cal: Calibration) {
  const { width, height } = usableArea(cal);
  return {
    width: Math.max(Math.floor(width), 60),
    height: Math.max(Math.floor(height - MAZE_HEADER_BAND), 60),
  };
}

export function buildMazeTemplate(
  maze: MazeResponse,
  cal: Calibration,
  t: Translator,
  size: MazeSize,
): TemplateSpec {
  const totalH = maze.height + MAZE_HEADER_BAND;
  const [x0, y0] = centeredOrigin(maze.width, totalH, cal, t);
  const offset = ([x, y]: number[]): Pt => [x0 + x, y0 + MAZE_HEADER_BAND + y];

  const walls = mergeAxisAlignedSegments(maze.wall_lines.map((line) => line.map(offset)));
  const markers = maze.marker_lines.map((line) => line.map(offset));

  // Header label in the shared game lettering, top-right like sudoku.
  const label = `${t(`games.option.mazeType.${maze.type}`)} ${maze.seed.padStart(5, "0")}`;
  const labelW = label.length * 5.5 * 0.9 * (HEADER_TEXT_H / 8);
  const header = gameTextWorld(
    label,
    [x0 + maze.width - labelW, y0 + (MAZE_HEADER_BAND - HEADER_TEXT_H) / 2],
    HEADER_TEXT_H,
  );

  return {
    name: t("game.maze.name"),
    lines: [...walls, ...markers, ...header],
    solutionLines: maze.solution_lines.map((line) => line.map(offset)),
    width: maze.width,
    height: totalH,
    details: [
      { label: t("games.param.mazeSize"), value: t(`games.option.mazeSize.${size}`) },
      { label: t("games.param.mazeType"), value: t(`games.option.mazeType.${maze.type}`) },
      { label: t("games.param.seed"), value: maze.seed },
    ],
  };
}
