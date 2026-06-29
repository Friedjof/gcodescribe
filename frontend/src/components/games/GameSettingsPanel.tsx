import type { Calibration } from "../../api";
import Segmented from "../Segmented";
import {
  type BattleshipsSize,
  type ColoringMandalaMode,
  type ColoringPatternMode,
  type DotsDensity,
  type DotsJitter,
  type DotsPlayable,
  type GameId,
  type MazeSize,
  type MazeType,
  type SudokuDifficulty,
  type TemplateSpec,
} from "../../games/types";
import { MAZE_TYPES } from "../../games/mazeTypes";
import { autoFitIndicators, COLORING_PATTERN_OPTIONS } from "../../games/templates";
import { useI18n } from "../../i18n";

export interface SeedInputState {
  manual: boolean;
  input: string;
  seed: number;
  onInput: (v: string) => void;
  onToggle: (manual: boolean) => void;
}

export interface GameSettingsPanelProps {
  selectedGameId: GameId;
  cal: Calibration;
  autoTemplate: TemplateSpec;
  onGenerate: () => void;
  busy: boolean;
  dotsBoxes: {
    density: DotsDensity; jitter: DotsJitter; playable: DotsPlayable; seed: SeedInputState;
    onDensity: (v: DotsDensity) => void; onJitter: (v: DotsJitter) => void; onPlayable: (v: DotsPlayable) => void;
  };
  battleshipsSize: BattleshipsSize;
  onBattleshipsSize: (v: BattleshipsSize) => void;
  maze: {
    size: MazeSize; type: MazeType; seed: SeedInputState;
    onSize: (v: MazeSize) => void; onType: (v: MazeType) => void;
  };
  sudoku: {
    difficulty: SudokuDifficulty; seed: SeedInputState;
    onDifficulty: (v: SudokuDifficulty) => void;
  };
  mandala: {
    mode: ColoringMandalaMode; complexity: number; showSeed: boolean; seed: SeedInputState;
    onMode: (v: ColoringMandalaMode) => void;
    onComplexity: (v: number) => void;
    onShowSeed: (v: boolean) => void;
  };
  pattern: {
    mode: ColoringPatternMode; complexity: number; showSeed: boolean; seed: SeedInputState;
    onMode: (v: ColoringPatternMode) => void;
    onComplexity: (v: number) => void;
    onShowSeed: (v: boolean) => void;
  };
  curveMorph: {
    curves: number; complexity: number; snapToGrid: boolean; seed: SeedInputState;
    onCurves: (v: number) => void;
    onComplexity: (v: number) => void;
    onSnap: (v: boolean) => void;
  };
  noodles: {
    columns: number; thickness: number; fill: number; rounded: boolean; maxLength: number; seed: SeedInputState;
    onColumns: (v: number) => void;
    onThickness: (v: number) => void;
    onFill: (v: number) => void;
    onRounded: (v: boolean) => void;
    onMaxLength: (v: number) => void;
  };
}

