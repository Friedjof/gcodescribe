import type { Calibration } from "../api";
import type { Pt } from "../paint/geometry";
import type { TemplateSpec, Translator } from "./types";
import { clamp, formatMm, rectOutline, circle, usableArea, centeredOrigin } from "./utils";

export function buildMillsTemplate(cal: Calibration, t: Translator): TemplateSpec {
  const { width: usableWidth, height: usableHeight } = usableArea(cal);
  const size = Math.min(usableWidth, usableHeight);
  const [x0, y0] = centeredOrigin(size, size, cal, t);
  const lines: Pt[][] = [];
  const insets = [0, size / 6, size / 3];
  const mid = size / 2;
  const pointRadius = clamp(size * 0.012, 0.8, 1.6);

  for (const inset of insets) {
    lines.push(rectOutline(x0 + inset, y0 + inset, size - inset * 2, size - inset * 2));
  }
  lines.push([[x0 + mid, y0], [x0 + mid, y0 + size / 3]]);
  lines.push([[x0 + mid, y0 + size * 2 / 3], [x0 + mid, y0 + size]]);
  lines.push([[x0, y0 + mid], [x0 + size / 3, y0 + mid]]);
  lines.push([[x0 + size * 2 / 3, y0 + mid], [x0 + size, y0 + mid]]);

  for (const inset of insets) {
    const left = x0 + inset;
    const top = y0 + inset;
    const right = x0 + size - inset;
    const bottom = y0 + size - inset;
    const center = x0 + mid;
    const middle = y0 + mid;
    const pts: Pt[] = [
      [left, top], [center, top], [right, top],
      [left, middle], [right, middle],
      [left, bottom], [center, bottom], [right, bottom],
    ];
    for (const pt of pts) lines.push(circle(pt, pointRadius));
  }

  return {
    name: t("game.mills.name"),
    lines,
    width: size,
    height: size,
    details: [
      { label: t("games.param.boardCount"), value: "1" },
      { label: t("games.param.pointCount"), value: "24" },
      { label: t("games.param.boardSize"), value: formatMm(size) },
    ],
  };
}
