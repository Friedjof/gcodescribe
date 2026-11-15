import { useI18n } from "../../../i18n";
import type { CalibrationController } from "./useCalibrationController";
import type { Calibration } from "../../../api";
import CommittedNumberField from "../../../components/CommittedNumberField";

type Controls = Pick<CalibrationController,
  "homed" | "setActive" | "canMove" | "homeAll" | "saveBedDimension">;

export default function HomeStep({ cal, controls }: { cal: Calibration; controls: Controls }) {
  const { t } = useI18n();
  const { homed, setActive, canMove, homeAll, saveBedDimension } = controls;
  return (
    <>
      <p className="muted">{t("paper.step1Hint")}</p>
      {homed && <>
        <p className="calibration-check">✓ {t("paper.homed")}</p>
        <button className="primary big" onClick={() => setActive("pen")}>{t("paper.continueSetup")}</button>
      </>}
      <button className={homed ? "ghost" : "primary big"} disabled={!canMove} onClick={homeAll}>
        {t("paper.homeXYZ")}
      </button>
      <details className="collapsible" style={{ marginTop: 14 }}>
        <summary className="muted">{t("paper.bedSize")}</summary>
        <p className="muted" style={{ margin: "6px 0 8px" }}>
          {t("paper.bedSizeHint")}
        </p>
        <div className="bed-size-row">
          <CommittedNumberField label={t("paper.bedWidth")} value={cal.bed_width} min={10} step={1}
            onChange={(value) => saveBedDimension("bed_width", value)} />
          <CommittedNumberField label={t("paper.bedHeight")} value={cal.bed_height} min={10} step={1}
            onChange={(value) => saveBedDimension("bed_height", value)} />
        </div>
      </details>
    </>
  );
}