export function GameSettingsPanel({
  selectedGameId,
  cal,
  autoTemplate,
  onGenerate,
  busy,
  dotsBoxes,
  battleshipsSize,
  onBattleshipsSize,
  maze,
  sudoku,
  mandala,
  pattern,
  curveMorph,
  noodles,
}: GameSettingsPanelProps) {
  const { t } = useI18n();
  const hasSettings = ["dotsBoxes", "battleships", "maze", "sudoku", "coloringMandala", "coloringPattern", "curveMorph", "noodles"].includes(selectedGameId);

  return (
    <>
      {hasSettings && (
        <div className="games-panel">
          <div className="games-panel-head">
            <h3>{t("games.settings")}</h3>
          </div>
          <div className="games-settings">
            {selectedGameId === "dotsBoxes" && (
              <>
                <div className="games-setting-row">
                  <span className="games-setting-label">{t("games.param.density")}</span>
                  <Segmented<DotsDensity>
                    value={dotsBoxes.density}
                    onChange={dotsBoxes.onDensity}
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
                    value={dotsBoxes.jitter}
                    onChange={dotsBoxes.onJitter}
                    options={[
                      { value: "straight", label: t("games.option.borderShape.straight") },
                      { value: "organic",  label: t("games.option.borderShape.organic") },
                      { value: "wild",     label: t("games.option.borderShape.wild") },
                    ]}
                  />
                </div>
                <div className="games-setting-row">
                  <span className="games-setting-label">{t("games.param.playable")}</span>
                  <Segmented<DotsPlayable>
                    value={dotsBoxes.playable}
                    onChange={dotsBoxes.onPlayable}
                    options={[
                      { value: "sparse",   label: t("games.option.playable.sparse") },
                      { value: "balanced", label: t("games.option.playable.balanced") },
                      { value: "full",     label: t("games.option.playable.full") },
                    ]}
                  />
                </div>
                <SeedInputRow state={dotsBoxes.seed} />
              </>
            )}

            {selectedGameId === "battleships" && (
              <div className="games-setting-row">
                <span className="games-setting-label">{t("games.param.boardSize")}</span>
                <Segmented<BattleshipsSize>
                  value={battleshipsSize}
                  onChange={onBattleshipsSize}
                  options={[
                    { value: "s8",  label: "8×8" },
                    { value: "s10", label: "10×10" },
                    { value: "s12", label: "12×12" },
                  ]}
                />
              </div>
            )}

            {selectedGameId === "maze" && (
              <>
                <div className="games-setting-row">
                  <span className="games-setting-label">{t("games.param.mazeSize")}</span>
                  <Segmented<MazeSize>
                    value={maze.size}
                    onChange={maze.onSize}
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
                        aria-checked={maze.type === type.id}
                        className={maze.type === type.id ? "selected" : ""}
                        onClick={() => maze.onType(type.id)}
                      >
                        <span aria-hidden="true">{type.symbol}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <SeedInputRow state={maze.seed} />
              </>
            )}

            {selectedGameId === "sudoku" && (
              <>
                <div className="games-setting-row">
                  <span className="games-setting-label">{t("games.param.difficulty")}</span>
                  <Segmented<SudokuDifficulty>
                    value={sudoku.difficulty}
                    onChange={sudoku.onDifficulty}
                    options={[
                      { value: "easy",   label: t("games.option.difficulty.easy") },
                      { value: "medium", label: t("games.option.difficulty.medium") },
                      { value: "hard",   label: t("games.option.difficulty.hard") },
                    ]}
                  />
                </div>
                <SeedInputRow state={sudoku.seed} />
              </>
            )}

            {selectedGameId === "coloringMandala" && (
              <>
                <div className="games-setting-row">
                  <span className="games-setting-label">{t("games.param.coloringMode")}</span>
                  <Segmented<ColoringMandalaMode>
                    value={mandala.mode}
                    onChange={mandala.onMode}
                    options={[
                      { value: "flower",    label: t("games.option.coloring.flower") },
                      { value: "star",      label: t("games.option.coloring.star") },
                      { value: "butterfly", label: t("games.option.coloring.butterfly") },
                      { value: "sun",       label: t("games.option.coloring.sun") },
                      { value: "nature",    label: t("games.option.coloring.nature") },
                      { value: "magic",     label: t("games.option.coloring.magic") },
                    ]}
                  />
                </div>
                <ComplexityControl
                  value={mandala.complexity}
                  onChange={mandala.onComplexity}
                  label={t("games.param.complexity")}
                />
                <SeedVisibilityToggle
                  checked={mandala.showSeed}
                  onChange={mandala.onShowSeed}
                  label={t("games.param.showSeed")}
                  onText={t("games.seedVisible")}
                  offText={t("games.seedHidden")}
                />
                <SeedInputRow state={mandala.seed} />
              </>
            )}

            {selectedGameId === "coloringPattern" && (
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
                          className={pattern.mode === option.value ? "selected" : ""}
                          title={label}
                          aria-label={label}
                          aria-checked={pattern.mode === option.value}
                          role="radio"
                          onClick={() => pattern.onMode(option.value)}
                        >
                          <span aria-hidden="true">{option.icon}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <ComplexityControl
                  value={pattern.complexity}
                  onChange={pattern.onComplexity}
                  label={t("games.param.complexity")}
                />
                <SeedVisibilityToggle
                  checked={pattern.showSeed}
                  onChange={pattern.onShowSeed}
                  label={t("games.param.showSeed")}
                  onText={t("games.seedVisible")}
                  offText={t("games.seedHidden")}
                />
                <SeedInputRow state={pattern.seed} />
              </>
            )}

            {selectedGameId === "curveMorph" && (
              <>
                <IntSliderControl
                  value={curveMorph.curves}
                  onChange={curveMorph.onCurves}
                  min={2}
                  max={40}
                  label={t("games.param.transitionalCurves")}
                />
                <ComplexityControl
                  value={curveMorph.complexity}
                  onChange={curveMorph.onComplexity}
                  label={t("games.param.complexity")}
                />
                <SeedVisibilityToggle
                  checked={curveMorph.snapToGrid}
                  onChange={curveMorph.onSnap}
                  label={t("games.param.snapGrid")}
                  onText={t("games.gridOn")}
                  offText={t("games.gridOff")}
                />
                <SeedInputRow state={curveMorph.seed} />
              </>
            )}

            {selectedGameId === "noodles" && (
              <>
                <IntSliderControl
                  value={noodles.columns}
                  onChange={noodles.onColumns}
                  min={4}
                  max={20}
                  label={t("games.param.gridDensity")}
                />
                <ComplexityControl
                  value={noodles.thickness}
                  onChange={noodles.onThickness}
                  label={t("games.param.thickness")}
                />
                <ComplexityControl
                  value={noodles.fill}
                  onChange={noodles.onFill}
                  label={t("games.param.fill")}
                />
                <IntSliderControl
                  value={noodles.maxLength}
                  onChange={noodles.onMaxLength}
                  min={2}
                  max={30}
                  label={t("games.param.maxLength")}
                />
                <SeedVisibilityToggle
                  checked={noodles.rounded}
                  onChange={noodles.onRounded}
                  label={t("games.param.corners")}
                  onText={t("games.cornersRound")}
                  offText={t("games.cornersSquare")}
                />
                <SeedInputRow state={noodles.seed} />
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
          onClick={onGenerate}
          disabled={busy}
        >
          <span aria-hidden="true">✦</span>
        </button>
        <span className="muted games-generate-label">{t("games.generate")}</span>
      </div>
    </>
  );
}

function SeedInputRow({ state }: { state: SeedInputState }) {
  const { t } = useI18n();
  return (
    <div className="games-setting-row">
      {state.manual ? (
        <>
          <span className="games-setting-label">{t("games.param.seed")}</span>
          <div className="games-seed-row">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className="games-seed-input"
              value={state.input}
              onChange={(e) => state.onInput(e.target.value)}
            />
            <button type="button" className="games-seed-toggle" onClick={() => state.onToggle(false)}>
              {t("games.maze.seedAuto")}
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="games-seed-toggle" onClick={() => state.onToggle(true)}>
          {t("games.maze.seedManual")}
        </button>
      )}
    </div>
  );
}

function ComplexityControl({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="games-setting-row">
      <span className="games-setting-label">{label}</span>
      <div className="games-seed-row games-complexity-row">
        <input type="range" min="0" max="1" step="0.05" value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="games-chip">{Math.round(value * 100)}%</span>
      </div>
    </div>
  );
}

function IntSliderControl(
  { value, onChange, min, max, label }:
  { value: number; onChange: (v: number) => void; min: number; max: number; label: string },
) {
  return (
    <div className="games-setting-row">
      <span className="games-setting-label">{label}</span>
      <div className="games-seed-row games-complexity-row">
        <input type="range" min={min} max={max} step="1" value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="games-chip">{value}</span>
      </div>
    </div>
  );
}

function SeedVisibilityToggle({
  checked, onChange, label, onText, offText,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; onText: string; offText: string }) {
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
