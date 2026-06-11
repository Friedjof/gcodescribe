import type { Calibration } from "../api";
import type { Pt } from "../paint/geometry";
import type { MazeSize, MazeType, TemplateSpec, Translator } from "./types";
import { clamp, formatMm, usableArea, centeredOrigin, mulberry32, randomInt } from "./utils";
import { gameTextWorld } from "./lettering";

type MazeCell = {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
  visited: boolean;
};

// Space reserved above the maze for the seed label.
const SEED_ROW_H = 8;
const SEED_GAP = 2;

export function buildMazeTemplate(
  cal: Calibration,
  seed: number,
  settings: { size: MazeSize; type: MazeType },
  t: Translator,
): TemplateSpec {
  const { width: usableWidth, height: usableHeight } = usableArea(cal);
  const sizeFactor =
    settings.size === "small"   ? 1.24 :
    settings.size === "large"   ? 0.82 :
    settings.size === "extreme" ? 0.58 : 1;
  const mazeMaxH = usableHeight - SEED_ROW_H - SEED_GAP;
  const targetCell = clamp((Math.min(usableWidth, mazeMaxH) / 14) * sizeFactor, 7, 16);
  const cols = clamp(Math.floor(usableWidth / targetCell), 8, 30);
  const rows = clamp(Math.floor(mazeMaxH / targetCell), 10, 40);
  const cell = Math.min(usableWidth / cols, mazeMaxH / rows);
  const mazeW = cols * cell;
  const mazeH = rows * cell;
  const totalH = mazeH + SEED_ROW_H + SEED_GAP;
  const [x0, y0] = centeredOrigin(mazeW, totalH, cal, t);
  const mazeY0 = y0 + SEED_ROW_H + SEED_GAP;

  const maze = buildMazeCells(cols, rows, seed, settings.type);
  maze[0][0].left = false;
  maze[rows - 1][cols - 1].right = false;

  const lines: Pt[][] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const c = maze[row][col];
      const px = x0 + col * cell;
      const py = mazeY0 + row * cell;
      if (c.top) lines.push([[px, py], [px + cell, py]]);
      if (c.left) lines.push([[px, py], [px, py + cell]]);
      if (row === rows - 1 && c.bottom) lines.push([[px, py + cell], [px + cell, py + cell]]);
      if (col === cols - 1 && c.right) lines.push([[px + cell, py], [px + cell, py + cell]]);
    }
  }

  // Seed label — plotted, top-right above the maze.
  const seedStr = String(seed).padStart(5, "0");
  const seedTextH = 5.5;
  // Estimate total advance: ~5 digits × avg-advance × WIDTH_SCALE × unit
  const seedTextW = seedStr.length * 5.5 * 0.9 * (seedTextH / 8);
  const seedX = x0 + mazeW - seedTextW;
  const seedY = y0 + (SEED_ROW_H - seedTextH) / 2;
  lines.push(...gameTextWorld(seedStr, [seedX, seedY], seedTextH));

  // BFS solution path — not plotted, only shown as preview overlay.
  const solutionPath = solveMaze(maze, cols, rows);
  const solutionLines: Pt[][] = [
    [
      [x0, mazeY0 + 0.5 * cell],
      ...solutionPath.map(([col, row]) => [x0 + (col + 0.5) * cell, mazeY0 + (row + 0.5) * cell] as Pt),
      [x0 + mazeW, mazeY0 + (rows - 0.5) * cell],
    ],
  ];

  return {
    name: t("game.maze.name"),
    lines,
    solutionLines,
    width: mazeW,
    height: totalH,
    details: [
      { label: t("games.param.mazeSize"),  value: t(`games.option.mazeSize.${settings.size}`) },
      { label: t("games.param.mazeType"),  value: t(`games.option.mazeType.${settings.type}`) },
      { label: t("games.param.mazeCols"),  value: String(cols) },
      { label: t("games.param.mazeRows"),  value: String(rows) },
      { label: t("games.param.cellSize"),  value: formatMm(cell) },
    ],
  };
}

