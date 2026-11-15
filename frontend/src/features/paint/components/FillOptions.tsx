import NumberField from "../../../components/NumberField";
import { type FillMode, type FillStyle } from "../lib/styling";
import { useI18n } from "../../../i18n";

export interface FillOptionsProps {
  value: FillStyle;
  onChange: (patch: Partial<FillStyle>) => void;
  disabled?: boolean;
}

/**
 * Pattern / angle / spacing controls for a fill style. Shared by the object
 * style panel (applies to the selected object) and the fill-tool context panel
 * (drives newly created bucket/area fills).
 */
export function FillOptions({ value, onChange, disabled = false }: FillOptionsProps) {
  const { t } = useI18n();
  const isDots = value.mode === "dotted-fill";
  return (
    <div className="fields compact">
      <label className="field">
        {t("paint.style.pattern")}
        <select
          disabled={disabled}
          value={value.mode}
          onChange={(e) => onChange({ mode: e.target.value as FillMode })}
        >
          <option value="hatch">{t("paint.image.hatch")}</option>
          <option value="dashed-hatch">{t("paint.style.dashedHatch")}</option>
          <option value="crosshatch">{t("paint.style.crosshatch")}</option>
          <option value="chaos">{t("paint.style.chaos")}</option>
          <option value="dotted-fill">{t("paint.image.dots")}</option>
        </select>
      </label>
      {!isDots && (
        <NumberField
          label={t("paint.style.angle")}
          unit="°"
          step={5}
          disabled={disabled}
          value={value.angle}
          onChange={(v) => onChange({ angle: v || 0 })}
        />
      )}
      <NumberField
        label={t("paint.style.spacing")}
        unit="mm"
        min={0.5}
        step={0.5}
        disabled={disabled}
        value={isDots ? value.dotSpacing : value.spacing}
        onChange={(v) =>
          onChange(isDots ? { dotSpacing: v || 1 } : { spacing: v || 1 })
        }
      />
    </div>
  );
}
