import type { Calibration } from "../api";
import type { Pt } from "../paint/geometry";
import type { BattleshipsSize, TemplateSpec, Translator } from "./types";
import { clamp, formatMm, rectOutline, centerText, usableArea, centeredOrigin } from "./utils";

export function buildBattleshipsTemplate(cal: Calibration, t: Translator, sizeSetting: BattleshipsSize): TemplateSpec {
  const { width: usableWidth, height: usableHeight } = usableArea(cal);
  const boardSize = sizeSetting === "s8" ? 8 : sizeSetting === "s12" ? 12 : 10;
  const labelBand = clamp(Math.min(usableWidth, usableHeight) * 0.04, 7, 11);
  const titleBand = clamp(labelBand * 1.55, 10, 16);
  const gap = clamp(Math.min(usableWidth, usableHeight) * 0.055, 8, 14);
  const sideCell = Math.min(
    (usableWidth - gap - labelBand * 2) / (boardSize * 2),
    (usableHeight - titleBand - labelBand) / boardSize,
  );
  const stackedCell = Math.min(
    (usableWidth - labelBand) / boardSize,
    (usableHeight - gap - 2 * (titleBand + labelBand)) / (boardSize * 2),
  );
  const sideBySide = sideCell >= stackedCell;
  const cell = sideBySide ? sideCell : stackedCell;
  const boardWidth = labelBand + cell * boardSize;
  const boardHeight = titleBand + labelBand + cell * boardSize;
  const width = sideBySide ? boardWidth * 2 + gap : boardWidth;
  const height = sideBySide ? boardHeight : boardHeight * 2 + gap;
  const [x0, y0] = centeredOrigin(width, height, cal, t);
  const lines: Pt[][] = [];
  const boards: Array<{ x: number; y: number; title: string }> = sideBySide
    ? [
        { x: x0, y: y0, title: t("games.battleships.own") },
        { x: x0 + boardWidth + gap, y: y0, title: t("games.battleships.target") },
      ]
    : [
        { x: x0, y: y0, title: t("games.battleships.own") },
        { x: x0, y: y0 + boardHeight + gap, title: t("games.battleships.target") },
      ];

  for (const board of boards) {
    const gridX = board.x + labelBand;
    const gridY = board.y + titleBand + labelBand;
    lines.push(...centerText(board.title, [gridX + cell * boardSize / 2, board.y + titleBand * 0.55], titleBand * 0.72, cell * boardSize * 0.92));
    for (let col = 0; col < boardSize; col++) {
      lines.push(...centerText(String.fromCharCode(65 + col), [gridX + (col + 0.5) * cell, board.y + titleBand + labelBand * 0.55], labelBand * 0.72, cell * 0.64));
    }
    for (let row = 0; row < boardSize; row++) {
      lines.push(...centerText(String(row + 1), [board.x + labelBand * 0.45, gridY + (row + 0.5) * cell], labelBand * 0.72, labelBand * 0.8));
    }
    lines.push(rectOutline(gridX, gridY, cell * boardSize, cell * boardSize));
    for (let i = 1; i < boardSize; i++) {
      lines.push([[gridX + i * cell, gridY], [gridX + i * cell, gridY + cell * boardSize]]);
      lines.push([[gridX, gridY + i * cell], [gridX + cell * boardSize, gridY + i * cell]]);
    }
  }

  return {
    name: t("game.battleships.name"),
    lines,
    width,
    height,
    details: [
      { label: t("games.param.boardCount"), value: "2" },
      { label: t("games.param.boardSize"), value: `${boardSize} × ${boardSize}` },
      { label: t("games.param.cellSize"), value: formatMm(cell) },
      { label: t("games.param.layout"), value: t(sideBySide ? "games.layout.sideBySide" : "games.layout.stacked") },
    ],
  };
}
