import { memo, useEffect, useMemo, useRef, useState } from "react";
import { api, type PageColoring } from "../../api";
import { useI18n } from "../../i18n";
import LiveButton from "../stream/components/LiveButton";
import { useLiveRegistryState } from "../stream/lib/liveRegistry";
import { useLiveStream } from "../stream/hooks/useLiveStream";
import { useLiveSource } from "../../hooks/useLiveSource";
import OsmMapEditor from "../osm/OsmMapEditor";
import StlEditor from "../stl/StlEditor";
import { resultToSvgLayers } from "../stl/lib";
import { useToasts } from "../../components/Toasts";
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
} from "./lib/types";
import { SUPPORTED_GAMES, SEEDED_GAMES, ALL_GAMES } from "./lib/constants";
import { buildTemplate } from "./lib/builder";
import { templateObject, polylinesObject } from "./lib/utils";
import { buildMazeTemplate, mazeRequestArea } from "./lib/maze";
import { buildSudokuTemplate } from "./lib/sudoku";
import {
  mazePlaceholderTemplate,
  sudokuPlaceholderTemplate,
  osmPlaceholderTemplate,
  coloringPlaceholderTemplate,
  buildColoringTemplate,
  coloringRequestArea,
} from "./lib/templates";
import { GameSettingsPanel } from "./components/GameSettingsPanel";
import GamePreviewSvg from "./components/PreviewSvg";
import TemplateLibrary from "./components/TemplateLibrary";
import SeedControl from "../../components/SeedControl";
import { useTemplateSeeds } from "./hooks/useTemplateSeeds";
import EditorIcon from "../../components/editor/EditorIcon";
import { useProjectCalibration } from "../../state/ProjectCalibrationContext";

