import type { Calibration } from "../api";
import type { Pt } from "../paint/geometry";
import type { TemplateSpec, Translator } from "./types";
import { clamp, formatMm, rectOutline, usableArea, centeredOrigin } from "./utils";
import { gameTextWorld } from "./lettering";

export function buildMetaTicTacToeTemplate(cal: Calibration, t: Translator): TemplateSpec {
  const { width: usableWidth, height: usableHeight } = usableArea(cal);

  const labelGap = 9;
  const labelH = 13;
  const board = Math.min(
    usableWidth * 0.94,
    (usableHeight - labelGap - labelH) * 0.96,
  );
  const totalH = board + labelGap + labelH;
  const [x0, y0] = centeredOrigin(board, totalH, cal, t);

  const cell = board / 9;
  // Offset used to render thick lines as triple parallel strokes.
  const thick = clamp(cell * 0.022, 0.9, 2.0);
  const lines: Pt[][] = [];

  // ── Thin inner cell lines (drawn first, covered by thick lines on top) ────
  for (const i of [1, 2, 4, 5, 7, 8]) {
    lines.push([[x0 + i * cell, y0], [x0 + i * cell, y0 + board]]);
    lines.push([[x0, y0 + i * cell], [x0 + board, y0 + i * cell]]);
  }

  // ── Thick outer border (triple-offset rectangles) ─────────────────────────
  for (const d of [-thick, 0, thick]) {
    lines.push(rectOutline(x0 + d, y0 + d, board - 2 * d, board - 2 * d));
  }

  // ── Thick section dividers at columns/rows 3 and 6 ───────────────────────
  for (const i of [3, 6]) {
    for (const d of [-thick, 0, thick]) {
      lines.push([[x0 + i * cell + d, y0], [x0 + i * cell + d, y0 + board]]);
      lines.push([[x0, y0 + i * cell + d], [x0 + board, y0 + i * cell + d]]);
    }
  }

  // ── Player labels ─────────────────────────────────────────────────────────
  const textH = clamp(labelH * 0.68, 4, 9);
  const labelY = y0 + board + labelGap;
  const underlineY = labelY + textH * 1.05;
  const lineLen = board * 0.27;

  // "X:" left label
  const xOrigin: Pt = [x0 + board * 0.05, labelY];
  for (const stroke of gameTextWorld("X:", xOrigin, textH)) lines.push(stroke);
  const xLineX = xOrigin[0] + textH * 2.2;
  lines.push([[xLineX, underlineY], [xLineX + lineLen, underlineY]]);

  // "O:" right label
  const oOrigin: Pt = [x0 + board * 0.52, labelY];
  for (const stroke of gameTextWorld("O:", oOrigin, textH)) lines.push(stroke);
  const oLineX = oOrigin[0] + textH * 2.2;
  lines.push([[oLineX, underlineY], [oLineX + lineLen, underlineY]]);

  return {
    name: t("game.metaTicTacToe.name"),
    lines,
    width: board,
    height: totalH,
    details: [
      { label: t("games.param.cellSize"), value: formatMm(cell) },
    ],
  };
}
