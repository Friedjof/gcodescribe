import type { Pt } from "../paint/geometry";

export type GameId =
  | "dotsBoxes"
  | "ticTacToe"
  | "metaTicTacToe"
  | "maze"
  | "battleships"
  | "connectFour"
  | "sudoku"
  | "bingo"
  | "cityCountryRiver";

export type GameGroup = "grid" | "puzzle" | "party";

export type GameDef = {
  id: GameId;
  group: GameGroup;
};

export type DotsDensity = "relaxed" | "balanced" | "dense" | "extreme";
export type DotsJitter = "straight" | "organic" | "wild";
export type DotsPlayable = "sparse" | "balanced" | "full";
export type MazeSize = "small" | "medium" | "large" | "huge" | "extreme";
export type MazeType = "classic" | "masked" | "hex" | "polar";
export type BattleshipsSize = "s8" | "s10" | "s12";
export type SudokuDifficulty = "easy" | "medium" | "hard";

export type TemplateDetail = {
  label: string;
  value: string;
};

export type TemplateSpec = {
  name: string;
  lines: Pt[][];
  solutionLines?: Pt[][];
  width: number;
  height: number;
  details: TemplateDetail[];
};

export type GeneratedPreview = {
  gameId: GameId;
  template: TemplateSpec;
  seed: number;
};

export type Translator = (key: string, vars?: Record<string, string | number>) => string;
