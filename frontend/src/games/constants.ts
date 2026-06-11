import type { GameId, GameDef } from "./types";

export const PAGE_MARGIN = 4;

export const SUPPORTED_GAMES = new Set<GameId>([
  "dotsBoxes",
  "ticTacToe",
  "metaTicTacToe",
  "maze",
  "battleships",
  "connectFour",
  "sudoku",
  "bingo",
  "cityCountryRiver",
]);

export const SEEDED_GAMES = new Set<GameId>(["dotsBoxes", "maze", "sudoku", "bingo"]);

export const GAME_GROUPS: { key: string; games: GameDef[] }[] = [
  {
    key: "games.group.grid",
    games: [
      { id: "dotsBoxes", group: "grid" },
      { id: "ticTacToe", group: "grid" },
      { id: "metaTicTacToe", group: "grid" },
      { id: "connectFour", group: "grid" },
      { id: "battleships", group: "grid" },
    ],
  },
  {
    key: "games.group.puzzle",
    games: [
      { id: "maze", group: "puzzle" },
      { id: "sudoku", group: "puzzle" },
    ],
  },
  {
    key: "games.group.party",
    games: [
      { id: "bingo", group: "party" },
      { id: "cityCountryRiver", group: "party" },
    ],
  },
];

export const ALL_GAMES = GAME_GROUPS.flatMap((group) => group.games);