function Games({
  visible = true,
  onOpenPaint,
  desktop = false,
}: {
  visible?: boolean;
  onOpenPaint: () => void;
  desktop?: boolean;
}) {
  const { t } = useI18n();
  const toast = useToasts();
  const [selected, setSelected] = useState<GameId>(ALL_GAMES[0].id);
  const { index, profile, loading: profileLoading } = useProjectCalibration();
  const cal = !profileLoading ? (profile?.calibration ?? null) : null;
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seeds = useTemplateSeeds();
  const dotsSeed = seeds.value("dotsBoxes");
  const mazeSeed = seeds.value("maze");
  const sudokuSeed = seeds.value("sudoku");
  const bingoSeed = seeds.value("bingo");
  const curveMorphSeed = seeds.value("curveMorph");
  const noodlesSeed = seeds.value("noodles");
  const [dotsDensity, setDotsDensity] = useState<DotsDensity>("balanced");
  const [dotsJitter, setDotsJitter] = useState<DotsJitter>("organic");
  const [dotsPlayable, setDotsPlayable] = useState<DotsPlayable>("balanced");
  const [battleshipsSize, setBattleshipsSize] =
    useState<BattleshipsSize>("s10");
  const [showMazeSolution, setShowMazeSolution] = useState(false);
  const [mazeSize, setMazeSize] = useState<MazeSize>("medium");
  const [mazeType, setMazeType] = useState<MazeType>("classic");
  const [sudokuDifficulty, setSudokuDifficulty] =
    useState<SudokuDifficulty>("medium");
  const [showSudokuSolution, setShowSudokuSolution] = useState(false);
  const [coloringMandalaMode, setColoringMandalaMode] =
    useState<ColoringMandalaMode>("flower");
  const [coloringMandalaComplexity, setColoringMandalaComplexity] =
    useState(0.4);
  const [coloringMandalaShowSeed, setColoringMandalaShowSeed] = useState(false);
  const [coloringPatternMode, setColoringPatternMode] =
    useState<ColoringPatternMode>("scales");
  const [coloringPatternComplexity, setColoringPatternComplexity] =
    useState(0.4);
  const [coloringPatternShowSeed, setColoringPatternShowSeed] = useState(false);
  const [curveMorphCurves, setCurveMorphCurves] = useState(12);
  const [curveMorphComplexity, setCurveMorphComplexity] = useState(0.4);
  const [curveMorphSnap, setCurveMorphSnap] = useState(true);
  const [noodlesColumns, setNoodlesColumns] = useState(8);
  const [noodlesThickness, setNoodlesThickness] = useState(0.9);
  const [noodlesFill, setNoodlesFill] = useState(0.7);
  const [noodlesRounded, setNoodlesRounded] = useState(true);
  const [noodlesMaxLength, setNoodlesMaxLength] = useState(12);
  const [preview, setPreview] = useState<GeneratedPreview | null>(null);
  const [showStlEditor, setShowStlEditor] = useState(false);
  const [stlSaving, setStlSaving] = useState(false);
  const selectedGame =
    ALL_GAMES.find((game) => game.id === selected) ?? ALL_GAMES[0];
  const supported = SUPPORTED_GAMES.has(selectedGame.id);
  const globalLive = useLiveRegistryState();
  const generationSequence = useRef(0);

  const live = useLiveStream("games", () => {
    if (!cal) return null;
    if (!preview) {
      return {
        cal,
        page: {
          id: "games-placeholder",
          name: t("games.generatedTitle"),
          objects: [],
          grid: { step: 10, snap: false },
        },
        meta: {
          sourceId: "games",
          mode: "placeholder",
          pageName: t("games.generatedTitle"),
        },
      };
    }
    const solutionLines = (
      preview.gameId === "maze" ? showMazeSolution : showSudokuSolution
    )
      ? preview.template.solutionLines
      : undefined;
    return {
      cal,
      page: {
        id: `game-${preview.gameId}`,
        name: preview.template.name,
        objects: [],
        grid: { step: 10, snap: false },
      },
      meta: {
        sourceId: "games",
        mode: "game",
        pageName: preview.template.name,
      },
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

  useLiveSource(live, {
    visible,
    hiddenReason: "games-hidden",
    onError: toast.error,
    snapshotDeps: [preview, showMazeSolution, showSudokuSolution],
  });
  useEffect(() => {
    if (!visible || !preview || !cal) return;
    if (!globalLive.active || globalLive.sourceId === "games") return;
    live.start();
  }, [visible, preview, cal, globalLive.active, globalLive.sourceId]);
  useEffect(() => {
    if (err) toast.error(err);
  }, [err, toast]);

  const resetPreview = () => {
    generationSequence.current++;
    setGenerating(false);
    setPreview(null);
    setErr(null);
  };
  useEffect(() => {
    resetPreview();
  }, [selected, profile?.fingerprint, index?.project?.id, visible]);

  const { autoTemplate, autoError } = useMemo(() => {
    let autoTemplate: TemplateSpec | null = null;
    let autoError: string | null = null;
    if (cal && supported) {
      try {
        autoTemplate =
          selectedGame.id === "maze"
            ? mazePlaceholderTemplate(cal, t, mazeSize, mazeType)
            : selectedGame.id === "sudoku"
              ? sudokuPlaceholderTemplate(cal, t, sudokuDifficulty, sudokuSeed)
              : selectedGame.id === "osmMap"
                ? osmPlaceholderTemplate(cal, t)
                : selectedGame.id === "coloringMandala"
                  ? coloringPlaceholderTemplate(
                      cal,
                      t,
                      "mandala",
                      coloringMandalaMode,
                      coloringMandalaComplexity,
                      coloringMandalaShowSeed,
                    )
                  : selectedGame.id === "coloringPattern"
                    ? coloringPlaceholderTemplate(
                        cal,
                        t,
                        "math_pattern",
                        coloringPatternMode,
                        coloringPatternComplexity,
                        coloringPatternShowSeed,
                      )
                    : buildTemplate(selectedGame.id, cal, t, {
                        dotsBoxes: {
                          density: dotsDensity,
                          seed: dotsSeed,
                          jitter: dotsJitter,
                          playable: dotsPlayable,
                        },
                        battleships: battleshipsSize,
                        maze: mazeSeed,
                        mazeSettings: { size: mazeSize, type: mazeType },
                        sudoku: {
                          difficulty: sudokuDifficulty,
                          seed: sudokuSeed,
                        },
                        bingo: bingoSeed,
                        curveMorph: {
                          seed: curveMorphSeed,
                          curves: curveMorphCurves,
                          complexity: curveMorphComplexity,
                          snapToGrid: curveMorphSnap,
                        },
                        noodles: {
                          seed: noodlesSeed,
                          columns: noodlesColumns,
                          thickness: noodlesThickness,
                          fill: noodlesFill,
                          rounded: noodlesRounded,
                          maxLength: noodlesMaxLength,
                        },
                      });
      } catch (e: any) {
        autoError = String(e.message ?? e);
      }
    }

    return { autoTemplate, autoError };
  }, [
    cal,
    selectedGame.id,
    supported,
    t,
    mazeSize,
    mazeType,
    sudokuDifficulty,
    sudokuSeed,
    coloringMandalaMode,
    coloringMandalaComplexity,
    coloringMandalaShowSeed,
    coloringPatternMode,
    coloringPatternComplexity,
    coloringPatternShowSeed,
    dotsDensity,
    dotsSeed,
    dotsJitter,
    dotsPlayable,
    battleshipsSize,
    mazeSeed,
    bingoSeed,
    curveMorphSeed,
    curveMorphCurves,
    curveMorphComplexity,
    curveMorphSnap,
    noodlesSeed,
    noodlesColumns,
    noodlesThickness,
    noodlesFill,
    noodlesRounded,
    noodlesMaxLength,
  ]);

  const seedForGame = (gameId: GameId, seedHint?: number): number | null => {
    const seed = seedHint ?? seeds.resolve(gameId);
    if (seed === null) setErr(t("games.errorSeedLength"));
    return seed;
  };

  const generatePreview = async (
    gameId = selectedGame.id,
    seedHint?: number,
  ) => {
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
    const sequence = ++generationSequence.current;
    setGenerating(true);
    try {
      if (gameId === "maze") {
        const { width, height } = mazeRequestArea(cal);
        const maze = await api.getMaze(mazeType, seed, mazeSize, width, height);
        if (sequence !== generationSequence.current) return;
        const template = buildMazeTemplate(maze, cal, t, mazeSize);
        setShowMazeSolution(false);
        setPreview({ gameId, template, seed });
        setErr(null);
        return;
      }
      if (gameId === "sudoku") {
        const sudokuResp = await api.getSudoku(sudokuDifficulty, seed);
        if (sequence !== generationSequence.current) return;
        const template = buildSudokuTemplate(cal, t, sudokuResp);
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
          isMandala ? coloringMandalaShowSeed : coloringPatternShowSeed,
        );
        if (sequence !== generationSequence.current) return;
        const template = buildColoringTemplate(page, t);
        setPreview({ gameId, template, seed });
        setErr(null);
        return;
      }
      const template = buildTemplate(gameId, cal, t, {
        dotsBoxes: {
          density: dotsDensity,
          seed: gameId === "dotsBoxes" ? seed : dotsSeed,
          jitter: dotsJitter,
          playable: dotsPlayable,
        },
        battleships: battleshipsSize,
        maze: mazeSeed,
        mazeSettings: { size: mazeSize, type: mazeType },
        sudoku: { difficulty: sudokuDifficulty, seed: sudokuSeed },
        bingo: gameId === "bingo" ? seed : bingoSeed,
        curveMorph: {
          seed: gameId === "curveMorph" ? seed : curveMorphSeed,
          curves: curveMorphCurves,
          complexity: curveMorphComplexity,
          snapToGrid: curveMorphSnap,
        },
        noodles: {
          seed: gameId === "noodles" ? seed : noodlesSeed,
          columns: noodlesColumns,
          thickness: noodlesThickness,
          fill: noodlesFill,
          rounded: noodlesRounded,
          maxLength: noodlesMaxLength,
        },
      });
      setPreview({ gameId, template, seed });
      setErr(null);
    } catch (e: any) {
      if (sequence === generationSequence.current)
        setErr(String(e.message ?? e));
    } finally {
      if (sequence === generationSequence.current) setGenerating(false);
    }
  };

  const regeneratePreview = () => {
    if (preview) generatePreview(preview.gameId);
  };

  const createPageFromTemplate = (gameId: GameId, template: TemplateSpec) => {
    if (!index?.project) return;
    setBusy(true);
    setErr(null);
    api
      .createPage(template.name)
      .then((page) =>
        api.savePage(page.id, {
          objects: [templateObject(gameId, template.lines, SEEDED_GAMES.has(gameId) ? preview?.seed : undefined)],
          ...(template.continuous != null
            ? { continuous: template.continuous }
            : {}),
        }),
      )
      .then(() => {
        setPreview(null);
        onOpenPaint();
      })
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const createPageFromStl = (
    template: TemplateSpec,
    coloring: PageColoring | null,
  ) => {
    if (!index?.project) return;
    setBusy(true);
    setErr(null);
    api
      .createPage(template.name)
      .then((page) =>
        api.savePage(page.id, {
          objects: [polylinesObject(template.lines)],
          ...(coloring ? { coloring } : {}),
        }),
      )
      .then(() => {
        setShowStlEditor(false);
        onOpenPaint();
      })
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const generateAction = () => {
    if (selectedGame.id === "osmMap") {
      return;
      return;
    }
    generatePreview();
  };

  const displayTemplate =
    preview?.gameId === selectedGame.id ? preview.template : autoTemplate;
  const solutionLines = (
    preview?.gameId === "maze" ? showMazeSolution : showSudokuSolution
  )
    ? displayTemplate?.solutionLines
    : undefined;
  return (
    <div className="template-workspace">
      <TemplateLibrary
        selected={selected}
        onSelect={(id) => {
          setSelected(id);
          resetPreview();
        }}
        onStl={() => setShowStlEditor(true)}
        ready={!!cal}
      />
      {selected === "osmMap" && cal ? (
        <OsmMapEditor
          cal={cal}
          busy={busy}
          active={visible}
          onInsert={(template) => createPageFromTemplate("osmMap", template)}
        />
      ) : (
        <>
          <section className="template-stage">
            <div className="template-stage-head">
              <div>
                <h2>{t(`game.${selectedGame.id}.name`)}</h2>
                <p>{t(`game.${selectedGame.id}.desc`)}</p>
              </div>
              {!desktop && (
                <LiveButton
                  state={live.state}
                  viewers={live.viewers}
                  onClick={() =>
                    live.state === "live" || live.state === "connecting"
                      ? live.stop("user-stopped")
                      : live.start()
                  }
                />
              )}
            </div>
            <div className="template-stage-preview">
              {cal && displayTemplate ? (
                <GamePreviewSvg
                  cal={cal}
                  lines={displayTemplate.lines}
                  solutionLines={solutionLines}
                />
              ) : (
                <div className="template-preview-empty">
                  <EditorIcon name="shape" size={40} />
                  <span>
                    {t(cal ? "games.notReadyHint" : "games.loadingPlotArea")}
                  </span>
                </div>
              )}
            </div>
            <div className="template-stage-status">
              <span>
                {displayTemplate
                  ? `${displayTemplate.width.toFixed(0)} × ${displayTemplate.height.toFixed(0)} mm`
                  : ""}
              </span>
              {preview?.template.solutionLines && (
                <button
                  type="button"
                  onClick={() =>
                    preview.gameId === "maze"
                      ? setShowMazeSolution((v) => !v)
                      : setShowSudokuSolution((v) => !v)
                  }
                >
                  {t(
                    (
                      preview.gameId === "maze"
                        ? showMazeSolution
                        : showSudokuSolution
                    )
                      ? "games.maze.hideSolution"
                      : "games.maze.showSolution",
                  )}
                </button>
              )}
              <span>
                {preview
                  ? `${t("games.generatedTitle")}${SEEDED_GAMES.has(selected) ? ` · ${t("seed.label")}: ${String(preview.seed).padStart(5, "0")}` : ""}`
                  : t("games.previewDraft")}
              </span>
            </div>
          </section>
          <aside className="template-inspector">
            <header>
              <strong>{t("games.settings")}</strong>
            </header>
            <div className="template-parameters">
              {supported && cal && autoTemplate && (
                <GameSettingsPanel
                  embedded
                  key={selectedGame.id}
                  selectedGameId={selectedGame.id}
                  cal={cal}
                  autoTemplate={autoTemplate}
                  onGenerate={generateAction}
                  busy={busy || generating}
                  dotsBoxes={{
                    density: dotsDensity,
                    jitter: dotsJitter,
                    playable: dotsPlayable,
                    seed: seeds.controls("dotsBoxes"),
                    onDensity: (v) => {
                      setDotsDensity(v);
                      resetPreview();
                    },
                    onJitter: (v) => {
                      setDotsJitter(v);
                      resetPreview();
                    },
                    onPlayable: (v) => {
                      setDotsPlayable(v);
                      resetPreview();
                    },
                  }}
                  battleshipsSize={battleshipsSize}
                  onBattleshipsSize={(v) => {
                    setBattleshipsSize(v);
                    resetPreview();
                  }}
                  maze={{
                    size: mazeSize,
                    type: mazeType,
                    seed: seeds.controls("maze"),
                    onSize: (v) => {
                      setMazeSize(v);
                      resetPreview();
                    },
                    onType: (v) => {
                      setMazeType(v);
                      resetPreview();
                    },
                  }}
                  sudoku={{
                    difficulty: sudokuDifficulty,
                    seed: seeds.controls("sudoku"),
                    onDifficulty: (v) => {
                      setSudokuDifficulty(v);
                      resetPreview();
                    },
                  }}
                  mandala={{
                    mode: coloringMandalaMode,
                    complexity: coloringMandalaComplexity,
                    showSeed: coloringMandalaShowSeed,
                    seed: seeds.controls("coloringMandala"),
                    onMode: (v) => {
                      setColoringMandalaMode(v);
                      resetPreview();
                    },
                    onComplexity: (v) => {
                      setColoringMandalaComplexity(v);
                      resetPreview();
                    },
                    onShowSeed: (v) => {
                      setColoringMandalaShowSeed(v);
                      resetPreview();
                    },
                  }}
                  pattern={{
                    mode: coloringPatternMode,
                    complexity: coloringPatternComplexity,
                    showSeed: coloringPatternShowSeed,
                    seed: seeds.controls("coloringPattern"),
                    onMode: (v) => {
                      setColoringPatternMode(v);
                      resetPreview();
                    },
                    onComplexity: (v) => {
                      setColoringPatternComplexity(v);
                      resetPreview();
                    },
                    onShowSeed: (v) => {
                      setColoringPatternShowSeed(v);
                      resetPreview();
                    },
                  }}
                  curveMorph={{
                    curves: curveMorphCurves,
                    complexity: curveMorphComplexity,
                    snapToGrid: curveMorphSnap,
                    seed: seeds.controls("curveMorph"),
                    onCurves: (v) => {
                      setCurveMorphCurves(v);
                      resetPreview();
                    },
                    onComplexity: (v) => {
                      setCurveMorphComplexity(v);
                      resetPreview();
                    },
                    onSnap: (v) => {
                      setCurveMorphSnap(v);
                      resetPreview();
                    },
                  }}
                  noodles={{
                    columns: noodlesColumns,
                    thickness: noodlesThickness,
                    fill: noodlesFill,
                    rounded: noodlesRounded,
                    maxLength: noodlesMaxLength,
                    seed: seeds.controls("noodles"),
                    onColumns: (v) => {
                      setNoodlesColumns(v);
                      resetPreview();
                    },
                    onThickness: (v) => {
                      setNoodlesThickness(v);
                      resetPreview();
                    },
                    onFill: (v) => {
                      setNoodlesFill(v);
                      resetPreview();
                    },
                    onRounded: (v) => {
                      setNoodlesRounded(v);
                      resetPreview();
                    },
                    onMaxLength: (v) => {
                      setNoodlesMaxLength(v);
                      resetPreview();
                    },
                  }}
                />
              )}
            </div>
            {SEEDED_GAMES.has(selected) && (
              <SeedControl
                value={seeds.input(selected)}
                disabled={busy || generating}
                onChange={(value) => {
                  seeds.set(selected, value);
                  resetPreview();
                }}
                onRandomize={() => {
                  const seed = seeds.randomize(selected);
                  resetPreview();
                  generatePreview(selected, seed);
                }}
              />
            )}
            {(autoError || err) && (
              <p className="banner err" role="alert">
                {autoError || err}
              </p>
            )}
            <div className="template-inspector-info">
              <span>{t("games.autoFitTitle")}</span>
              <strong>
                {cal
                  ? `${cal.plot_width.toFixed(0)} × ${cal.plot_height.toFixed(0)} mm`
                  : "—"}
              </strong>
            </div>
            <footer className="template-inspector-actions">
              <button
                type="button"
                disabled={
                  !cal ||
                  busy ||
                  generating ||
                  !supported ||
                  seeds.resolve(selected) === null
                }
                onClick={preview ? regeneratePreview : generateAction}
              >
                <EditorIcon name="preview" size={17} />
                {t(preview ? "games.regenerate" : "games.generate")}
              </button>
              <button
                type="button"
                className="primary"
                disabled={!preview || busy || generating}
                onClick={() =>
                  preview &&
                  createPageFromTemplate(preview.gameId, preview.template)
                }
              >
                <EditorIcon name="add" size={17} />
                {t(busy ? "games.creatingPage" : "games.createPage")}
              </button>
            </footer>
          </aside>
        </>
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
            api
              .galleryCreateStl(
                stl,
                filename,
                params,
                resultToSvgLayers(result),
                filename.replace(/\.stl$/i, ""),
              )
              .then(() => {
                setShowStlEditor(false);
                toast.success(t("stl.saved"));
              })
              .catch(fail)
              .finally(() => setStlSaving(false));
          }}
        />
      )}
    </div>
  );
}

export default memo(Games);
