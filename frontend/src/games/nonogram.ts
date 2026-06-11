import type { Calibration } from "../api";
import type { Pt } from "../paint/geometry";
import type { TemplateSpec, Translator } from "./types";

type NonogramSize = "small" | "medium" | "large";
type NonogramDensity = "light" | "balanced" | "dense";
import { formatMm, rectOutline, centerText, usableArea, centeredOrigin, mulberry32, randomInt } from "./utils";

export function buildNonogramTemplate(
  cal: Calibration,
  t: Translator,
  settings: { size: NonogramSize; density: NonogramDensity; seed: number },
): TemplateSpec {
  const size = settings.size === "small" ? 10 : settings.size === "large" ? 20 : 15;
  const clueSlots = size >= 20 ? 6 : size >= 15 ? 5 : 4;
  const { width: usableWidth, height: usableHeight } = usableArea(cal);
  const cell = Math.min(usableWidth / (size + clueSlots), usableHeight / (size + clueSlots)) * 0.88;
  const width = (size + clueSlots) * cell;
  const height = (size + clueSlots) * cell;
  const [x0, y0] = centeredOrigin(width, height, cal, t);
  const gridX = x0 + clueSlots * cell;
  const gridY = y0 + clueSlots * cell;
  const pattern = buildNonogramPattern(size, settings.density, settings.seed);
  const rowClues = pattern.map((row) => clueRuns(row));
  const colClues = Array.from({ length: size }, (_, col) => clueRuns(pattern.map((row) => row[col])));
  const lines: Pt[][] = [];
  const total = size + clueSlots;

  lines.push(rectOutline(x0, y0, width, height));
  for (let i = 1; i < total; i++) {
    lines.push([[x0 + i * cell, y0], [x0 + i * cell, y0 + height]]);
    lines.push([[x0, y0 + i * cell], [x0 + width, y0 + i * cell]]);
  }
  for (let row = 0; row < size; row++) {
    const clues = rowClues[row];
    for (let i = 0; i < clues.length; i++) {
      const slot = clueSlots - clues.length + i;
      lines.push(...centerText(String(clues[i]), [x0 + (slot + 0.5) * cell, gridY + (row + 0.54) * cell], cell * 0.32, cell * 0.56));
    }
  }
  for (let col = 0; col < size; col++) {
    const clues = colClues[col];
    for (let i = 0; i < clues.length; i++) {
      const slot = clueSlots - clues.length + i;
      lines.push(...centerText(String(clues[i]), [gridX + (col + 0.5) * cell, y0 + (slot + 0.54) * cell], cell * 0.32, cell * 0.56));
    }
  }

  return {
    name: t("game.nonogram.name"),
    lines,
    width,
    height,
    details: [
      { label: t("games.param.boardSize"), value: `${size} × ${size}` },
      { label: t("games.param.density"), value: t(`games.option.nonogramDensity.${settings.density}`) },
      { label: t("games.param.clueSlots"), value: String(clueSlots) },
      { label: t("games.param.cellSize"), value: formatMm(cell) },
    ],
  };
}

function buildNonogramPattern(size: number, density: NonogramDensity, seed: number): boolean[][] {
  const rand = mulberry32(seed);
  const threshold = density === "light" ? 0.66 : density === "dense" ? 0.49 : 0.57;
  const phaseA = rand() * Math.PI * 2;
  const phaseB = rand() * Math.PI * 2;
  const phaseC = rand() * Math.PI * 2;
  const pattern = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => {
      const x = col / Math.max(size - 1, 1);
      const y = row / Math.max(size - 1, 1);
      const wave =
        0.5
        + 0.24 * Math.sin(x * Math.PI * 2.6 + phaseA)
        + 0.22 * Math.cos(y * Math.PI * 2.2 + phaseB)
        + 0.16 * Math.sin((x + y) * Math.PI * 3.3 + phaseC)
        + (rand() - 0.5) * 0.18;
      return wave > threshold;
    })
  );
  ensureNonogramSignal(pattern, rand);
  return pattern;
}

function ensureNonogramSignal(pattern: boolean[][], rand: () => number) {
  const size = pattern.length;
  for (let row = 0; row < size; row++) {
    if (pattern[row].some(Boolean)) continue;
    pattern[row][randomInt(rand, 0, size)] = true;
  }
  for (let col = 0; col < size; col++) {
    let any = false;
    for (let row = 0; row < size; row++) {
      if (pattern[row][col]) { any = true; break; }
    }
    if (!any) pattern[randomInt(rand, 0, size)][col] = true;
  }
}

function clueRuns(values: boolean[]): number[] {
  const runs: number[] = [];
  let run = 0;
  for (const value of values) {
    if (value) run += 1;
    else if (run) { runs.push(run); run = 0; }
  }
  if (run) runs.push(run);
  return runs.length ? runs : [0];
}
