import type { Calibration } from "../api";
import type { Pt } from "../paint/geometry";
import type { TemplateSpec, Translator } from "./types";
import { clamp, formatMm, usableArea, centeredOrigin } from "./utils";

export function buildTicTacToeTemplate(cal: Calibration, t: Translator): TemplateSpec {
  const { width: usableWidth, height: usableHeight } = usableArea(cal);
  const gap = clamp(Math.min(usableWidth, usableHeight) * 0.045, 6, 12);
  const targetBoard = clamp(Math.min(usableWidth, usableHeight) / 2.7, 52, 78);
  const across = clamp(Math.floor((usableWidth + gap) / (targetBoard + gap)), 1, 4);
  const down = clamp(Math.floor((usableHeight + gap) / (targetBoard + gap)), 1, 6);
  const cell = Math.min(
    (usableWidth - gap * Math.max(0, across - 1)) / (across * 3),
    (usableHeight - gap * Math.max(0, down - 1)) / (down * 3),
  );
  const width = across * cell * 3 + gap * Math.max(0, across - 1);
  const height = down * cell * 3 + gap * Math.max(0, down - 1);
  const [x0, y0] = centeredOrigin(width, height, cal, t);
  const lines: Pt[][] = [];

  for (let row = 0; row < down; row++) {
    for (let col = 0; col < across; col++) {
      const bx = x0 + col * (cell * 3 + gap);
      const by = y0 + row * (cell * 3 + gap);
      lines.push([[bx + cell, by], [bx + cell, by + cell * 3]]);
      lines.push([[bx + cell * 2, by], [bx + cell * 2, by + cell * 3]]);
      lines.push([[bx, by + cell], [bx + cell * 3, by + cell]]);
      lines.push([[bx, by + cell * 2], [bx + cell * 3, by + cell * 2]]);
    }
  }

  return {
    name: t("game.ticTacToe.name"),
    lines,
    width,
    height,
    details: [
      { label: t("games.param.boardsAcross"), value: String(across) },
      { label: t("games.param.boardsDown"), value: String(down) },
      { label: t("games.param.cellSize"), value: formatMm(cell) },
    ],
  };
}
