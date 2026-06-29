import { type FillMode, type StrokeMode, type VectorStyle } from "../../paint/styling";
import { useI18n } from "../../i18n";

export interface SelectedObjectSize {
  width: number;
  height: number;
  localWidth: number;
  localHeight: number;
}

export interface PaintStylePanelProps {
  hasSelection: boolean;
  selectedObjectSize: SelectedObjectSize | null;
  selectedObjectRotation: number | null;
  selectedStyle: VectorStyle;
  sizeLinked: boolean;
  onSizeLinkedToggle: () => void;
  onWidthChange: (v: number) => void;
  onHeightChange: (v: number) => void;
  onRotationChange: (deg: number) => void;
  onStyleChange: (patch: Partial<VectorStyle>) => void;
}

export function PaintStylePanel({
  hasSelection,
  selectedObjectSize,
  selectedObjectRotation,
  selectedStyle,
  sizeLinked,
  onSizeLinkedToggle,
  onWidthChange,
  onHeightChange,
  onRotationChange,
  onStyleChange,
}: PaintStylePanelProps) {
  const { t } = useI18n();

  return (
    <div className="paint-style-panel">
      <h4>{t("paint.object")}</h4>
      <div className="paint-size-fields">
        <label className="field">
          {t("common.width")}
          <div className="input-unit">
            <input
              type="number"
              min={0.1}
              step={0.5}
              disabled={!selectedObjectSize || selectedObjectSize.localWidth <= 0}
              value={selectedObjectSize ? Number(selectedObjectSize.width.toFixed(1)) : ""}
              onChange={(e) => {
                if (e.target.value !== "") onWidthChange(Number(e.target.value));
              }}
            />
            <em>mm</em>
          </div>
        </label>
        <label className="field">
          {t("common.height")}
          <div className="input-unit">
            <input
              type="number"
              min={0.1}
              step={0.5}
              disabled={!selectedObjectSize || selectedObjectSize.localHeight <= 0}
              value={selectedObjectSize ? Number(selectedObjectSize.height.toFixed(1)) : ""}
              onChange={(e) => {
                if (e.target.value !== "") onHeightChange(Number(e.target.value));
              }}
            />
            <em>mm</em>
          </div>
        </label>
        <label className="field">
          {t("common.rotation")}
          <div className="input-unit">
            <input
              type="number"
              min={0}
              max={360}
              step={1}
              disabled={selectedObjectRotation == null}
              value={selectedObjectRotation == null ? "" : Number(selectedObjectRotation.toFixed(1))}
              onChange={(e) => {
                if (e.target.value !== "") onRotationChange(Number(e.target.value));
              }}
            />
            <em>°</em>
          </div>
        </label>
        <button
          type="button"
          className={`size-link ${sizeLinked ? "active" : ""}`}
          aria-pressed={sizeLinked}
          aria-label={t("paint.keepAspect")}
          title={t("paint.keepAspect")}
          onClick={onSizeLinkedToggle}
        >
          <svg
            className="size-link-ico"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            {!sizeLinked && <line className="size-link-cut" x1="3" y1="3" x2="21" y2="21" />}
          </svg>
        </button>
      </div>

      <h4>{t("paint.style.line")}</h4>
      <label className="field">
        {t("paint.style.type")}
        <select
          disabled={!hasSelection}
          value={selectedStyle.stroke.mode}
          onChange={(e) => onStyleChange({ stroke: { mode: e.target.value as StrokeMode } as any })}
        >
          <option value="solid">{t("paint.style.solid")}</option>
          <option value="dashed">{t("paint.style.dashed")}</option>
          <option value="dotted">{t("paint.style.dotted")}</option>
        </select>
      </label>
      {selectedStyle.stroke.mode === "dashed" && (
        <div className="fields compact">
          <label className="field">
            {t("paint.style.dash")}
            <input
              type="number"
              min={0.5}
              step={0.5}
              disabled={!hasSelection}
              value={selectedStyle.stroke.dashLength}
              onChange={(e) =>
                onStyleChange({ stroke: { dashLength: Number(e.target.value) || 1 } as any })
              }
            />
          </label>
          <label className="field">
            {t("paint.style.gap")}
            <input
              type="number"
              min={0.5}
              step={0.5}
              disabled={!hasSelection}
              value={selectedStyle.stroke.gapLength}
              onChange={(e) =>
                onStyleChange({ stroke: { gapLength: Number(e.target.value) || 1 } as any })
              }
            />
          </label>
        </div>
      )}
      {selectedStyle.stroke.mode === "dotted" && (
        <div className="fields compact">
          <label className="field">
            {t("paint.style.spacing")}
            <input
              type="number"
              min={0.5}
              step={0.5}
              disabled={!hasSelection}
              value={selectedStyle.stroke.dotSpacing}
              onChange={(e) =>
                onStyleChange({ stroke: { dotSpacing: Number(e.target.value) || 1 } as any })
              }
            />
          </label>
          <label className="field">
            {t("paint.size")}
            <input
              type="number"
              min={0.2}
              step={0.2}
              disabled={!hasSelection}
              value={selectedStyle.stroke.dotSize}
              onChange={(e) =>
                onStyleChange({ stroke: { dotSize: Number(e.target.value) || 0.5 } as any })
              }
            />
          </label>
        </div>
      )}

      <h4>{t("paint.style.fill")}</h4>
      <label className="check style-check">
        <input
          type="checkbox"
          disabled={!hasSelection}
          checked={selectedStyle.fill.enabled}
          onChange={(e) => onStyleChange({ fill: { enabled: e.target.checked } as any })}
        />
        {t("paint.style.active")}
      </label>
      {selectedStyle.fill.enabled && (
        <div className="fields compact">
          <label className="field">
            {t("paint.style.pattern")}
            <select
              disabled={!hasSelection}
              value={selectedStyle.fill.mode}
              onChange={(e) =>
                onStyleChange({ fill: { mode: e.target.value as FillMode } as any })
              }
            >
              <option value="hatch">{t("paint.image.hatch")}</option>
              <option value="dashed-hatch">{t("paint.style.dashedHatch")}</option>
              <option value="dotted-fill">{t("paint.image.dots")}</option>
            </select>
          </label>
          {selectedStyle.fill.mode !== "dotted-fill" && (
            <label className="field">
              {t("paint.style.angle")}
              <input
                type="number"
                step={5}
                disabled={!hasSelection}
                value={selectedStyle.fill.angle}
                onChange={(e) =>
                  onStyleChange({ fill: { angle: Number(e.target.value) || 0 } as any })
                }
              />
            </label>
          )}
          <label className="field">
            {t("paint.style.spacing")}
            <input
              type="number"
              min={0.5}
              step={0.5}
              disabled={!hasSelection}
              value={
                selectedStyle.fill.mode === "dotted-fill"
                  ? selectedStyle.fill.dotSpacing
                  : selectedStyle.fill.spacing
              }
              onChange={(e) =>
                onStyleChange({
                  fill:
                    selectedStyle.fill.mode === "dotted-fill"
                      ? ({ dotSpacing: Number(e.target.value) || 1 } as any)
                      : ({ spacing: Number(e.target.value) || 1 } as any),
                })
              }
            />
          </label>
        </div>
      )}
    </div>
  );
}
