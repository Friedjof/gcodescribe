# `src/games`

Pure game-logic and template-building modules. Nothing here renders UI —
these are data-only helpers consumed by `Games.tsx` and its sub-components.

```
games/
├── types.ts             Shared TypeScript types used across the games module:
│                        GameId, TemplateSpec, GeneratedPreview, DotsDensity,
│                        MazeSize/Type, SudokuDifficulty, ColoringMandala/PatternMode, …
│
├── constants.ts         SUPPORTED_GAMES (Set), SEEDED_GAMES (Set),
│                        ALL_GAMES list, GAME_GROUPS for the catalog grid
│
├── builder.ts           buildTemplate() — dispatches to per-game builders for
│                        games that are generated entirely client-side
│
├── templates.ts         Placeholder and response→template converters used by
│                        Games.tsx when building the auto-fit preview:
│                          COLORING_PATTERN_OPTIONS  — icon/label list
│                          osmPlaceholderTemplate    — OSM map placeholder
│                          mazePlaceholderTemplate   — maze placeholder
│                          sudokuPlaceholderTemplate — sudoku placeholder
│                          coloringPlaceholderTemplate
│                          buildColoringTemplate     — API response → TemplateSpec
│                          coloringRequestArea       — size helper
│                          autoFitIndicators         — chip data for the UI
│                          modeLabelKey              — i18n key normaliser
│
├── utils.ts             templateObject, randomSeed, randomMazeSeed, usableArea
│
├── maze.ts              buildMazeTemplate, mazeRequestArea
├── mazeTypes.ts         MAZE_TYPES constant (id + symbol pairs)
├── sudoku.ts            buildSudokuTemplate
├── osmMap.ts            OSM map request builder
│
├── battleships.ts       Battleships grid builder
├── bingo.ts             Bingo card builder
├── dotsBoxes.ts         Dots & Boxes grid builder
├── connectFour.ts       Connect Four grid builder
├── metaTicTacToe.ts     Meta Tic-Tac-Toe grid builder
├── ticTacToe.ts         Tic-Tac-Toe grid builder
├── mills.ts             Nine Men's Morris board builder
├── nonogram.ts          Nonogram grid builder
├── hangman.ts           Hangman frame builder
├── cityCountryRiver.ts  City/Country/River sheet builder
├── lettering.ts         Lettering practice sheet builder
│
├── PreviewSvg.tsx        SVG renderer for the generated-game modal preview
│
└── *.test.ts            Vitest unit tests (determinism, maze, osmMap, utils)
```

## Adding a new game

1. Add the game's `GameId` to `types.ts`.
2. Create `<gameId>.ts` with a `build<GameId>Template(cal, t, opts)` function.
3. Register it in `constants.ts` (`ALL_GAMES`, `GAME_GROUPS`, optionally
   `SUPPORTED_GAMES` / `SEEDED_GAMES`).
4. Wire it into `builder.ts`.
5. Add i18n keys `game.<gameId>.name` and `game.<gameId>.desc`.
