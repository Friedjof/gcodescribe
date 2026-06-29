import { useI18n } from "../../i18n";
import type { CanvasTool } from "./GlyphCanvas";
import GlyphAlignmentPanel from "./GlyphAlignmentPanel";

const TOOLS: { id: CanvasTool; icon: string; labelKey: string; shortKey: string; shortcut: string }[] = [
  { id: "draw", icon: "✏", labelKey: "fontEditor.toolDraw", shortKey: "fontEditor.toolDraw", shortcut: "D" },
  { id: "erase", icon: "⌫", labelKey: "fontEditor.toolErase", shortKey: "fontEditor.toolErase", shortcut: "E" },
  { id: "move", icon: "✥", labelKey: "fontEditor.toolMove", shortKey: "fontEditor.toolMoveShort", shortcut: "M" },
];

export default function GlyphToolbar({
  tool,
  canUndo,
  canRedo,
  hasStrokes,
  glyphExists,
  isPlaying,
  onToolChange,
  onUndo,
  onRedo,
  onReset,
  onDeleteGlyph,
  onPlayback,
  onStabilization,
  onWritingTest,
  spacingBefore,
  advance,
  minSpacingBefore,
  maxSpacingBefore,
  minAdvance,
  maxAdvance,
  onMoveGlyph,
  onScaleGlyph,
  onAutoAlignGlyph,
  onSpacingBeforeChange,
  onAdvanceChange,
}: {
  tool: CanvasTool;
  canUndo: boolean;
  canRedo: boolean;
  hasStrokes: boolean;
  glyphExists: boolean;
  isPlaying: boolean;
  onToolChange: (tool: CanvasTool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  onDeleteGlyph: () => void;
  onPlayback: () => void;
  onStabilization: () => void;
  onWritingTest: () => void;
  spacingBefore: number;
  advance: number;
  minSpacingBefore: number;
  maxSpacingBefore: number;
  minAdvance: number;
  maxAdvance: number;
  onMoveGlyph: (dx: number, dy: number) => void;
  onScaleGlyph: (factor: number) => void;
  onAutoAlignGlyph: () => void;
  onSpacingBeforeChange: (spacingBefore: number) => void;
  onAdvanceChange: (advance: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="fe-toolbar">
      <h3 className="fe-toolbar-title">{t("fontEditor.tools")}</h3>

      {/* Tool modes — icon + short label, one shared row. */}
      <div className="fe-tool-modes">
        {TOOLS.map((m) => (
          <button
            key={m.id}
            className={`fe-tool-mode ${tool === m.id ? "is-active" : ""}`}
            onClick={() => onToolChange(m.id)}
            title={`${t(m.labelKey)} (${m.shortcut})`}
          >
            <span className="fe-tool-mode-icon">{m.icon}</span>
            <span className="fe-tool-mode-label">{t(m.shortKey)}</span>
          </button>
        ))}
      </div>

      {/* History + per-glyph actions — compact icon row. */}
      <div className="fe-tool-actions">
        <button className="fe-tool-icon" onClick={onUndo} disabled={!canUndo} title={`${t("fontEditor.undo")} (Ctrl+Z)`}>
          ↶
        </button>
        <button className="fe-tool-icon" onClick={onRedo} disabled={!canRedo} title={`${t("fontEditor.redo")} (Ctrl+Y)`}>
          ↷
        </button>
        <span className="fe-tool-divider" />
        <button className="fe-tool-icon" onClick={onReset} disabled={!hasStrokes} title={t("fontEditor.reset")}>
          ↺
        </button>
        <button
          className="fe-tool-icon"
          onClick={onPlayback}
          disabled={!hasStrokes || isPlaying}
          title={`${t("fontEditor.playback")} (P)`}
        >
          ▶
        </button>
        <button
          className="fe-tool-icon danger"
          onClick={onDeleteGlyph}
          disabled={!glyphExists}
          title={t("fontEditor.deleteGlyph")}
        >
          🗑
        </button>
      </div>

      {/* Dialogs. */}
      <div className="fe-tool-panels">
        <button className="fe-tool-btn" onClick={onStabilization}>
          {t("fontEditor.stabilization")}
        </button>
        <button className="fe-tool-btn" onClick={onWritingTest}>
          {t("fontEditor.writingTest")}
        </button>
      </div>

      <div className="fe-tool-sep" />
      <GlyphAlignmentPanel
        hasStrokes={hasStrokes}
        spacingBefore={spacingBefore}
        advance={advance}
        minSpacingBefore={minSpacingBefore}
        maxSpacingBefore={maxSpacingBefore}
        minAdvance={minAdvance}
        maxAdvance={maxAdvance}
        onMove={onMoveGlyph}
        onScale={onScaleGlyph}
        onAutoAlign={onAutoAlignGlyph}
        onSpacingBeforeChange={onSpacingBeforeChange}
        onAdvanceChange={onAdvanceChange}
      />
    </div>
  );
}
