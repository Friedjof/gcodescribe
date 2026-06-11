import { useEffect, useState } from "react";
import { api, type Calibration } from "../api";
import { useI18n } from "../i18n";
import { toPath } from "../paint/geometry";
import type { Pt } from "../paint/geometry";
import Modal from "./Modal";
import Segmented from "./Segmented";
import {
  type GameId,
  type DotsDensity,
  type DotsJitter,
  type DotsPlayable,
  type MazeSize,
  type MazeType,
  type BattleshipsSize,
  type SudokuDifficulty,
  type TemplateSpec,
  type GeneratedPreview,
} from "../games/types";
import { SUPPORTED_GAMES, SEEDED_GAMES, GAME_GROUPS, ALL_GAMES } from "../games/constants";
import { buildTemplate } from "../games/builder";
import { templateObject, randomSeed, randomMazeSeed } from "../games/utils";

export default function Games({ onOpenPaint }: { onOpenPaint: () => void }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<GameId>(ALL_GAMES[0].id);
  const [cal, setCal] = useState<Calibration | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dotsDensity, setDotsDensity] = useState<DotsDensity>("balanced");
  const [dotsJitter, setDotsJitter] = useState<DotsJitter>("organic");
  const [dotsPlayable, setDotsPlayable] = useState<DotsPlayable>("balanced");
  const [dotsSeed, setDotsSeed] = useState(() => randomSeed());
  const [battleshipsSize, setBattleshipsSize] = useState<BattleshipsSize>("s10");
  const [mazeSeed, setMazeSeed] = useState(() => randomMazeSeed());
  const [mazeSeedManual, setMazeSeedManual] = useState(false);
  const [showMazeSolution, setShowMazeSolution] = useState(false);
  const [mazeSize, setMazeSize] = useState<MazeSize>("medium");
  const [mazeType, setMazeType] = useState<MazeType>("classic");
  const [sudokuDifficulty, setSudokuDifficulty] = useState<SudokuDifficulty>("medium");
  const [sudokuSeed, setSudokuSeed] = useState(() => randomMazeSeed());
  const [sudokuSeedManual, setSudokuSeedManual] = useState(false);
  const [showSudokuSolution, setShowSudokuSolution] = useState(false);
  const [bingoSeed, setBingoSeed] = useState(() => randomSeed());
  const [preview, setPreview] = useState<GeneratedPreview | null>(null);
  const selectedGame = ALL_GAMES.find((game) => game.id === selected) ?? ALL_GAMES[0];
  const supported = SUPPORTED_GAMES.has(selectedGame.id);

  const fail = (e: any) => setErr(String(e.message ?? e));

  useEffect(() => {
    api.getCalibration().then(setCal).catch(fail);
  }, []);

  let autoTemplate: TemplateSpec | null = null;
  let autoError: string | null = null;
  if (cal && supported) {
    try {
      autoTemplate = buildTemplate(selectedGame.id, cal, t, {
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

  const generatePreview = (gameId = selectedGame.id, seedHint?: number) => {
    if (!cal) {
      setErr(t("games.loadingPlotArea"));
      return;
    }
    if (!SUPPORTED_GAMES.has(gameId)) {
      setErr(t("games.notReadyHint"));
      return;
    }
    const seed = seedHint ?? (
      gameId === "dotsBoxes" ? dotsSeed
      : gameId === "maze"    ? (mazeSeedManual ? mazeSeed : randomMazeSeed())
      : gameId === "sudoku"  ? (sudokuSeedManual ? sudokuSeed : randomMazeSeed())
      : gameId === "bingo"   ? bingoSeed
      : 1
    );
    try {
      const template = buildTemplate(gameId, cal, t, {
        dotsBoxes: { density: dotsDensity, seed: gameId === "dotsBoxes" ? seed : dotsSeed, jitter: dotsJitter, playable: dotsPlayable },
        battleships: battleshipsSize,
        maze: gameId === "maze" ? seed : mazeSeed,
        mazeSettings: { size: mazeSize, type: mazeType },
        sudoku: { difficulty: sudokuDifficulty, seed: gameId === "sudoku" ? seed : sudokuSeed },
        bingo: gameId === "bingo" ? seed : bingoSeed,
      });
      if (gameId === "dotsBoxes") setDotsSeed(seed);
      if (gameId === "maze") { setMazeSeed(seed); setShowMazeSolution(false); }
      if (gameId === "sudoku") { setSudokuSeed(seed); setShowSudokuSolution(false); }
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
      else nextSeed = randomSeed();
    }
    setShowMazeSolution(false);
    setShowSudokuSolution(false);
    generatePreview(preview.gameId, nextSeed);
  };

  const regenerateFromDetail = () => {
    if (!SEEDED_GAMES.has(selectedGame.id)) return;
    if (selectedGame.id === "dotsBoxes") {
      setDotsSeed(randomSeed());
      setErr(null);
      return;
    }
    const next =
      selectedGame.id === "maze"   ? (mazeSeedManual ? mazeSeed : randomMazeSeed())
      : selectedGame.id === "sudoku" ? (sudokuSeedManual ? sudokuSeed : randomMazeSeed())
      : randomSeed();
    generatePreview(selectedGame.id, next);
  };

  const hasSettings = ["dotsBoxes", "battleships", "maze", "sudoku"].includes(selectedGame.id);

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
                              { value: "relaxed", label: t("games.option.density.relaxed") },
                              { value: "balanced", label: t("games.option.density.balanced") },
                              { value: "dense", label: t("games.option.density.dense") },
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
                              { value: "extreme", label: t("games.option.mazeSize.extreme") },
                            ]}
                          />
                        </div>
                        <div className="games-setting-row">
                          <span className="games-setting-label">{t("games.param.mazeType")}</span>
                          <Segmented<MazeType>
                            value={mazeType}
                            onChange={updateMazeType}
                            options={[
                              { value: "classic", label: t("games.option.mazeType.classic") },
                              { value: "branchy", label: t("games.option.mazeType.branchy") },
                              { value: "braid",   label: t("games.option.mazeType.braid") },
                            ]}
                          />
                        </div>
                        <div className="games-setting-row">
                          {mazeSeedManual ? (
                            <>
                              <span className="games-setting-label">{t("games.param.seed")}</span>
                              <div className="games-seed-row">
                                <input
                                  type="number"
                                  className="games-seed-input"
                                  min={10000}
                                  max={99999}
                                  value={mazeSeed}
                                  onChange={(e) => {
                                    const v = Math.max(10000, Math.min(99999, parseInt(e.target.value) || 10000));
                                    setMazeSeed(v);
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
                              onClick={() => setMazeSeedManual(true)}
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
                                  type="number"
                                  className="games-seed-input"
                                  min={10000}
                                  max={99999}
                                  value={sudokuSeed}
                                  onChange={(e) => {
                                    const v = Math.max(10000, Math.min(99999, parseInt(e.target.value) || 10000));
                                    setSudokuSeed(v);
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
                              onClick={() => setSudokuSeedManual(true)}
                            >
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
                  {autoTemplate.details.map((detail) => (
                    <span key={`${detail.label}-${detail.value}`} className="games-chip">
                      <strong>{detail.label}:</strong> {detail.value}
                    </span>
                  ))}
                  <span className="games-chip">{autoTemplate.width.toFixed(0)} × {autoTemplate.height.toFixed(0)} mm</span>
                  <span className="games-chip">{autoTemplate.lines.length} {t("place.linesShort")}</span>
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
                {SEEDED_GAMES.has(selectedGame.id) && (
                  <button type="button" className="ghost games-secondary-action" onClick={regenerateFromDetail}>
                    {t("games.regenerate")}
                  </button>
                )}
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
          headerActions={SEEDED_GAMES.has(preview.gameId) ? (
            <button type="button" className="ghost games-mini-action" disabled={busy} onClick={regeneratePreview}>
              {t("games.regenerate")}
            </button>
          ) : undefined}
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
              <span className="games-chip">{preview.template.lines.length} {t("place.linesShort")}</span>
            </div>
            <PreviewSvg
              cal={cal}
              lines={preview.template.lines}
              solutionLines={
                (preview.gameId === "maze" && showMazeSolution) ||
                (preview.gameId === "sudoku" && showSudokuSolution)
                  ? preview.template.solutionLines : undefined
              }
              className="games-modal-preview"
            />
          </div>
        </Modal>
      )}
    </div>
  );
}

function PreviewSvg({ cal, lines, solutionLines, className = "" }: {
  cal: Calibration;
  lines: Pt[][];
  solutionLines?: Pt[][];
  className?: string;
}) {
  const W = cal.plot_width;
  const H = cal.plot_height;
  const pad = Math.max(W, H) * 0.04 + 4;
  const stroke = Math.max(Math.max(W, H) * 0.004, 0.45);
  const grid = Math.max(10, Math.round(Math.min(W, H) / 10 / 5) * 5);
  const major = grid * 5;
  return (
    <div className={`games-preview ${className}`.trim()}>
      <svg viewBox={`${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <pattern id="games-grid-minor" width={grid} height={grid} patternUnits="userSpaceOnUse">
            <path d={`M ${grid} 0 L 0 0 L 0 ${grid}`} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={0.25} />
          </pattern>
          <pattern id="games-grid-major" width={major} height={major} patternUnits="userSpaceOnUse">
            <rect width={major} height={major} fill="url(#games-grid-minor)" />
            <path d={`M ${major} 0 L 0 0 L 0 ${major}`} fill="none" stroke="rgba(255,255,255,0.13)" strokeWidth={0.4} />
          </pattern>
        </defs>

        <rect x={0} y={0} width={W} height={H} rx={1.5} fill="#101013" stroke="var(--accent)" strokeWidth={0.6} />
        <rect x={0} y={0} width={W} height={H} fill="url(#games-grid-major)" />

        {lines.map((line, index) => (
          <path
            key={index}
            d={toPath(line)}
            fill="none"
            stroke="var(--busy)"
            strokeWidth={stroke}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {solutionLines?.map((line, index) => (
          <path
            key={`sol-${index}`}
            d={toPath(line)}
            fill="none"
            stroke="rgba(255, 80, 80, 0.85)"
            strokeWidth={stroke * 2.2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        <text x={W / 2} y={H + pad * 0.7} fontSize={Math.max(W, H) * 0.022} fill="var(--muted)" textAnchor="middle">
          {W.toFixed(0)} × {H.toFixed(0)} mm
        </text>
      </svg>
    </div>
  );
}
