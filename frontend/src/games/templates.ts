import type { Calibration, ColoringPageResponse } from "../api";
import type { Pt } from "../paint/geometry";
import { buildSudokuTemplate } from "./sudoku";
import { mazeRequestArea } from "./maze";
import type {
  ColoringPatternMode,
  MazeSize,
  MazeType,
  SudokuDifficulty,
  TemplateSpec,
} from "./types";
import { usableArea } from "./utils";

export type TFn = (key: string, vars?: Record<string, string | number>) => string;

export const COLORING_PATTERN_OPTIONS: Array<{ value: ColoringPatternMode; icon: string; labelKey: string }> = [
  { value: "scales",       icon: "◠", labelKey: "games.option.coloring.scales" },
  { value: "bubbles",      icon: "○", labelKey: "games.option.coloring.bubbles" },
  { value: "spiral",       icon: "◎", labelKey: "games.option.coloring.spiral" },
  { value: "stained_glass",icon: "◇", labelKey: "games.option.coloring.stainedGlass" },
  { value: "hex_mosaic",   icon: "⬡", labelKey: "games.option.coloring.hexMosaic" },
  { value: "truchet",      icon: "╱", labelKey: "games.option.coloring.truchet" },
  { value: "voronoi",      icon: "✦", labelKey: "games.option.coloring.voronoi" },
  { value: "wave_field",   icon: "≋", labelKey: "games.option.coloring.waveField" },
  { value: "penrose",      icon: "✶", labelKey: "games.option.coloring.penrose" },
];

export function coloringRequestArea(cal: Calibration) {
  return {
    width: Math.max(60, cal.plot_width - 8),
    height: Math.max(60, cal.plot_height - 8),
  };
}

export function osmPlaceholderTemplate(cal: Calibration, t: TFn): TemplateSpec {
  const width = Math.max(20, cal.plot_width - 8);
  const height = Math.max(20, cal.plot_height - 8);
  return {
    name: t("game.osmMap.name"),
    lines: [],
    width,
    height,
    details: [{ label: t("games.osm.search"), value: t("games.osm.chooseInEditor") }],
  };
}

export function mazePlaceholderTemplate(cal: Calibration, t: TFn, size: MazeSize, type: MazeType): TemplateSpec {
  const { width, height } = mazeRequestArea(cal);
  return {
    name: t("game.maze.name"),
    lines: [],
    width,
    height,
    details: [
      { label: t("games.param.mazeSize"), value: t(`games.option.mazeSize.${size}`) },
      { label: t("games.param.mazeType"), value: t(`games.option.mazeType.${type}`) },
    ],
  };
}

export function sudokuPlaceholderTemplate(cal: Calibration, t: TFn, difficulty: SudokuDifficulty, seed: number): TemplateSpec {
  const empty = Array.from({ length: 9 }, () => Array(9).fill(0));
  return buildSudokuTemplate(cal, t, {
    seed: String(seed),
    difficulty,
    puzzle: empty,
    solution: empty,
    metadata: {},
  });
}

export function coloringPlaceholderTemplate(
  cal: Calibration,
  t: TFn,
  fn: "mandala" | "math_pattern",
  mode: string,
  complexity: number,
  showSeed: boolean,
): TemplateSpec {
  const { width, height } = coloringRequestArea(cal);
  return {
    name: fn === "mandala" ? t("game.coloringMandala.name") : t("game.coloringPattern.name"),
    lines: [],
    width,
    height,
    details: [
      { label: t("games.param.coloringMode"), value: t(`games.option.coloring.${modeLabelKey(mode)}`) },
      { label: t("games.param.complexity"), value: `${Math.round(complexity * 100)}%` },
      { label: t("games.param.showSeed"), value: t(showSeed ? "common.yes" : "common.no") },
    ],
  };
}

export function buildColoringTemplate(page: ColoringPageResponse, t: TFn): TemplateSpec {
  const isMandala = page.function === "mandala";
  return {
    name: isMandala ? t("game.coloringMandala.name") : t("game.coloringPattern.name"),
    lines: page.lines as Pt[][],
    width: page.width,
    height: page.height,
    details: [
      { label: t("games.param.coloringMode"), value: t(`games.option.coloring.${modeLabelKey(page.mode)}`) },
      { label: t("games.param.seed"), value: String(page.seed) },
      { label: t("games.param.complexity"), value: `${Math.round(Number(page.metadata.complexity ?? 0) * 100)}%` },
      { label: t("games.param.showSeed"), value: t(page.metadata.show_seed ? "common.yes" : "common.no") },
    ],
  };
}

export function autoFitIndicators(template: TemplateSpec, cal: Calibration, t: TFn) {
  const area = usableArea(cal);
  const coverage = Math.round(
    Math.min(100, (template.width * template.height) / Math.max(area.width * area.height, 1) * 100),
  );
  return [
    { label: t("games.autoFit.templateSize"), value: `${template.width.toFixed(0)} × ${template.height.toFixed(0)} mm` },
    { label: t("paper.legPlot"), value: `${area.width.toFixed(0)} × ${area.height.toFixed(0)} mm` },
    { label: t("games.autoFit.coverage"), value: `${coverage}%` },
  ];
}

export function modeLabelKey(mode: string) {
  if (mode === "hex_mosaic") return "hexMosaic";
  if (mode === "wave_field") return "waveField";
  if (mode === "stained_glass") return "stainedGlass";
  return mode;
}
