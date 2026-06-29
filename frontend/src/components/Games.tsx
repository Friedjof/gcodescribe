import { useEffect, useState } from "react";
import { api, type Calibration, type PageColoring } from "../api";
import { useI18n } from "../i18n";
import LiveButton from "../stream/LiveButton";
import { stopGlobalLive, useLiveRegistryState } from "../stream/liveRegistry";
import { useLiveStream } from "../stream/useLiveStream";
import OsmMapEditor from "./OsmMapEditor";
import StlEditor from "./StlEditor";
import { resultToSvgLayers } from "../stl";
import { useToasts } from "./Toasts";
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
import { templateObject, polylinesObject, randomSeed, randomMazeSeed } from "../games/utils";
import { buildMazeTemplate, mazeRequestArea } from "../games/maze";
import { buildSudokuTemplate } from "../games/sudoku";
import {
  mazePlaceholderTemplate,
  sudokuPlaceholderTemplate,
  osmPlaceholderTemplate,
  coloringPlaceholderTemplate,
  buildColoringTemplate,
  coloringRequestArea,
} from "../games/templates";
import { GameSettingsPanel } from "./games/GameSettingsPanel";
import { GamePreviewModal } from "./games/GamePreviewModal";

export default function Games({ visible = true, onOpenPaint, desktop = false }: { visible?: boolean; onOpenPaint: () => void; desktop?: boolean }) {
  const { t } = useI18n();
  const toast = useToasts();
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
  const [curveMorphSeed, setCurveMorphSeed] = useState(() => randomMazeSeed());
  const [curveMorphSeedManual, setCurveMorphSeedManual] = useState(false);
  const [curveMorphSeedInput, setCurveMorphSeedInput] = useState("");
  const [curveMorphCurves, setCurveMorphCurves] = useState(12);
  const [curveMorphComplexity, setCurveMorphComplexity] = useState(0.4);
  const [curveMorphSnap, setCurveMorphSnap] = useState(true);
  const [noodlesSeed, setNoodlesSeed] = useState(() => randomMazeSeed());
  const [noodlesSeedManual, setNoodlesSeedManual] = useState(false);
  const [noodlesSeedInput, setNoodlesSeedInput] = useState("");
  const [noodlesColumns, setNoodlesColumns] = useState(8);
  const [noodlesThickness, setNoodlesThickness] = useState(0.9);
  const [noodlesFill, setNoodlesFill] = useState(0.7);
  const [noodlesRounded, setNoodlesRounded] = useState(true);
  const [noodlesMaxLength, setNoodlesMaxLength] = useState(12);
  const [preview, setPreview] = useState<GeneratedPreview | null>(null);
  const [showOsmMapEditor, setShowOsmMapEditor] = useState(false);
  const [showStlEditor, setShowStlEditor] = useState(false);
  const [stlSaving, setStlSaving] = useState(false);
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
      ? preview.template.solutionLines : undefined;
    return {
      cal,
      page: { id: `game-${preview.gameId}`, name: preview.template.name, objects: [], grid: { step: 10, snap: false } },
      meta: { sourceId: "games", mode: "game", pageName: preview.template.name },
      game: { name: preview.template.name, lines: preview.template.lines, solutionLines, width: preview.template.width, height: preview.template.height },
    };
  });

  const fail = (e: any) => setErr(String(e.message ?? e));

  useEffect(() => { api.getCalibration().then(setCal).catch(fail); }, []);
  useEffect(() => { if (live.state === "live") live.sendSnapshot("snapshot"); }, [preview, showMazeSolution, showSudokuSolution, live.state]);
  useEffect(() => { if (visible || live.state !== "live") return; live.sendPlaceholder("games-hidden"); }, [visible, live.state]);
  useEffect(() => { if (!preview || !cal) return; if (!globalLive.active || globalLive.sourceId === "games") return; live.start(); }, [preview, cal, globalLive.active, globalLive.sourceId]);
  useEffect(() => { if (err) toast.error(err); }, [err, toast]);
  useEffect(() => { if (live.error) toast.error(live.error); }, [live.error, toast]);

  const resetPreview = () => { setPreview(null); setErr(null); };

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
                curveMorph: { seed: curveMorphSeed, curves: curveMorphCurves, complexity: curveMorphComplexity, snapToGrid: curveMorphSnap },
                noodles: { seed: noodlesSeed, columns: noodlesColumns, thickness: noodlesThickness, fill: noodlesFill, rounded: noodlesRounded, maxLength: noodlesMaxLength },
              });
    } catch (e: any) {
      autoError = String(e.message ?? e);
    }
  }

  const parseManualSeed = (value: string) => {
    if (!/^\d{5}$/.test(value)) { setErr(t("games.errorSeedLength")); return null; }
    return parseInt(value, 10);
  };

  const seedForGame = (gameId: GameId, seedHint?: number): number | null => {
    if (seedHint !== undefined) return seedHint;
    if (gameId === "dotsBoxes") return dotsSeedManual ? parseManualSeed(dotsSeedInput) : dotsSeed;
    if (gameId === "maze") return mazeSeedManual ? parseManualSeed(mazeSeedInput) : randomMazeSeed();
    if (gameId === "sudoku") return sudokuSeedManual ? parseManualSeed(sudokuSeedInput) : randomMazeSeed();
    if (gameId === "coloringMandala") return coloringMandalaSeedManual ? parseManualSeed(coloringMandalaSeedInput) : randomMazeSeed();
    if (gameId === "coloringPattern") return coloringPatternSeedManual ? parseManualSeed(coloringPatternSeedInput) : randomMazeSeed();
    if (gameId === "curveMorph") return curveMorphSeedManual ? parseManualSeed(curveMorphSeedInput) : randomMazeSeed();
    if (gameId === "noodles") return noodlesSeedManual ? parseManualSeed(noodlesSeedInput) : randomMazeSeed();
    if (gameId === "bingo") return bingoSeed;
    return 1;
  };

  const generatePreview = async (gameId = selectedGame.id, seedHint?: number) => {
    if (!cal) { setErr(t("games.loadingPlotArea")); return; }
    if (!SUPPORTED_GAMES.has(gameId)) { setErr(t("games.notReadyHint")); return; }
    const seed = seedForGame(gameId, seedHint);
    if (seed === null) return;
    try {
      if (gameId === "maze") {
        const { width, height } = mazeRequestArea(cal);
        const maze = await api.getMaze(mazeType, seed, mazeSize, width, height);
        const template = buildMazeTemplate(maze, cal, t, mazeSize);
        setMazeSeed(seed); setMazeSeedInput(String(seed).padStart(5, "0")); setShowMazeSolution(false);
        setPreview({ gameId, template, seed }); setErr(null); return;
      }
      if (gameId === "sudoku") {
        const sudokuResp = await api.getSudoku(sudokuDifficulty, seed);
        const template = buildSudokuTemplate(cal, t, sudokuResp);
        setSudokuSeed(seed); setSudokuSeedInput(String(seed).padStart(5, "0")); setShowSudokuSolution(false);
        setPreview({ gameId, template, seed }); setErr(null); return;
      }
      if (gameId === "coloringMandala" || gameId === "coloringPattern") {
        const { width, height } = coloringRequestArea(cal);
        const isMandala = gameId === "coloringMandala";
        const page = await api.getColoringPage(
          isMandala ? "mandala" : "math_pattern",
          isMandala ? coloringMandalaMode : coloringPatternMode,
          seed, width, height,
          isMandala ? coloringMandalaComplexity : coloringPatternComplexity,
          isMandala ? coloringMandalaShowSeed : coloringPatternShowSeed,
        );
        const template = buildColoringTemplate(page, t);
        if (isMandala) { setColoringMandalaSeed(seed); setColoringMandalaSeedInput(String(seed).padStart(5, "0")); }
        else { setColoringPatternSeed(seed); setColoringPatternSeedInput(String(seed).padStart(5, "0")); }
        setPreview({ gameId, template, seed }); setErr(null); return;
      }
      const template = buildTemplate(gameId, cal, t, {
        dotsBoxes: { density: dotsDensity, seed: gameId === "dotsBoxes" ? seed : dotsSeed, jitter: dotsJitter, playable: dotsPlayable },
        battleships: battleshipsSize,
        maze: mazeSeed,
        mazeSettings: { size: mazeSize, type: mazeType },
        sudoku: { difficulty: sudokuDifficulty, seed: sudokuSeed },
        bingo: gameId === "bingo" ? seed : bingoSeed,
        curveMorph: { seed: gameId === "curveMorph" ? seed : curveMorphSeed, curves: curveMorphCurves, complexity: curveMorphComplexity, snapToGrid: curveMorphSnap },
        noodles: { seed: gameId === "noodles" ? seed : noodlesSeed, columns: noodlesColumns, thickness: noodlesThickness, fill: noodlesFill, rounded: noodlesRounded, maxLength: noodlesMaxLength },
      });
      if (gameId === "dotsBoxes") { setDotsSeed(seed); setDotsSeedInput(String(seed).padStart(5, "0")); }
      if (gameId === "bingo") setBingoSeed(seed);
      if (gameId === "curveMorph") { setCurveMorphSeed(seed); setCurveMorphSeedInput(String(seed).padStart(5, "0")); }
      if (gameId === "noodles") { setNoodlesSeed(seed); setNoodlesSeedInput(String(seed).padStart(5, "0")); }
      setPreview({ gameId, template, seed }); setErr(null);
    } catch (e: any) { setErr(String(e.message ?? e)); }
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
    setShowMazeSolution(false); setShowSudokuSolution(false);
    generatePreview(preview.gameId, nextSeed);
  };

  const createPageFromTemplate = (gameId: GameId, template: TemplateSpec) => {
    setBusy(true); setErr(null);
    api.createPage(template.name)
      .then((page) => api.savePage(page.id, { objects: [templateObject(gameId, template.lines)] }))
      .then(() => { setPreview(null); onOpenPaint(); })
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const createPageFromStl = (template: TemplateSpec, coloring: PageColoring | null) => {
    setBusy(true); setErr(null);
    api.createPage(template.name)
      .then((page) => api.savePage(page.id, {
        objects: [polylinesObject(template.lines)],
        ...(coloring ? { coloring } : {}),
      }))
      .then(() => { setShowStlEditor(false); onOpenPaint(); })
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const generateAction = () => {
    if (selectedGame.id === "osmMap") { setShowOsmMapEditor(true); return; }
    generatePreview();
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
            <button
              type="button"
              className="ghost games-import-stl"
              disabled={!cal}
              onClick={() => setShowStlEditor(true)}
            >
              {t("stl.open")}
            </button>
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
                    onClick={() => { setSelected(game.id); resetPreview(); }}
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

          {!desktop && !preview && (globalLive.active || live.state === "live" || live.state === "connecting" || live.state === "error") && (
            <div className="games-live-standby">
              <span className="muted">{t("live.standby")}</span>
              <LiveButton
                state={globalLive.active && live.state === "idle" ? "live" : live.state}
                viewers={live.viewers}
                onClick={() =>
                  globalLive.active && live.state === "idle"
                    ? stopGlobalLive()
                    : live.state === "live" || live.state === "connecting"
                      ? live.stop("user-stopped")
                      : live.start()
                }
              />
            </div>
          )}

          {!supported && <div className="banner warn-inline"><span>{t("games.notReadyHint")}</span></div>}
          {supported && !cal && <p className="muted">{t("games.loadingPlotArea")}</p>}
          {supported && cal && autoError && <div className="banner err">{autoError}</div>}

          {supported && cal && autoTemplate && (
            <GameSettingsPanel
              selectedGameId={selectedGame.id}
              cal={cal}
              autoTemplate={autoTemplate}
              onGenerate={generateAction}
              busy={busy}
              dotsBoxes={{
                density: dotsDensity, jitter: dotsJitter, playable: dotsPlayable,
                seed: { manual: dotsSeedManual, input: dotsSeedInput, seed: dotsSeed,
                  onInput: (v) => { setDotsSeedInput(v); resetPreview(); },
                  onToggle: (m) => { if (m) setDotsSeedInput(String(dotsSeed).padStart(5, "0")); setDotsSeedManual(m); resetPreview(); } },
                onDensity: (v) => { setDotsDensity(v); resetPreview(); },
                onJitter: (v) => { setDotsJitter(v); resetPreview(); },
                onPlayable: (v) => { setDotsPlayable(v); resetPreview(); },
              }}
              battleshipsSize={battleshipsSize}
              onBattleshipsSize={(v) => { setBattleshipsSize(v); resetPreview(); }}
              maze={{
                size: mazeSize, type: mazeType,
                seed: { manual: mazeSeedManual, input: mazeSeedInput, seed: mazeSeed,
                  onInput: (v) => { setMazeSeedInput(v); resetPreview(); },
                  onToggle: (m) => { if (m) setMazeSeedInput(String(mazeSeed).padStart(5, "0")); setMazeSeedManual(m); resetPreview(); } },
                onSize: (v) => { setMazeSize(v); resetPreview(); },
                onType: (v) => { setMazeType(v); resetPreview(); },
              }}
              sudoku={{
                difficulty: sudokuDifficulty,
                seed: { manual: sudokuSeedManual, input: sudokuSeedInput, seed: sudokuSeed,
                  onInput: (v) => { setSudokuSeedInput(v); resetPreview(); },
                  onToggle: (m) => { if (m) setSudokuSeedInput(String(sudokuSeed).padStart(5, "0")); setSudokuSeedManual(m); resetPreview(); } },
                onDifficulty: (v) => { setSudokuDifficulty(v); resetPreview(); },
              }}
              mandala={{
                mode: coloringMandalaMode, complexity: coloringMandalaComplexity, showSeed: coloringMandalaShowSeed,
                seed: { manual: coloringMandalaSeedManual, input: coloringMandalaSeedInput, seed: coloringMandalaSeed,
                  onInput: (v) => { setColoringMandalaSeedInput(v); resetPreview(); },
                  onToggle: (m) => { if (m) setColoringMandalaSeedInput(String(coloringMandalaSeed).padStart(5, "0")); setColoringMandalaSeedManual(m); resetPreview(); } },
                onMode: (v) => { setColoringMandalaMode(v); resetPreview(); },
                onComplexity: (v) => { setColoringMandalaComplexity(v); resetPreview(); },
                onShowSeed: (v) => { setColoringMandalaShowSeed(v); resetPreview(); },
              }}
              pattern={{
                mode: coloringPatternMode, complexity: coloringPatternComplexity, showSeed: coloringPatternShowSeed,
                seed: { manual: coloringPatternSeedManual, input: coloringPatternSeedInput, seed: coloringPatternSeed,
                  onInput: (v) => { setColoringPatternSeedInput(v); resetPreview(); },
                  onToggle: (m) => { if (m) setColoringPatternSeedInput(String(coloringPatternSeed).padStart(5, "0")); setColoringPatternSeedManual(m); resetPreview(); } },
                onMode: (v) => { setColoringPatternMode(v); resetPreview(); },
                onComplexity: (v) => { setColoringPatternComplexity(v); resetPreview(); },
                onShowSeed: (v) => { setColoringPatternShowSeed(v); resetPreview(); },
              }}
              curveMorph={{
                curves: curveMorphCurves, complexity: curveMorphComplexity, snapToGrid: curveMorphSnap,
                seed: { manual: curveMorphSeedManual, input: curveMorphSeedInput, seed: curveMorphSeed,
                  onInput: (v) => { setCurveMorphSeedInput(v); resetPreview(); },
                  onToggle: (m) => { if (m) setCurveMorphSeedInput(String(curveMorphSeed).padStart(5, "0")); setCurveMorphSeedManual(m); resetPreview(); } },
                onCurves: (v) => { setCurveMorphCurves(v); resetPreview(); },
                onComplexity: (v) => { setCurveMorphComplexity(v); resetPreview(); },
                onSnap: (v) => { setCurveMorphSnap(v); resetPreview(); },
              }}
              noodles={{
                columns: noodlesColumns, thickness: noodlesThickness, fill: noodlesFill,
                rounded: noodlesRounded, maxLength: noodlesMaxLength,
                seed: { manual: noodlesSeedManual, input: noodlesSeedInput, seed: noodlesSeed,
                  onInput: (v) => { setNoodlesSeedInput(v); resetPreview(); },
                  onToggle: (m) => { if (m) setNoodlesSeedInput(String(noodlesSeed).padStart(5, "0")); setNoodlesSeedManual(m); resetPreview(); } },
                onColumns: (v) => { setNoodlesColumns(v); resetPreview(); },
                onThickness: (v) => { setNoodlesThickness(v); resetPreview(); },
                onFill: (v) => { setNoodlesFill(v); resetPreview(); },
                onRounded: (v) => { setNoodlesRounded(v); resetPreview(); },
                onMaxLength: (v) => { setNoodlesMaxLength(v); resetPreview(); },
              }}
            />
          )}
        </aside>
      </div>

      {preview && cal && (
        <GamePreviewModal
          preview={preview}
          cal={cal}
          busy={busy}
          showMazeSolution={showMazeSolution}
          showSudokuSolution={showSudokuSolution}
          desktop={desktop}
          live={live}
          onClose={() => setPreview(null)}
          onRegenerate={regeneratePreview}
          onToggleMazeSolution={() => setShowMazeSolution((s) => !s)}
          onToggleSudokuSolution={() => setShowSudokuSolution((s) => !s)}
          onCreatePage={() => preview && createPageFromTemplate(preview.gameId, preview.template)}
        />
      )}

      {showOsmMapEditor && cal && (
        <OsmMapEditor
          cal={cal}
          busy={busy}
          onClose={() => setShowOsmMapEditor(false)}
          onInsert={(template) => { setShowOsmMapEditor(false); createPageFromTemplate("osmMap", template); }}
        />
      )}

      {showStlEditor && cal && (
        <StlEditor
          cal={cal}
          busy={busy}
          saving={stlSaving}
          onClose={() => setShowStlEditor(false)}
          onInsert={createPageFromStl}
          onSaveGallery={({ stl, filename, params, result }) => {
            setStlSaving(true);
            api.galleryCreateStl(stl, filename, params, resultToSvgLayers(result), filename.replace(/\.stl$/i, ""))
              .then(() => { setShowStlEditor(false); toast.success(t("stl.saved")); })
              .catch(fail)
              .finally(() => setStlSaving(false));
          }}
        />
      )}
    </div>
  );
}
