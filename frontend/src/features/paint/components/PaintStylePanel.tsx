import NumberField from "../../../components/NumberField";
import Segmented from "../../../components/Segmented";
import { type StrokeMode, type VectorStyle } from "../lib/styling";
import { useI18n } from "../../../i18n";
import { FillOptions } from "./FillOptions";

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
  aspectLocked?: boolean;
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
  aspectLocked = false,
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
        <NumberField
          label={`${t("common.width")} (mm)`}
          min={0.1}
          step={0.5}
          disabled={!selectedObjectSize || selectedObjectSize.localWidth <= 0}
          value={selectedObjectSize ? Number(selectedObjectSize.width.toFixed(1)) : ""}
          onChange={onWidthChange}
        />
        <button
          type="button"
          className={`size-link ${sizeLinked ? "active" : ""}`}
          aria-pressed={sizeLinked}
          aria-label={t("paint.keepAspect")}
          title={t("paint.keepAspect")}
          disabled={aspectLocked}
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
        <NumberField
          label={`${t("common.height")} (mm)`}
          min={0.1}
          step={0.5}
          disabled={!selectedObjectSize || selectedObjectSize.localHeight <= 0}
          value={selectedObjectSize ? Number(selectedObjectSize.height.toFixed(1)) : ""}
          onChange={onHeightChange}
        />
        <NumberField
          label={t("common.rotation")}
          unit="°"
          min={0}
          max={360}
          step={1}
          disabled={selectedObjectRotation == null}
          value={selectedObjectRotation == null ? "" : Number(selectedObjectRotation.toFixed(1))}
          onChange={onRotationChange}
        />
      </div>

      <h4>{t("paint.style.line")}</h4>
      <div className={hasSelection ? "" : "seg-disabled"}>
        <Segmented<StrokeMode>
          value={selectedStyle.stroke.mode}
          onChange={(mode) => onStyleChange({ stroke: { mode } as any })}
          options={[
            { value: "solid", label: t("paint.style.solid") },
            { value: "dashed", label: t("paint.style.dashed") },
            { value: "dotted", label: t("paint.style.dotted") },
          ]}
        />
      </div>
      {selectedStyle.stroke.mode === "dashed" && (
        <div className="fields compact">
          <NumberField
            label={t("paint.style.dash")}
            unit="mm"
            min={0.5}
            step={0.5}
            disabled={!hasSelection}
            value={selectedStyle.stroke.dashLength}
            onChange={(v) => onStyleChange({ stroke: { dashLength: v || 1 } as any })}
          />
          <NumberField
            label={t("paint.style.gap")}
            unit="mm"
            min={0.5}
            step={0.5}
            disabled={!hasSelection}
            value={selectedStyle.stroke.gapLength}
            onChange={(v) => onStyleChange({ stroke: { gapLength: v || 1 } as any })}
          />
        </div>
      )}
      {selectedStyle.stroke.mode === "dotted" && (
        <div className="fields compact">
          <NumberField
            label={t("paint.style.spacing")}
            unit="mm"
            min={0.5}
            step={0.5}
            disabled={!hasSelection}
            value={selectedStyle.stroke.dotSpacing}
            onChange={(v) => onStyleChange({ stroke: { dotSpacing: v || 1 } as any })}
          />
          <NumberField
            label={t("paint.size")}
            unit="mm"
            min={0.2}
            step={0.2}
            disabled={!hasSelection}
            value={selectedStyle.stroke.dotSize}
            onChange={(v) => onStyleChange({ stroke: { dotSize: v || 0.5 } as any })}
          />
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
        <FillOptions
          value={selectedStyle.fill}
          disabled={!hasSelection}
          onChange={(patch) => onStyleChange({ fill: patch as any })}
        />
      )}
    </div>
  );
}
