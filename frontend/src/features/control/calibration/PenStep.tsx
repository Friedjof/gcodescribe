import { useI18n } from "../../../i18n";
import type { CalibrationController } from "./useCalibrationController";
import type { Calibration } from "../../../api";
import CommittedNumberField from "../../../components/CommittedNumberField";
import Segmented from "../../../components/Segmented";
import { Z_STEPS } from "./steps";

type Controls = Pick<CalibrationController,
  "heightSaved" | "homed" | "canMove" | "homeAll" | "pos" | "zStep" | "setZStep" | "kbd" |
  "jogZ" | "savePenHeight" | "testPen" | "setPenHeightValue" | "setActive">;

export default function PenStep({ cal, controls }: { cal: Calibration; controls: Controls }) {
  const { t } = useI18n();
  const { heightSaved, homed, canMove, homeAll, pos, zStep, setZStep, kbd, jogZ, savePenHeight, testPen, setPenHeightValue, setActive } = controls;
  return (
    <>
      {heightSaved && (
        <div className="banner ok" style={{ marginTop: 0, marginBottom: 12 }}>
          {t("paper.heightSet", {
            down: cal.pen_down_z.toFixed(2),
            up: cal.pen_up_z.toFixed(2),
          })}
        </div>
      )}

      {!homed && (
        <div className="banner warn-inline" style={{ marginBottom: 10 }}>
          <span>{t("paper.needHome")}</span>
          <button className="primary" disabled={!canMove} onClick={homeAll}>
            {t("paper.homeXYZ")}
          </button>
        </div>
      )}

      <p className="muted">{t("paper.step2Hint")}</p>
      <details className="collapsible" open={!heightSaved}>
        <summary>{t("paper.penInstructions")}</summary>
        <ol className="calibration-instructions">
          <li>{t("paper.penContactInstruction")}</li>
          <li>{t("paper.penLiftInstruction")}</li>
        </ol>
      </details>
      <div className="z-panel">
        <div className="z-readout">
          <span className="muted">{t("paper.currentZ")}</span>
          <strong>{homed && pos ? `${pos.z.toFixed(2)} mm` : t("paper.notHomed")}</strong>
        </div>
        <Segmented
          value={zStep}
          onChange={setZStep}
          options={Z_STEPS.map((st) => ({ value: st, label: st }))}
        />
        <div className="z-buttons">
          <button
            className={"big" + kbd("raise") + kbd("up")}
            disabled={!canMove || !homed}
            onClick={() => jogZ(1)}
          >
            Z + {zStep}
          </button>
          <button
            className={"big" + kbd("lower") + kbd("down")}
            disabled={!canMove || !homed}
            onClick={() => jogZ(-1)}
          >
            Z − {zStep}
          </button>
        </div>
        {homed && (
          <p className="muted kbd-hint">
            {t("common.keyboard")}: <kbd>↑</kbd><kbd>↓</kbd> / <kbd>{t("common.pageUpKey")}</kbd><kbd>{t("common.pageDownKey")}</kbd> {t("paper.kbdZ")}
          </p>
        )}
        <div className="save-row">
          <button disabled={!canMove || !homed} onClick={() => savePenHeight("down")}>
            {t("paper.saveAsDown")}
          </button>
          <button disabled={!canMove || !homed} onClick={() => savePenHeight("up")}>
            {t("paper.saveAsUp")}
          </button>
        </div>
        <div className="save-row" style={{ marginTop: 4 }}>
          <button
            disabled={!canMove || !homed || !heightSaved}
            onClick={() => testPen(true)}
          >
            {t("paper.testLower")}
          </button>
          <button
            disabled={!canMove || !homed || !heightSaved}
            onClick={() => testPen(false)}
          >
            {t("paper.testRaise")}
          </button>
        </div>
      </div>

      {/* Manual numeric inputs, collapsed */}
      <details className="collapsible" style={{ marginTop: 12 }}>
        <summary className="muted">{t("paper.manualValues")}</summary>
        <div className="height-fields" style={{ marginTop: 8 }}>
          <CommittedNumberField label={t("calibrate.penDownZ")} value={cal.pen_down_z} min={0} max={cal.z_max} step={0.05}
            onChange={(value) => setPenHeightValue("down", value)} />
          <CommittedNumberField label={t("calibrate.penUpZ")} value={cal.pen_up_z} min={0} max={cal.z_max} step={0.05}
            onChange={(value) => setPenHeightValue("up", value)} />
        </div>
      </details>

      <button
        className="primary"
        style={{ marginTop: 14 }}
        disabled={!heightSaved}
        onClick={() => setActive("corners")}
      >
        {t("paper.toCorners")}
      </button>
      <p className="muted">{t("paper.positionDefaultsHint")}</p>
      <button className="ghost" onClick={() => setActive("positions")}>{t("paper.positions.next")}</button>
    </>
  );
}
