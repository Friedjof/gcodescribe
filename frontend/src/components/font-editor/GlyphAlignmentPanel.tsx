import { useI18n } from "../../i18n";

export default function GlyphAlignmentPanel({
  hasStrokes,
  spacingBefore,
  advance,
  minSpacingBefore,
  maxSpacingBefore,
  minAdvance,
  maxAdvance,
  onMove,
  onScale,
  onAutoAlign,
  onSpacingBeforeChange,
  onAdvanceChange,
}: {
  hasStrokes: boolean;
  spacingBefore: number;
  advance: number;
  minSpacingBefore: number;
  maxSpacingBefore: number;
  minAdvance: number;
  maxAdvance: number;
  onMove: (dx: number, dy: number) => void;
  onScale: (factor: number) => void;
  onAutoAlign: () => void;
  onSpacingBeforeChange: (spacingBefore: number) => void;
  onAdvanceChange: (advance: number) => void;
}) {
  const { t } = useI18n();
  return (
    <section className="fe-align-panel" aria-label={t("fontEditor.alignTitle")}>
      <h3 className="fe-toolbar-title">{t("fontEditor.alignTitle")}</h3>
      <div className="fe-align-grid">
        <button className="fe-align-up" onClick={() => onMove(0, 20)} disabled={!hasStrokes} title={t("fontEditor.alignUp")}>
          ↑
        </button>
        <button className="fe-align-left" onClick={() => onMove(-20, 0)} disabled={!hasStrokes} title={t("fontEditor.alignLeft")}>
          ←
        </button>
        <button className="fe-align-right" onClick={() => onMove(20, 0)} disabled={!hasStrokes} title={t("fontEditor.alignRight")}>
          →
        </button>
        <button className="fe-align-down" onClick={() => onMove(0, -20)} disabled={!hasStrokes} title={t("fontEditor.alignDown")}>
          ↓
        </button>
      </div>
      <div className="fe-align-actions">
        <button onClick={() => onScale(0.95)} disabled={!hasStrokes}>
          {t("fontEditor.alignSmaller")}
        </button>
        <button onClick={() => onScale(1.05)} disabled={!hasStrokes}>
          {t("fontEditor.alignLarger")}
        </button>
      </div>
      <button className="fe-tool-btn" onClick={onAutoAlign} disabled={!hasStrokes}>
        {t("fontEditor.alignAuto")}
      </button>
      <label className="fe-align-advance">
        <span>{t("fontEditor.alignBefore")}</span>
        <input
          type="range"
          min={minSpacingBefore}
          max={maxSpacingBefore}
          step="10"
          value={spacingBefore}
          onChange={(e) => onSpacingBeforeChange(Number(e.target.value))}
          disabled={!hasStrokes}
        />
        <span className="fe-align-value">{Math.round(spacingBefore)}</span>
      </label>
      <label className="fe-align-advance">
        <span>{t("fontEditor.alignAdvance")}</span>
        <input
          type="range"
          min={minAdvance}
          max={maxAdvance}
          step="10"
          value={advance}
          onChange={(e) => onAdvanceChange(Number(e.target.value))}
          disabled={!hasStrokes}
        />
        <span className="fe-align-value">{Math.round(advance)}</span>
      </label>
    </section>
  );
}
