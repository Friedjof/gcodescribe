import type { MazeType } from "./types";

// Labels come from i18n via `games.option.mazeType.<id>`.
export const MAZE_TYPES: Array<{ id: MazeType; symbol: string }> = [
  { id: "classic", symbol: "▦" },
  { id: "masked", symbol: "♥" },
  { id: "hex", symbol: "⬡" },
  { id: "polar", symbol: "◉" },
];
