import type { Calibration } from "../api";
import type { Pt } from "../paint/geometry";
import type { TemplateSpec, Translator } from "./types";
import { clamp, formatMm, rectOutline, circle, centerText, usableArea, centeredOrigin } from "./utils";

export function buildConnectFourTemplate(cal: Calibration, t: Translator): TemplateSpec {
  const { width: usableWidth, height: usableHeight } = usableArea(cal);
  const labelBand = clamp(Math.min(usableWidth, usableHeight) * 0.12, 10, 18);
  const cell = Math.min(usableWidth / 7, (usableHeight - labelBand) / 6);
  const width = cell * 7;
  const height = labelBand + cell * 6;
  const [x0, y0] = centeredOrigin(width, height, cal, t);
  const gridY = y0 + labelBand;
  const lines: Pt[][] = [];

  lines.push(rectOutline(x0, gridY, width, cell * 6));
  for (let col = 1; col < 7; col++) lines.push([[x0 + col * cell, gridY], [x0 + col * cell, gridY + cell * 6]]);
  for (let row = 1; row < 6; row++) lines.push([[x0, gridY + row * cell], [x0 + width, gridY + row * cell]]);
  for (let col = 0; col < 7; col++) {
    lines.push(...centerText(String(col + 1), [x0 + (col + 0.5) * cell, y0 + labelBand * 0.55], labelBand * 0.64, cell * 0.58));
  }
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 7; col++) {
      lines.push(circle([x0 + (col + 0.5) * cell, gridY + (row + 0.5) * cell], clamp(cell * 0.28, 1.6, 5.4)));
    }
  }

  return {
    name: t("game.connectFour.name"),
    lines,
    width,
    height,
    details: [
      { label: t("games.param.boardCount"), value: "1" },
      { label: t("games.param.boardSize"), value: "7 × 6" },
      { label: t("games.param.cellSize"), value: formatMm(cell) },
    ],
  };
}
