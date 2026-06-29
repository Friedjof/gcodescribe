import type { Calibration } from "../../api";
import GamePreviewSvg from "../../games/PreviewSvg";
import { SEEDED_GAMES } from "../../games/constants";
import type { GeneratedPreview } from "../../games/types";
import { useI18n } from "../../i18n";
import LiveButton from "../../stream/LiveButton";
import Modal from "../Modal";

interface LiveState {
  state: "idle" | "connecting" | "live" | "error";
  viewers: number;
  start: () => void;
  stop: (reason: string) => void;
}

export interface GamePreviewModalProps {
  preview: GeneratedPreview;
  cal: Calibration;
  busy: boolean;
  showMazeSolution: boolean;
  showSudokuSolution: boolean;
  desktop: boolean;
  live: LiveState;
  onClose: () => void;
  onRegenerate: () => void;
  onToggleMazeSolution: () => void;
  onToggleSudokuSolution: () => void;
  onCreatePage: () => void;
}

export function GamePreviewModal({
  preview,
  cal,
  busy,
  showMazeSolution,
  showSudokuSolution,
  desktop,
  live,
  onClose,
  onRegenerate,
  onToggleMazeSolution,
  onToggleSudokuSolution,
  onCreatePage,
}: GamePreviewModalProps) {
  const { t } = useI18n();
  const solutionLines =
    (preview.gameId === "maze" ? showMazeSolution : showSudokuSolution)
      ? preview.template.solutionLines
      : undefined;

  return (
    <Modal
      title={<>{t("games.generatedTitle")} · <span className="muted">{preview.template.name}</span></>}
      onClose={() => !busy && onClose()}
      className="games-modal"
      bodyClassName="games-modal-body"
      headerActions={
        <div className="games-modal-actions">
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
          {SEEDED_GAMES.has(preview.gameId) && (
            <button type="button" className="ghost games-mini-action" disabled={busy} onClick={onRegenerate}>
              {t("games.regenerate")}
            </button>
          )}
        </div>
      }
      footer={
        <>
          {SEEDED_GAMES.has(preview.gameId) && (
            <button type="button" className="ghost" disabled={busy} onClick={onRegenerate}>
              {t("games.regenerate")}
            </button>
          )}
          {preview.gameId === "maze" && preview.template.solutionLines && (
            <button type="button" className="ghost" onClick={onToggleMazeSolution}>
              {showMazeSolution ? t("games.maze.hideSolution") : t("games.maze.showSolution")}
            </button>
          )}
          {preview.gameId === "sudoku" && preview.template.solutionLines && (
            <button type="button" className="ghost" onClick={onToggleSudokuSolution}>
              {showSudokuSolution ? t("games.maze.hideSolution") : t("games.maze.showSolution")}
            </button>
          )}
          <button className="primary" disabled={busy} onClick={onCreatePage}>
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
          solutionLines={solutionLines}
          className="games-modal-preview"
        />
      </div>
    </Modal>
  );
}
