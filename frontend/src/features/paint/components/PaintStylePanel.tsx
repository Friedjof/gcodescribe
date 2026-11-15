import CommittedNumberField from "../../../components/CommittedNumberField";
import Segmented from "../../../components/Segmented";
import { type StrokeMode, type VectorStyle } from "../lib/styling";
import { useI18n } from "../../../i18n";
import { FillOptions } from "./FillOptions";

export interface PaintStylePanelProps {
  hasSelection: boolean;
  selectedStyle: VectorStyle;
  onStyleChange: (patch: Partial<VectorStyle>) => void;
}

export function PaintStylePanel({
  hasSelection,
  selectedStyle,
  onStyleChange,
}: PaintStylePanelProps) {
  const { t } = useI18n();

  return (
    <div className="paint-style-panel">
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
          <CommittedNumberField decimalInput
            label={t("paint.style.dash")}
            unit="mm"
            min={0.5}
            step={0.5}
            disabled={!hasSelection}
            value={selectedStyle.stroke.dashLength}
            onChange={(v) => onStyleChange({ stroke: { dashLength: v || 1 } as any })}
          />
          <CommittedNumberField decimalInput
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
          <CommittedNumberField decimalInput
            label={t("paint.style.spacing")}
            unit="mm"
            min={0.5}
            step={0.5}
            disabled={!hasSelection}
            value={selectedStyle.stroke.dotSpacing}
            onChange={(v) => onStyleChange({ stroke: { dotSpacing: v || 1 } as any })}
          />
          <CommittedNumberField decimalInput
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