// ─── BFS solver ───────────────────────────────────────────────────────────────
function solveMaze(maze: MazeCell[][], cols: number, rows: number): Array<[number, number]> {
  const encode = (c: number, r: number) => r * cols + c;
  const target = encode(cols - 1, rows - 1);
  const prev = new Map<number, number>();
  const visited = new Set<number>([0]);
  const q: number[] = [0];

  outer: while (q.length) {
    const cur = q.shift()!;
    const col = cur % cols;
    const row = Math.floor(cur / cols);
    const c = maze[row][col];
    const moves: [number, number, boolean][] = [
      [col,     row - 1, !c.top],
      [col + 1, row,     !c.right],
      [col,     row + 1, !c.bottom],
      [col - 1, row,     !c.left],
    ];
    for (const [nc, nr, passable] of moves) {
      if (!passable || nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const key = encode(nc, nr);
      if (visited.has(key)) continue;
      visited.add(key);
      prev.set(key, cur);
      if (key === target) break outer;
      q.push(key);
    }
  }

  const path: Array<[number, number]> = [];
  let cur = target;
  while (prev.has(cur)) {
    path.unshift([cur % cols, Math.floor(cur / cols)]);
    cur = prev.get(cur)!;
  }
  path.unshift([0, 0]);
  return path;
}

function buildMazeCells(cols: number, rows: number, seed: number, type: MazeType): MazeCell[][] {
  if (type === "branchy") return primMaze(cols, rows, seed);
  const cells = carveMaze(cols, rows, seed);
  if (type === "braid") braidMaze(cells, seed + 1);
  return cells;
}

function carveMaze(cols: number, rows: number, seed: number): MazeCell[][] {
  const rand = mulberry32(seed);
  const cells = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ top: true, right: true, bottom: true, left: true, visited: false }))
  );
  const stack: [number, number][] = [[0, 0]];
  cells[0][0].visited = true;

  while (stack.length) {
    const [col, row] = stack[stack.length - 1];
    const options: [number, number, "top" | "right" | "bottom" | "left"][] = [];
    if (row > 0 && !cells[row - 1][col].visited) options.push([col, row - 1, "top"]);
    if (col + 1 < cols && !cells[row][col + 1].visited) options.push([col + 1, row, "right"]);
    if (row + 1 < rows && !cells[row + 1][col].visited) options.push([col, row + 1, "bottom"]);
    if (col > 0 && !cells[row][col - 1].visited) options.push([col - 1, row, "left"]);

    if (!options.length) { stack.pop(); continue; }

    const [nextCol, nextRow, dir] = options[Math.floor(rand() * options.length)];
    const current = cells[row][col];
    const next = cells[nextRow][nextCol];
    if (dir === "top")    { current.top = false;    next.bottom = false; }
    else if (dir === "right")  { current.right = false;  next.left = false; }
    else if (dir === "bottom") { current.bottom = false; next.top = false; }
    else                       { current.left = false;   next.right = false; }
    next.visited = true;
    stack.push([nextCol, nextRow]);
  }

  return cells;
}

function primMaze(cols: number, rows: number, seed: number): MazeCell[][] {
  const rand = mulberry32(seed);
  const cells = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ top: true, right: true, bottom: true, left: true, visited: false }))
  );
  const startCol = randomInt(rand, 0, cols);
  const startRow = randomInt(rand, 0, rows);
  const frontier: Array<[number, number]> = [];
  const frontierSet = new Set<string>();
  const markFrontier = (col: number, row: number) => {
    if (col < 0 || row < 0 || col >= cols || row >= rows || cells[row][col].visited) return;
    const key = `${col}:${row}`;
    if (frontierSet.has(key)) return;
    frontierSet.add(key);
    frontier.push([col, row]);
  };

  cells[startRow][startCol].visited = true;
  markFrontier(startCol, startRow - 1);
  markFrontier(startCol + 1, startRow);
  markFrontier(startCol, startRow + 1);
  markFrontier(startCol - 1, startRow);

  while (frontier.length) {
    const index = randomInt(rand, 0, frontier.length);
    const [col, row] = frontier.splice(index, 1)[0];
    frontierSet.delete(`${col}:${row}`);
    const visitedNeighbors: Array<[number, number, "top" | "right" | "bottom" | "left"]> = [];
    if (row > 0 && cells[row - 1][col].visited) visitedNeighbors.push([col, row - 1, "top"]);
    if (col + 1 < cols && cells[row][col + 1].visited) visitedNeighbors.push([col + 1, row, "right"]);
    if (row + 1 < rows && cells[row + 1][col].visited) visitedNeighbors.push([col, row + 1, "bottom"]);
    if (col > 0 && cells[row][col - 1].visited) visitedNeighbors.push([col - 1, row, "left"]);
    const [nextCol, nextRow, dir] = visitedNeighbors[randomInt(rand, 0, visitedNeighbors.length)];
    openWall(cells, col, row, nextCol, nextRow, dir);
    cells[row][col].visited = true;
    markFrontier(col, row - 1);
    markFrontier(col + 1, row);
    markFrontier(col, row + 1);
    markFrontier(col - 1, row);
  }

  return cells;
}

function braidMaze(cells: MazeCell[][], seed: number) {
  const rand = mulberry32(seed);
  const rows = cells.length;
  const cols = cells[0]?.length ?? 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cell = cells[row][col];
      const wallCount = Number(cell.top) + Number(cell.right) + Number(cell.bottom) + Number(cell.left);
      if (wallCount !== 3 || rand() > 0.72) continue;
      const options: Array<[number, number, "top" | "right" | "bottom" | "left"]> = [];
      if (row > 0 && cell.top) options.push([col, row - 1, "top"]);
      if (col + 1 < cols && cell.right) options.push([col + 1, row, "right"]);
      if (row + 1 < rows && cell.bottom) options.push([col, row + 1, "bottom"]);
      if (col > 0 && cell.left) options.push([col - 1, row, "left"]);
      if (!options.length) continue;
      const [nextCol, nextRow, dir] = options[randomInt(rand, 0, options.length)];
      openWall(cells, col, row, nextCol, nextRow, dir);
    }
  }
}

function openWall(
  cells: MazeCell[][],
  col: number,
  row: number,
  nextCol: number,
  nextRow: number,
  dir: "top" | "right" | "bottom" | "left",
) {
  const current = cells[row][col];
  const next = cells[nextRow][nextCol];
  if (dir === "top")    { current.top = false;    next.bottom = false; }
  else if (dir === "right")  { current.right = false;  next.left = false; }
  else if (dir === "bottom") { current.bottom = false; next.top = false; }
  else                       { current.left = false;   next.right = false; }
}
