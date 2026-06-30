import type { Stroke, StrokeFontMetrics, StrokeVariant } from "../../api";
import { useI18n } from "../../i18n";
import { metricTop, pointsToPath, viewBoxFor } from "../../fontEditor/strokeGeometry";

// Horizontal strip of the active glyph's variants. Each tile is a mini preview
// of one variant's strokes; clicking switches which variant the canvas edits.
// The render engine already picks a variant at random (weighted) per glyph, so
// every variant added here makes the typeset text more varied.

function strokePts(stroke: Stroke) {
  return stroke.points.length ? stroke.points : stroke.rawPoints;
}

function VariantThumb({ strokes, metrics }: { strokes: Stroke[]; metrics: StrokeFontMetrics }) {
  const top = metricTop(metrics);
  const vb = viewBoxFor(metrics);
  const penWidth = Math.max(8, Math.round(metrics.em * 0.018));
  return (
    <svg
      className="fe-variant-thumb-svg"
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <g strokeWidth={penWidth}>
        {strokes.map((s) => {
          const d = pointsToPath(strokePts(s), top);
          return d ? <path key={s.id} d={d} /> : null;
        })}
      </g>
    </svg>
  );
}

export default function GlyphVariantStrip({
  variants,
  activeIndex,
  activeStrokes,
  metrics,
  maxVariants,
  onSelect,
  onAddEmpty,
  onDuplicate,
  onRemove,
  onWeightChange,
  onWeightCommit,
}: {
  variants: StrokeVariant[];
  activeIndex: number;
  activeStrokes: Stroke[];
  metrics: StrokeFontMetrics;
  maxVariants: number;
  onSelect: (index: number) => void;
  onAddEmpty: () => void;
  onDuplicate: () => void;
  onRemove: (index: number) => void;
  onWeightChange: (index: number, weight: number) => void;
  onWeightCommit: () => void;
}) {
  const { t } = useI18n();
  const canAdd = variants.length < maxVariants;

  return (
    <div className="fe-variants" aria-label={t("fontEditor.variantsTitle")}>
      <span className="fe-variants-label muted">{t("fontEditor.variantsTitle")}</span>
      <div className="fe-variants-strip">
        {variants.map((variant, index) => {
          const strokes = index === activeIndex ? activeStrokes : variant.strokes;
          const active = index === activeIndex;
          return (
            <div
              key={variant.id}
              className={`fe-variant-tile ${active ? "is-active" : ""}`}
            >
              <button
                type="button"
                className="fe-variant-preview"
                aria-pressed={active}
                title={t("fontEditor.variantSelect").replace("{n}", String(index + 1))}
                onClick={() => onSelect(index)}
              >
                <VariantThumb strokes={strokes} metrics={metrics} />
                <span className="fe-variant-index">{index + 1}</span>
              </button>
              <div className="fe-variant-meta">
                <label className="fe-variant-weight" title={t("fontEditor.variantWeight")}>
                  <span aria-hidden="true">×</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={variant.weight}
                    onChange={(e) => onWeightChange(index, Number(e.target.value))}
                    onBlur={onWeightCommit}
                    aria-label={t("fontEditor.variantWeight")}
                  />
                </label>
                {variants.length > 1 && (
                  <button
                    type="button"
                    className="fe-variant-remove"
                    title={t("fontEditor.variantRemove")}
                    aria-label={t("fontEditor.variantRemove")}
                    onClick={() => onRemove(index)}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <div className="fe-variant-add">
          <button
            type="button"
            className="fe-variant-add-empty"
            disabled={!canAdd}
            title={t("fontEditor.variantAddEmpty")}
            onClick={onAddEmpty}
          >
            ＋ {t("fontEditor.variantAdd")}
          </button>
          <button
            type="button"
            className="fe-variant-add-dup"
            disabled={!canAdd}
            title={t("fontEditor.variantDuplicate")}
            onClick={onDuplicate}
          >
            ⧉ {t("fontEditor.variantDuplicate")}
          </button>
        </div>
      </div>
    </div>
  );
}
