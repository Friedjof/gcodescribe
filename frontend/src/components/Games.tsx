import { useEffect, useState } from "react";
import { api, type Calibration, type ColoringPageResponse } from "../api";
import { useI18n } from "../i18n";
import type { Pt } from "../paint/geometry";
import GamePreviewSvg from "../games/PreviewSvg";
import LiveButton from "../stream/LiveButton";
import { stopGlobalLive, useLiveRegistryState } from "../stream/liveRegistry";
import { useLiveStream } from "../stream/useLiveStream";
import Modal from "./Modal";
import Segmented from "./Segmented";
import OsmMapEditor from "./OsmMapEditor";
import {
  type GameId,
  type DotsDensity,
  type DotsJitter,
  type DotsPlayable,
  type MazeSize,
  type MazeType,
  type BattleshipsSize,
  type SudokuDifficulty,
  type ColoringMandalaMode,
  type ColoringPatternMode,
  type TemplateSpec,
  type GeneratedPreview,
} from "../games/types";
import { SUPPORTED_GAMES, SEEDED_GAMES, GAME_GROUPS, ALL_GAMES } from "../games/constants";
import { buildTemplate } from "../games/builder";
import { templateObject, randomSeed, randomMazeSeed, usableArea } from "../games/utils";
import { MAZE_TYPES } from "../games/mazeTypes";
import { buildMazeTemplate, mazeRequestArea } from "../games/maze";
import { buildSudokuTemplate } from "../games/sudoku";

const COLORING_PATTERN_OPTIONS: Array<{ value: ColoringPatternMode; icon: string; labelKey: string }> = [
  { value: "scales", icon: "◠", labelKey: "games.option.coloring.scales" },
  { value: "bubbles", icon: "○", labelKey: "games.option.coloring.bubbles" },
  { value: "spiral", icon: "◎", labelKey: "games.option.coloring.spiral" },
  { value: "stained_glass", icon: "◇", labelKey: "games.option.coloring.stainedGlass" },
  { value: "hex_mosaic", icon: "⬡", labelKey: "games.option.coloring.hexMosaic" },
  { value: "truchet", icon: "╱", labelKey: "games.option.coloring.truchet" },
  { value: "voronoi", icon: "✦", labelKey: "games.option.coloring.voronoi" },
  { value: "wave_field", icon: "≋", labelKey: "games.option.coloring.waveField" },
  { value: "penrose", icon: "✶", labelKey: "games.option.coloring.penrose" },
];

