import { useI18n } from "../../i18n";
import Modal from "../Modal";
import {
  STABILIZATION_PRESETS,
  type StabilizationParams,
  type StabilizationPreset,
} from "../../fontEditor/stabilization";

const PRESETS: StabilizationPreset[] = ["off", "light", "medium", "strong"];

const ADVANCED: {
  key: keyof Omit<StabilizationParams, "preset" | "closeStrokeEnd">;
  labelKey: string;
  min: number;
  max: number;
  step: number;
}[] = [
  { key: "sigma", labelKey: "fontEditor.stabSigma", min: 0, max: 5, step: 0.1 },
  { key: "mass", labelKey: "fontEditor.stabMass", min: 0, max: 6, step: 0.1 },
  { key: "drag", labelKey: "fontEditor.stabDrag", min: 0, max: 0.95, step: 0.05 },
  { key: "ignoreStartEvents", labelKey: "fontEditor.stabIgnoreStart", min: 0, max: 10, step: 1 },
  { key: "simplifyTolerance", labelKey: "fontEditor.stabSimplify", min: 0, max: 20, step: 0.5 },
];

export default function StabilizationPanel({
  params,
  onChange,
  onReprocess,
  hasStrokes,
  onClose,
}: {
  params: StabilizationParams;
  onChange: (params: StabilizationParams) => void;
  onReprocess: () => void;
  hasStrokes: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();

  const setField = (key: keyof StabilizationParams, value: number | boolean) =>
    onChange({ ...params, [key]: value });

  return (
    <Modal title={t("fontEditor.stabilization")} onClose={onClose} className="fe-stab-modal">
      <div className="fe-stab">
        <p className="muted">{t("fontEditor.stabHint")}</p>

        <div className="fe-stab-presets">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              className={params.preset === preset ? "primary" : "ghost"}
              onClick={() => onChange(STABILIZATION_PRESETS[preset])}
            >
              {t(`fontEditor.preset_${preset}`)}
            </button>
          ))}
        </div>

        <div className="fe-stab-advanced">
          {ADVANCED.map(({ key, labelKey, min, max, step }) => (
            <label key={key} className="fe-stab-row">
              <span>{t(labelKey)}</span>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={params[key]}
                onChange={(e) => setField(key, Number(e.target.value))}
              />
              <span className="fe-stab-value">{params[key]}</span>
            </label>
          ))}
          <label className="fe-stab-row fe-stab-check">
            <input
              type="checkbox"
              checked={params.closeStrokeEnd}
              onChange={(e) => setField("closeStrokeEnd", e.target.checked)}
            />
            <span>{t("fontEditor.stabCloseEnd")}</span>
          </label>
        </div>

        <div className="fe-stab-foot">
          <button className="ghost" onClick={onReprocess} disabled={!hasStrokes}>
            {t("fontEditor.stabReprocess")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
