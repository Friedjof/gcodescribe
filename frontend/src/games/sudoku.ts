import type { Calibration, SudokuResponse } from "../api";
import type { Pt } from "../paint/geometry";
import type { TemplateSpec, Translator } from "./types";
import { clamp, formatMm, rectOutline, centerText, usableArea, centeredOrigin } from "./utils";
import { gameTextWorld } from "./lettering";

const SEED_ROW_H = 8;
const SEED_GAP = 2;

export function buildSudokuTemplate(
  cal: Calibration,
  t: Translator,
  sudoku: SudokuResponse,
): TemplateSpec {
  const { width: usableWidth, height: usableHeight } = usableArea(cal);
  const boardMax = Math.min(usableWidth, usableHeight - SEED_ROW_H - SEED_GAP);
  const board = boardMax * 0.94;
  const cell = board / 9;
  const totalH = board + SEED_ROW_H + SEED_GAP;
  const [x0, y0] = centeredOrigin(board, totalH, cal, t);
  const boardY = y0 + SEED_ROW_H + SEED_GAP;
  const lines: Pt[][] = [];
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
      const value = sudoku.puzzle[row][col];
      if (!value) continue;
      lines.push(...centerText(String(value), [x0 + (col + 0.5) * cell, boardY + (row + 0.54) * cell], cell * 0.42, cell * 0.56));
    }
  }

  const seedStr = `${sudoku.difficulty} ${sudoku.seed.padStart(5, "0")}`;
  const seedTextH = 5.5;
  const seedTextW = seedStr.length * 5.5 * 0.9 * (seedTextH / 8);
  const seedX = x0 + board - seedTextW;
  const seedY = y0 + (SEED_ROW_H - seedTextH) / 2;
  lines.push(...gameTextWorld(seedStr, [seedX, seedY], seedTextH));

  const solutionLines: Pt[][] = [];
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      if (!sudoku.puzzle[row][col]) {
        solutionLines.push(...centerText(
          String(sudoku.solution[row][col]),
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
      { label: t("games.param.difficulty"), value: t(`games.option.difficulty.${sudoku.difficulty}`) },
      { label: t("games.param.cellSize"), value: formatMm(cell) },
    ],
  };
}
