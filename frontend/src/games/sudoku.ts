import type { Calibration } from "../api";
import type { Pt } from "../paint/geometry";
import type { SudokuDifficulty, TemplateSpec, Translator } from "./types";
import { clamp, formatMm, rectOutline, centerText, usableArea, centeredOrigin, mulberry32, shuffle } from "./utils";
import { gameTextWorld } from "./lettering";

const SEED_ROW_H = 8;
const SEED_GAP = 2;

export function buildSudokuTemplate(
  cal: Calibration,
  t: Translator,
  settings: { difficulty: SudokuDifficulty; seed: number },
): TemplateSpec {
  const { width: usableWidth, height: usableHeight } = usableArea(cal);
  const boardMax = Math.min(usableWidth, usableHeight - SEED_ROW_H - SEED_GAP);
  const board = boardMax * 0.94;
  const cell = board / 9;
  const totalH = board + SEED_ROW_H + SEED_GAP;
  const [x0, y0] = centeredOrigin(board, totalH, cal, t);
  const boardY = y0 + SEED_ROW_H + SEED_GAP;
  const lines: Pt[][] = [];
  const { puzzle, solution } = sudokuPuzzle(settings.seed, settings.difficulty);
  const thick = clamp(cell * 0.022, 0.9, 2.0);

  for (const i of [1, 2, 4, 5, 7, 8]) {
    lines.push([[x0 + i * cell, boardY], [x0 + i * cell, boardY + board]]);
    lines.push([[x0, boardY + i * cell], [x0 + board, boardY + i * cell]]);
  }

  for (const d of [-thick, 0, thick]) {
    lines.push(rectOutline(x0 + d, boardY + d, board - 2 * d, board - 2 * d));
  }

  for (const i of [3, 6]) {
    for (const d of [-thick, 0, thick]) {
      lines.push([[x0 + i * cell + d, boardY], [x0 + i * cell + d, boardY + board]]);
      lines.push([[x0, boardY + i * cell + d], [x0 + board, boardY + i * cell + d]]);
    }
  }

  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const value = puzzle[row][col];
      if (!value) continue;
      lines.push(...centerText(String(value), [x0 + (col + 0.5) * cell, boardY + (row + 0.54) * cell], cell * 0.42, cell * 0.56));
    }
  }

  // Seed label — plotted, top-right above the board.
  const seedStr = `${settings.difficulty} ${String(settings.seed).padStart(5, "0")}`;
  const seedTextH = 5.5;
  const seedTextW = seedStr.length * 5.5 * 0.9 * (seedTextH / 8);
  const seedX = x0 + board - seedTextW;
  const seedY = y0 + (SEED_ROW_H - seedTextH) / 2;
  lines.push(...gameTextWorld(seedStr, [seedX, seedY], seedTextH));

  // Solution overlay — not plotted, only shown in preview.
  const solutionLines: Pt[][] = [];
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      if (!puzzle[row][col]) {
        solutionLines.push(...centerText(
          String(solution[row][col]),
          [x0 + (col + 0.5) * cell, boardY + (row + 0.54) * cell],
          cell * 0.42,
          cell * 0.56,
        ));
      }
    }
  }

  return {
    name: t("game.sudoku.name"),
    lines,
    solutionLines,
    width: board,
    height: totalH,
    details: [
      { label: t("games.param.boardCount"), value: "1" },
      { label: t("games.param.boardSize"), value: "9 × 9" },
      { label: t("games.param.difficulty"), value: t(`games.option.difficulty.${settings.difficulty}`) },
      { label: t("games.param.cellSize"), value: formatMm(cell) },
    ],
  };
}

function sudokuPuzzle(seed: number, difficulty: SudokuDifficulty): { puzzle: number[][]; solution: number[][] } {
  const rand = mulberry32(seed);
  const solved = solvedSudoku(rand);
  const solution = solved.map((row) => [...row]);
  const puzzle = solved.map((row) => [...row]);
  const removeCount = difficulty === "easy" ? 38 : difficulty === "hard" ? 56 : 48;
  const cells = Array.from({ length: 81 }, (_, index) => index);
  shuffle(cells, rand);
  for (let i = 0; i < removeCount; i++) {
    const index = cells[i];
    puzzle[Math.floor(index / 9)][index % 9] = 0;
  }
  return { puzzle, solution };
}

function solvedSudoku(rand: () => number): number[][] {
  const bands = [0, 1, 2];
  const rows = shuffledSudokuAxis(bands, rand);
  const cols = shuffledSudokuAxis(bands, rand);
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  shuffle(digits, rand);
  const pattern = (row: number, col: number) => (row * 3 + Math.floor(row / 3) + col) % 9;
  return rows.map((row) => cols.map((col) => digits[pattern(row, col)]));
}

function shuffledSudokuAxis(groups: number[], rand: () => number) {
  const outer = [...groups];
  shuffle(outer, rand);
  return outer.flatMap((group) => {
    const inner = [0, 1, 2];
    shuffle(inner, rand);
    return inner.map((offset) => group * 3 + offset);
  });
}
