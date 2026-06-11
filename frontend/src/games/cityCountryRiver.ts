import type { Calibration } from "../api";
import type { Pt } from "../paint/geometry";
import type { TemplateSpec, Translator } from "./types";
import { clamp, formatMm, rectOutline, centerText, usableArea, centeredOrigin } from "./utils";

export function buildCityCountryRiverTemplate(cal: Calibration, t: Translator): TemplateSpec {
  const { width: usableWidth, height: usableHeight } = usableArea(cal);
  const headers = [
    t("games.city.letter"),
    t("games.city.name"),
    t("games.city.city"),
    t("games.city.country"),
    t("games.city.river"),
    t("games.city.animal"),
    t("games.city.job"),
    t("games.city.thing"),
  ];
  const weights = [0.8, 1.05, 1.2, 1.2, 1.15, 1.1, 1.05, 1.05];
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const width = usableWidth;
  const unitW = width / totalWeight;
  const rowH = clamp(usableHeight / 13.5, 8, 12);
  const rows = clamp(Math.floor(usableHeight / rowH) - 1, 8, 14);
  const height = rowH * (rows + 1);
  const [x0, y0] = centeredOrigin(width, height, cal, t);
  const lines: Pt[][] = [];

  lines.push(rectOutline(x0, y0, width, height));
  for (let i = 1; i <= rows; i++) {
    lines.push([[x0, y0 + i * rowH], [x0 + width, y0 + i * rowH]]);
  }
  let cursor = x0;
  for (let i = 0; i < headers.length; i++) {
    const colW = weights[i] * unitW;
    if (i > 0) lines.push([[cursor, y0], [cursor, y0 + height]]);
    lines.push(...centerText(headers[i], [cursor + colW / 2, y0 + rowH * 0.52], rowH * 0.28, colW * 0.82));
    cursor += colW;
  }

  return {
    name: t("game.cityCountryRiver.name"),
    lines,
    width,
    height,
    details: [
      { label: t("games.param.categories"), value: String(headers.length - 1) },
      { label: t("games.param.rows"), value: String(rows) },
      { label: t("games.param.cellSize"), value: formatMm(rowH) },
    ],
  };
}