export default function Games({ visible = true, onOpenPaint }: { visible?: boolean; onOpenPaint: () => void }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<GameId>(ALL_GAMES[0].id);
  const [cal, setCal] = useState<Calibration | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dotsDensity, setDotsDensity] = useState<DotsDensity>("balanced");
  const [dotsJitter, setDotsJitter] = useState<DotsJitter>("organic");
  const [dotsPlayable, setDotsPlayable] = useState<DotsPlayable>("balanced");
  const [dotsSeed, setDotsSeed] = useState(() => randomMazeSeed());
  const [dotsSeedManual, setDotsSeedManual] = useState(false);
  const [dotsSeedInput, setDotsSeedInput] = useState("");
  const [battleshipsSize, setBattleshipsSize] = useState<BattleshipsSize>("s10");
  const [mazeSeed, setMazeSeed] = useState(() => randomMazeSeed());
  const [mazeSeedManual, setMazeSeedManual] = useState(false);
  const [mazeSeedInput, setMazeSeedInput] = useState("");
  const [showMazeSolution, setShowMazeSolution] = useState(false);
  const [mazeSize, setMazeSize] = useState<MazeSize>("medium");
  const [mazeType, setMazeType] = useState<MazeType>("classic");
  const [sudokuDifficulty, setSudokuDifficulty] = useState<SudokuDifficulty>("medium");
  const [sudokuSeed, setSudokuSeed] = useState(() => randomMazeSeed());
  const [sudokuSeedManual, setSudokuSeedManual] = useState(false);
  const [sudokuSeedInput, setSudokuSeedInput] = useState("");
  const [showSudokuSolution, setShowSudokuSolution] = useState(false);
  const [bingoSeed, setBingoSeed] = useState(() => randomSeed());
  const [coloringMandalaSeed, setColoringMandalaSeed] = useState(() => randomMazeSeed());
  const [coloringMandalaSeedManual, setColoringMandalaSeedManual] = useState(false);
  const [coloringMandalaSeedInput, setColoringMandalaSeedInput] = useState("");
  const [coloringMandalaMode, setColoringMandalaMode] = useState<ColoringMandalaMode>("flower");
  const [coloringMandalaComplexity, setColoringMandalaComplexity] = useState(0.4);
  const [coloringMandalaShowSeed, setColoringMandalaShowSeed] = useState(false);
  const [coloringPatternSeed, setColoringPatternSeed] = useState(() => randomMazeSeed());
  const [coloringPatternSeedManual, setColoringPatternSeedManual] = useState(false);
  const [coloringPatternSeedInput, setColoringPatternSeedInput] = useState("");
  const [coloringPatternMode, setColoringPatternMode] = useState<ColoringPatternMode>("scales");
  const [coloringPatternComplexity, setColoringPatternComplexity] = useState(0.4);
  const [coloringPatternShowSeed, setColoringPatternShowSeed] = useState(false);
  const [preview, setPreview] = useState<GeneratedPreview | null>(null);
  const [showOsmMapEditor, setShowOsmMapEditor] = useState(false);
  const selectedGame = ALL_GAMES.find((game) => game.id === selected) ?? ALL_GAMES[0];
  const supported = SUPPORTED_GAMES.has(selectedGame.id);
  const globalLive = useLiveRegistryState();

  const live = useLiveStream("games", () => {
    if (!cal) return null;
    if (!preview) {
      return {
        cal,
        page: { id: "games-placeholder", name: t("games.generatedTitle"), objects: [], grid: { step: 10, snap: false } },
        meta: { sourceId: "games", mode: "placeholder", pageName: t("games.generatedTitle") },
      };
    }
    const solutionLines = (preview.gameId === "maze" ? showMazeSolution : showSudokuSolution)
      ? preview.template.solutionLines
      : undefined;
    return {
      cal,
      page: { id: `game-${preview.gameId}`, name: preview.template.name, objects: [], grid: { step: 10, snap: false } },
      meta: { sourceId: "games", mode: "game", pageName: preview.template.name },
      game: {
        name: preview.template.name,
        lines: preview.template.lines,
        solutionLines,
        width: preview.template.width,
        height: preview.template.height,
      },
    };
  });

  const fail = (e: any) => setErr(String(e.message ?? e));

  useEffect(() => {
    api.getCalibration().then(setCal).catch(fail);
  }, []);

  let autoTemplate: TemplateSpec | null = null;
  let autoError: string | null = null;
  if (cal && supported) {
    try {
      autoTemplate = selectedGame.id === "maze"
        ? mazePlaceholderTemplate(cal, t, mazeSize, mazeType)
        : selectedGame.id === "sudoku"
          ? sudokuPlaceholderTemplate(cal, t, sudokuDifficulty, sudokuSeed)
        : selectedGame.id === "osmMap"
          ? osmPlaceholderTemplate(cal, t)
        : selectedGame.id === "coloringMandala"
          ? coloringPlaceholderTemplate(cal, t, "mandala", coloringMandalaMode, coloringMandalaComplexity, coloringMandalaShowSeed)
          : selectedGame.id === "coloringPattern"
            ? coloringPlaceholderTemplate(cal, t, "math_pattern", coloringPatternMode, coloringPatternComplexity, coloringPatternShowSeed)
            : buildTemplate(selectedGame.id, cal, t, {
          dotsBoxes: { density: dotsDensity, seed: dotsSeed, jitter: dotsJitter, playable: dotsPlayable },
          battleships: battleshipsSize,
          maze: mazeSeed,
          mazeSettings: { size: mazeSize, type: mazeType },
          sudoku: { difficulty: sudokuDifficulty, seed: sudokuSeed },
          bingo: bingoSeed,
        });
    } catch (e: any) {
      autoError = String(e.message ?? e);
    }
  }

  const updateSelection = (gameId: GameId) => {
    setSelected(gameId);
    setPreview(null);
    setErr(null);
  };

  useEffect(() => {
    if (live.state === "live") live.sendSnapshot("snapshot");
  }, [preview, showMazeSolution, showSudokuSolution, live.state]);

  useEffect(() => {
    if (visible || live.state !== "live") return;
    live.sendPlaceholder("games-hidden");
  }, [visible, live.state]);

  useEffect(() => {
    if (!preview || !cal) return;
    if (!globalLive.active || globalLive.sourceId === "games") return;
    live.start();
  }, [preview, cal, globalLive.active, globalLive.sourceId]);

  const updateDotsDensity = (density: DotsDensity) => {
    setDotsDensity(density);
    setPreview(null);
    setErr(null);
  };

  const updateDotsJitter = (jitter: DotsJitter) => {
    setDotsJitter(jitter);
    setPreview(null);
    setErr(null);
  };

  const updateDotsPlayable = (playable: DotsPlayable) => {
    setDotsPlayable(playable);
    setPreview(null);
    setErr(null);
  };

  const updateMazeSize = (size: MazeSize) => {
    setMazeSize(size);
    setPreview(null);
    setErr(null);
  };

  const updateMazeType = (type: MazeType) => {
    setMazeType(type);
    setPreview(null);
    setErr(null);
  };

  const updateBattleshipsSize = (size: BattleshipsSize) => {
    setBattleshipsSize(size);
    setPreview(null);
    setErr(null);
  };

  const updateSudokuDifficulty = (difficulty: SudokuDifficulty) => {
    setSudokuDifficulty(difficulty);
    setPreview(null);
    setErr(null);
  };

  const updateColoringMandalaMode = (mode: ColoringMandalaMode) => {
    setColoringMandalaMode(mode);
    setPreview(null);
    setErr(null);
  };

  const updateColoringPatternMode = (mode: ColoringPatternMode) => {
    setColoringPatternMode(mode);
    setPreview(null);
    setErr(null);
  };

  const parseManualSeed = (value: string) => {
    if (!/^\d{5}$/.test(value)) {
      setErr(t("games.errorSeedLength"));
      return null;
    }
    return parseInt(value, 10);
  };

  const seedForGame = (gameId: GameId, seedHint?: number) => {
    if (seedHint !== undefined) return seedHint;
    if (gameId === "dotsBoxes") return dotsSeedManual ? parseManualSeed(dotsSeedInput) : dotsSeed;
    if (gameId === "maze") return mazeSeedManual ? parseManualSeed(mazeSeedInput) : randomMazeSeed();
    if (gameId === "sudoku") return sudokuSeedManual ? parseManualSeed(sudokuSeedInput) : randomMazeSeed();
    if (gameId === "coloringMandala") return coloringMandalaSeedManual ? parseManualSeed(coloringMandalaSeedInput) : randomMazeSeed();
    if (gameId === "coloringPattern") return coloringPatternSeedManual ? parseManualSeed(coloringPatternSeedInput) : randomMazeSeed();
    if (gameId === "bingo") return bingoSeed;
    return 1;
  };

  const generatePreview = async (gameId = selectedGame.id, seedHint?: number) => {
    if (!cal) {
      setErr(t("games.loadingPlotArea"));
      return;
    }
    if (!SUPPORTED_GAMES.has(gameId)) {
      setErr(t("games.notReadyHint"));
      return;
    }
    const seed = seedForGame(gameId, seedHint);
    if (seed === null) return;
    try {
      if (gameId === "maze") {
        const { width, height } = mazeRequestArea(cal);
        const maze = await api.getMaze(mazeType, seed, mazeSize, width, height);
        const template = buildMazeTemplate(maze, cal, t, mazeSize);
        setMazeSeed(seed);
        setMazeSeedInput(String(seed).padStart(5, "0"));
        setShowMazeSolution(false);
        setPreview({ gameId, template, seed });
        setErr(null);
        return;
      }
      if (gameId === "sudoku") {
        const sudoku = await api.getSudoku(sudokuDifficulty, seed);
        const template = buildSudokuTemplate(cal, t, sudoku);
        setSudokuSeed(seed);
        setSudokuSeedInput(String(seed).padStart(5, "0"));
        setShowSudokuSolution(false);
        setPreview({ gameId, template, seed });
        setErr(null);
        return;
      }
      if (gameId === "coloringMandala" || gameId === "coloringPattern") {
        const { width, height } = coloringRequestArea(cal);
        const isMandala = gameId === "coloringMandala";
        const page = await api.getColoringPage(
          isMandala ? "mandala" : "math_pattern",
          isMandala ? coloringMandalaMode : coloringPatternMode,
          seed,
          width,
          height,
          isMandala ? coloringMandalaComplexity : coloringPatternComplexity,
          isMandala ? coloringMandalaShowSeed : coloringPatternShowSeed
        );
        const template = buildColoringTemplate(page, t);
        if (isMandala) {
          setColoringMandalaSeed(seed);
          setColoringMandalaSeedInput(String(seed).padStart(5, "0"));
        } else {
          setColoringPatternSeed(seed);
          setColoringPatternSeedInput(String(seed).padStart(5, "0"));
        }
        setPreview({ gameId, template, seed });
        setErr(null);
        return;
      }
      const template = buildTemplate(gameId, cal, t, {
        dotsBoxes: { density: dotsDensity, seed: gameId === "dotsBoxes" ? seed : dotsSeed, jitter: dotsJitter, playable: dotsPlayable },
        battleships: battleshipsSize,
        maze: mazeSeed,
        mazeSettings: { size: mazeSize, type: mazeType },
        sudoku: { difficulty: sudokuDifficulty, seed: sudokuSeed },
        bingo: gameId === "bingo" ? seed : bingoSeed,
      });
      if (gameId === "dotsBoxes") { setDotsSeed(seed); setDotsSeedInput(String(seed).padStart(5, "0")); }
      if (gameId === "bingo") setBingoSeed(seed);
      setPreview({ gameId, template, seed });
      setErr(null);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  };

  const regeneratePreview = () => {
    if (!preview) return;
    let nextSeed = preview.seed;
    if (SEEDED_GAMES.has(preview.gameId)) {
      if (preview.gameId === "maze") nextSeed = mazeSeedManual ? preview.seed : randomMazeSeed();
      else if (preview.gameId === "sudoku") nextSeed = sudokuSeedManual ? preview.seed : randomMazeSeed();
      else if (preview.gameId === "dotsBoxes") nextSeed = dotsSeedManual ? preview.seed : randomMazeSeed();
      else if (preview.gameId === "coloringMandala") nextSeed = coloringMandalaSeedManual ? preview.seed : randomMazeSeed();
      else if (preview.gameId === "coloringPattern") nextSeed = coloringPatternSeedManual ? preview.seed : randomMazeSeed();
      else nextSeed = randomSeed();
    }
    setShowMazeSolution(false);
    setShowSudokuSolution(false);
    generatePreview(preview.gameId, nextSeed);
  };

  const hasSettings = ["dotsBoxes", "battleships", "maze", "sudoku", "coloringMandala", "coloringPattern"].includes(selectedGame.id);

  const createPageFromTemplate = (gameId: GameId, template: TemplateSpec) => {
    setBusy(true);
    setErr(null);
    api.createPage(template.name)
      .then((page) => api.savePage(page.id, { objects: [templateObject(gameId, template.lines)] }))
      .then(() => {
        setPreview(null);
        onOpenPaint();
      })
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const generateAction = () => {
    if (selectedGame.id === "osmMap") {
      setShowOsmMapEditor(true);
      return;
    }
    generatePreview();
  };

  const createPageFromPreview = () => {
    if (!preview) return;
    createPageFromTemplate(preview.gameId, preview.template);
  };

  return (
    <div className="games">
      <section className="card games-hero">
        <div>
          <p className="games-kicker">{t("games.kicker")}</p>
          <h2>{t("games.title")}</h2>
          <p className="muted">{t("games.intro")}</p>
        </div>
        <div className="games-stat">
          <strong>{ALL_GAMES.length}</strong>
          <span>{t("games.total", { count: ALL_GAMES.length })}</span>
        </div>
      </section>

      <div className="games-layout">
        <section className="card games-catalog">
          <div className="games-section-head">
            <div>
              <h2>{t("games.catalog")}</h2>
              <p className="muted">{t("games.catalogHint")}</p>
            </div>
          </div>

          {GAME_GROUPS.map((group) => (
            <section key={group.key} className="games-group">
              <h3>{t(group.key)}</h3>
              <div className="games-grid">
                {group.games.map((game) => (
                  <button
                    key={game.id}
                    type="button"
                    className={`${selected === game.id ? "games-card active" : "games-card"} ${SUPPORTED_GAMES.has(game.id) ? "" : "later"}`.trim()}
                    onClick={() => updateSelection(game.id)}
                  >
                    <div className="games-card-head">
                      <strong>{t(`game.${game.id}.name`)}</strong>
                      <em className={`games-card-state ${SUPPORTED_GAMES.has(game.id) ? "ready" : "later"}`}>
                        {t(SUPPORTED_GAMES.has(game.id) ? "games.ready" : "games.later")}
                      </em>
                    </div>
                    <span>{t(`game.${game.id}.desc`)}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </section>

        <aside className="card games-detail">
          <p className="games-kicker">{t("games.detailLabel")}</p>
          <h2>{t(`game.${selectedGame.id}.name`)}</h2>
          <p className="games-detail-text">{t(`game.${selectedGame.id}.desc`)}</p>

          <div className="games-badge-row">
            <span className="games-badge muted-badge">{t(`games.group.${selectedGame.group}`)}</span>
            <span className={`games-badge ${supported ? "ready" : "muted-badge"}`}>
              {t(supported ? "games.ready" : "games.later")}
            </span>
          </div>

          {!preview && (globalLive.active || live.state === "live" || live.state === "connecting" || live.state === "error") && (
            <div className="games-live-standby">
              <span className="muted">{t("live.standby")}</span>
              <LiveButton
                state={globalLive.active && live.state === "idle" ? "live" : live.state}
                viewers={live.viewers}
                onClick={() => globalLive.active && live.state === "idle" ? stopGlobalLive() : live.state === "live" || live.state === "connecting" ? live.stop("user-stopped") : live.start()}
              />
            </div>
          )}

          {!supported && (
            <div className="banner warn-inline">
              <span>{t("games.notReadyHint")}</span>
            </div>
          )}

          {supported && cal && autoTemplate && (
            <>
              {hasSettings && (
                <div className="games-panel">
                  <div className="games-panel-head">
                    <h3>{t("games.settings")}</h3>
                  </div>
                  <div className="games-settings">
                    {selectedGame.id === "dotsBoxes" && (
                      <>
                        <div className="games-setting-row">
                          <span className="games-setting-label">{t("games.param.density")}</span>
                          <Segmented<DotsDensity>
                            value={dotsDensity}
                            onChange={updateDotsDensity}
                            options={[
                              { value: "relaxed",  label: t("games.option.density.relaxed") },
                              { value: "balanced", label: t("games.option.density.balanced") },
                              { value: "dense",    label: t("games.option.density.dense") },
                              { value: "extreme",  label: t("games.option.density.extreme") },
                            ]}
                          />
                        </div>
                        <div className="games-setting-row">
                          <span className="games-setting-label">{t("games.param.borderShape")}</span>
                          <Segmented<DotsJitter>
                            value={dotsJitter}
                            onChange={updateDotsJitter}
                            options={[
                              { value: "straight", label: t("games.option.borderShape.straight") },
                              { value: "organic", label: t("games.option.borderShape.organic") },
                              { value: "wild", label: t("games.option.borderShape.wild") },
                            ]}
                          />
                        </div>
                        <div className="games-setting-row">
                          <span className="games-setting-label">{t("games.param.playable")}</span>
                          <Segmented<DotsPlayable>
                            value={dotsPlayable}
                            onChange={updateDotsPlayable}
                            options={[
                              { value: "sparse", label: t("games.option.playable.sparse") },
                              { value: "balanced", label: t("games.option.playable.balanced") },
                              { value: "full", label: t("games.option.playable.full") },
                            ]}
                          />
                        </div>
                        <div className="games-setting-row">
                          {dotsSeedManual ? (
                            <>
                              <span className="games-setting-label">{t("games.param.seed")}</span>
                              <div className="games-seed-row">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  className="games-seed-input"
                                  value={dotsSeedInput}
                                  onChange={(e) => {
                                    setDotsSeedInput(e.target.value);
                                    setPreview(null);
                                    setErr(null);
                                  }}
                                />
                                <button
                                  type="button"
                                  className="games-seed-toggle"
                                  onClick={() => { setDotsSeedManual(false); setPreview(null); setErr(null); }}
                                >
                                  {t("games.maze.seedAuto")}
                                </button>
                              </div>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="games-seed-toggle"
                              onClick={() => { setDotsSeedInput(String(dotsSeed).padStart(5, "0")); setDotsSeedManual(true); }}
                            >
                              {t("games.maze.seedManual")}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                    {selectedGame.id === "battleships" && (
                      <div className="games-setting-row">
                        <span className="games-setting-label">{t("games.param.boardSize")}</span>
                        <Segmented<BattleshipsSize>
                          value={battleshipsSize}
                          onChange={updateBattleshipsSize}
                          options={[
                            { value: "s8", label: "8×8" },
                            { value: "s10", label: "10×10" },
                            { value: "s12", label: "12×12" },
                          ]}
                        />
                      </div>
                    )}
                    {selectedGame.id === "maze" && (
                      <>
                        <div className="games-setting-row">
                          <span className="games-setting-label">{t("games.param.mazeSize")}</span>
                          <Segmented<MazeSize>
                            value={mazeSize}
                            onChange={updateMazeSize}
                            options={[
                              { value: "small",   label: t("games.option.mazeSize.small") },
                              { value: "medium",  label: t("games.option.mazeSize.medium") },
                              { value: "large",   label: t("games.option.mazeSize.large") },
                              { value: "huge",    label: t("games.option.mazeSize.huge") },
                              { value: "extreme", label: t("games.option.mazeSize.extreme") },
                            ]}
                          />
                        </div>
                        <div className="games-setting-row">
                          <span className="games-setting-label">{t("games.param.mazeType")}</span>
                          <div className="maze-type-selector" role="radiogroup" aria-label={t("games.param.mazeType")}>
                            {MAZE_TYPES.map((type) => (
                              <button
                                key={type.id}
                                type="button"
                                role="radio"
                                title={t(`games.option.mazeType.${type.id}`)}
                                aria-label={t(`games.option.mazeType.${type.id}`)}
                                aria-checked={mazeType === type.id}
                                className={mazeType === type.id ? "selected" : ""}
                                onClick={() => updateMazeType(type.id)}
                              >
                                <span aria-hidden="true">{type.symbol}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="games-setting-row">
                          {mazeSeedManual ? (
                            <>
                              <span className="games-setting-label">{t("games.param.seed")}</span>
                              <div className="games-seed-row">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  className="games-seed-input"
                                  value={mazeSeedInput}
                                  onChange={(e) => {
                                    setMazeSeedInput(e.target.value);
                                    setPreview(null);
                                    setErr(null);
                                  }}
                                />
                                <button
                                  type="button"
                                  className="games-seed-toggle"
                                  onClick={() => { setMazeSeedManual(false); setPreview(null); setErr(null); }}
                                >
                                  {t("games.maze.seedAuto")}
                                </button>
                              </div>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="games-seed-toggle"
                              onClick={() => { setMazeSeedInput(String(mazeSeed).padStart(5, "0")); setMazeSeedManual(true); }}
                            >
                              {t("games.maze.seedManual")}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                    {selectedGame.id === "sudoku" && (
                      <>
                        <div className="games-setting-row">
                          <span className="games-setting-label">{t("games.param.difficulty")}</span>
                          <Segmented<SudokuDifficulty>
                            value={sudokuDifficulty}
                            onChange={updateSudokuDifficulty}
                            options={[
                              { value: "easy", label: t("games.option.difficulty.easy") },
                              { value: "medium", label: t("games.option.difficulty.medium") },
                              { value: "hard", label: t("games.option.difficulty.hard") },
                            ]}
                          />
                        </div>
                        <div className="games-setting-row">
                          {sudokuSeedManual ? (
                            <>
                              <span className="games-setting-label">{t("games.param.seed")}</span>
                              <div className="games-seed-row">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  className="games-seed-input"
                                  value={sudokuSeedInput}
                                  onChange={(e) => {
                                    setSudokuSeedInput(e.target.value);
                                    setPreview(null);
                                    setErr(null);
                                  }}
                                />
                                <button
                                  type="button"
                                  className="games-seed-toggle"
                                  onClick={() => { setSudokuSeedManual(false); setPreview(null); setErr(null); }}
                                >
                                  {t("games.maze.seedAuto")}
                                </button>
                              </div>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="games-seed-toggle"
                              onClick={() => { setSudokuSeedInput(String(sudokuSeed).padStart(5, "0")); setSudokuSeedManual(true); }}
                            >
                              {t("games.maze.seedManual")}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                    {selectedGame.id === "coloringMandala" && (
                      <>
                        <div className="games-setting-row">
                          <span className="games-setting-label">{t("games.param.coloringMode")}</span>
                          <Segmented<ColoringMandalaMode>
                            value={coloringMandalaMode}
                            onChange={updateColoringMandalaMode}
                            options={[
                              { value: "flower", label: t("games.option.coloring.flower") },
                              { value: "star", label: t("games.option.coloring.star") },
                              { value: "butterfly", label: t("games.option.coloring.butterfly") },
                              { value: "sun", label: t("games.option.coloring.sun") },
                              { value: "nature", label: t("games.option.coloring.nature") },
                              { value: "magic", label: t("games.option.coloring.magic") },
                            ]}
                          />
                        </div>
                        <ComplexityControl
                          value={coloringMandalaComplexity}
                          onChange={(value) => { setColoringMandalaComplexity(value); setPreview(null); setErr(null); }}
                          label={t("games.param.complexity")}
                        />
                        <SeedVisibilityToggle
                          checked={coloringMandalaShowSeed}
                          onChange={(checked) => { setColoringMandalaShowSeed(checked); setPreview(null); setErr(null); }}
                          label={t("games.param.showSeed")}
                          onText={t("games.seedVisible")}
                          offText={t("games.seedHidden")}
                        />
                        <div className="games-setting-row">
                          {coloringMandalaSeedManual ? (
                            <>
                              <span className="games-setting-label">{t("games.param.seed")}</span>
                              <div className="games-seed-row">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  className="games-seed-input"
                                  value={coloringMandalaSeedInput}
                                  onChange={(e) => { setColoringMandalaSeedInput(e.target.value); setPreview(null); setErr(null); }}
                                />
                                <button type="button" className="games-seed-toggle" onClick={() => { setColoringMandalaSeedManual(false); setPreview(null); setErr(null); }}>
                                  {t("games.maze.seedAuto")}
                                </button>
                              </div>
                            </>
                          ) : (
                            <button type="button" className="games-seed-toggle" onClick={() => { setColoringMandalaSeedInput(String(coloringMandalaSeed).padStart(5, "0")); setColoringMandalaSeedManual(true); }}>
                              {t("games.maze.seedManual")}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                    {selectedGame.id === "coloringPattern" && (
                      <>
                        <div className="games-setting-row">
                          <span className="games-setting-label">{t("games.param.coloringMode")}</span>
                          <div className="coloring-pattern-selector" role="radiogroup" aria-label={t("games.param.coloringMode")}>
                            {COLORING_PATTERN_OPTIONS.map((option) => {
                              const label = t(option.labelKey);
                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  className={coloringPatternMode === option.value ? "selected" : ""}
                                  title={label}
                                  aria-label={label}
                                  aria-checked={coloringPatternMode === option.value}
                                  role="radio"
                                  onClick={() => updateColoringPatternMode(option.value)}
                                >
                                  <span aria-hidden="true">{option.icon}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <ComplexityControl
                          value={coloringPatternComplexity}
                          onChange={(value) => { setColoringPatternComplexity(value); setPreview(null); setErr(null); }}
                          label={t("games.param.complexity")}
                        />
                        <SeedVisibilityToggle
                          checked={coloringPatternShowSeed}
                          onChange={(checked) => { setColoringPatternShowSeed(checked); setPreview(null); setErr(null); }}
                          label={t("games.param.showSeed")}
                          onText={t("games.seedVisible")}
                          offText={t("games.seedHidden")}
                        />
                        <div className="games-setting-row">
                          {coloringPatternSeedManual ? (
                            <>
                              <span className="games-setting-label">{t("games.param.seed")}</span>
                              <div className="games-seed-row">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  className="games-seed-input"
                                  value={coloringPatternSeedInput}
                                  onChange={(e) => { setColoringPatternSeedInput(e.target.value); setPreview(null); setErr(null); }}
                                />
                                <button type="button" className="games-seed-toggle" onClick={() => { setColoringPatternSeedManual(false); setPreview(null); setErr(null); }}>
                                  {t("games.maze.seedAuto")}
                                </button>
                              </div>
                            </>
                          ) : (
                            <button type="button" className="games-seed-toggle" onClick={() => { setColoringPatternSeedInput(String(coloringPatternSeed).padStart(5, "0")); setColoringPatternSeedManual(true); }}>
                              {t("games.maze.seedManual")}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              <div className="games-panel">
                <div className="games-panel-head">
                  <h3>{t("games.autoFitTitle")}</h3>
                </div>
                <p className="muted games-detail-copy">{t("games.autoFitHint")}</p>
                <div className="games-chip-grid">
                  {autoFitIndicators(autoTemplate, cal, t).map((detail) => (
                    <span key={`${detail.label}-${detail.value}`} className="games-chip">
                      <strong>{detail.label}:</strong> {detail.value}
                    </span>
                  ))}
                </div>
              </div>

              <div className="games-generate-wrap">
                <button
                  type="button"
                  className="games-generate-btn"
                  title={t("games.generate")}
                  aria-label={t("games.generate")}
                  onClick={generateAction}
                  disabled={busy}
                >
                  <span aria-hidden="true">✦</span>
                </button>
                <span className="muted games-generate-label">{t("games.generate")}</span>
              </div>
            </>
          )}

          {supported && cal && autoError && <div className="banner err">{autoError}</div>}
          {supported && !cal && <p className="muted">{t("games.loadingPlotArea")}</p>}
          {err && <div className="banner err">{err}</div>}
        </aside>
      </div>

      {preview && cal && (
        <Modal
          title={<>{t("games.generatedTitle")} · <span className="muted">{preview.template.name}</span></>}
          onClose={() => !busy && setPreview(null)}
          className="games-modal"
          bodyClassName="games-modal-body"
          headerActions={(
            <div className="games-modal-actions">
              <LiveButton
                state={live.state}
                viewers={live.viewers}
                onClick={() => live.state === "live" || live.state === "connecting" ? live.stop("user-stopped") : live.start()}
              />
              {SEEDED_GAMES.has(preview.gameId) && (
                <button type="button" className="ghost games-mini-action" disabled={busy} onClick={regeneratePreview}>
                  {t("games.regenerate")}
                </button>
              )}
            </div>
          )}
          footer={
            <>
              {SEEDED_GAMES.has(preview.gameId) && (
                <button type="button" className="ghost" disabled={busy} onClick={regeneratePreview}>
                  {t("games.regenerate")}
                </button>
              )}
              {preview.gameId === "maze" && preview.template.solutionLines && (
                <button type="button" className="ghost" onClick={() => setShowMazeSolution(s => !s)}>
                  {showMazeSolution ? t("games.maze.hideSolution") : t("games.maze.showSolution")}
                </button>
              )}
              {preview.gameId === "sudoku" && preview.template.solutionLines && (
                <button type="button" className="ghost" onClick={() => setShowSudokuSolution(s => !s)}>
                  {showSudokuSolution ? t("games.maze.hideSolution") : t("games.maze.showSolution")}
                </button>
              )}
              <button className="primary" disabled={busy} onClick={createPageFromPreview}>
                {busy ? t("games.creatingPage") : t("games.createPage")}
              </button>
            </>
          }
        >
          <div className="games-modal-content">
            <div className="games-chip-grid compact">
              {preview.template.details.map((detail) => (
                <span key={`${detail.label}-${detail.value}`} className="games-chip">
                  <strong>{detail.label}:</strong> {detail.value}
                </span>
              ))}
              <span className="games-chip">{preview.template.width.toFixed(0)} × {preview.template.height.toFixed(0)} mm</span>
              <span className="games-chip">{preview.template.lines.length} {t("common.linesShort")}</span>
            </div>
            <GamePreviewSvg
              cal={cal}
              lines={preview.template.lines}
              solutionLines={
                (preview.gameId === "maze" ? showMazeSolution : showSudokuSolution)
                  ? preview.template.solutionLines
                  : undefined
              }
              className="games-modal-preview"
            />
            {live.error && <div className="banner err live-error-inline">{live.error}</div>}
          </div>
        </Modal>
      )}

      {showOsmMapEditor && cal && (
        <OsmMapEditor
          cal={cal}
          busy={busy}
          onClose={() => setShowOsmMapEditor(false)}
          onInsert={(template) => {
            setShowOsmMapEditor(false);
            createPageFromTemplate("osmMap", template);
          }}
        />
      )}
    </div>
  );
}

function osmPlaceholderTemplate(
  cal: Calibration,
  t: (key: string, vars?: Record<string, string | number>) => string,
): TemplateSpec {
  const width = Math.max(20, cal.plot_width - 8);
  const height = Math.max(20, cal.plot_height - 8);
  return {
    name: t("game.osmMap.name"),
    lines: [],
    width,
    height,
    details: [
      { label: t("games.osm.layers"), value: t("games.osm.chooseInEditor") },
    ],
  };
}

function mazePlaceholderTemplate(cal: Calibration, t: (key: string, vars?: Record<string, string | number>) => string, size: MazeSize, type: MazeType): TemplateSpec {
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

function autoFitIndicators(
  template: TemplateSpec,
  cal: Calibration,
  t: (key: string, vars?: Record<string, string | number>) => string,
) {
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

function sudokuPlaceholderTemplate(cal: Calibration, t: (key: string, vars?: Record<string, string | number>) => string, difficulty: SudokuDifficulty, seed: number): TemplateSpec {
  const empty = Array.from({ length: 9 }, () => Array(9).fill(0));
  return buildSudokuTemplate(cal, t, {
    seed: String(seed),
    difficulty,
    puzzle: empty,
    solution: empty,
    metadata: {},
  });
}

function coloringRequestArea(cal: Calibration) {
  return {
    width: Math.max(60, cal.plot_width - 8),
    height: Math.max(60, cal.plot_height - 8),
  };
}

function coloringPlaceholderTemplate(
  cal: Calibration,
  t: (key: string, vars?: Record<string, string | number>) => string,
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

function buildColoringTemplate(
  page: ColoringPageResponse,
  t: (key: string, vars?: Record<string, string | number>) => string,
): TemplateSpec {
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

function modeLabelKey(mode: string) {
  if (mode === "hex_mosaic") return "hexMosaic";
  if (mode === "wave_field") return "waveField";
  if (mode === "stained_glass") return "stainedGlass";
  return mode;
}

function ComplexityControl({ value, onChange, label }: {
  value: number;
  onChange: (value: number) => void;
  label: string;
}) {
  return (
    <div className="games-setting-row">
      <span className="games-setting-label">{label}</span>
      <div className="games-seed-row games-complexity-row">
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="games-chip">{Math.round(value * 100)}%</span>
      </div>
    </div>
  );
}

function SeedVisibilityToggle({ checked, onChange, label, onText, offText }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  onText: string;
  offText: string;
}) {
  return (
    <div className="games-setting-row">
      <button
        type="button"
        className={`games-toggle ${checked ? "on" : ""}`}
        aria-label={label}
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
      >
        <span className="games-toggle-track" aria-hidden="true">
          <span className="games-toggle-thumb" />
        </span>
        <span>{checked ? onText : offText}</span>
      </button>
    </div>
  );
}
