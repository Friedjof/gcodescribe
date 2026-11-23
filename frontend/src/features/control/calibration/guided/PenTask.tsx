import { useState } from "react";
import CommittedNumberField from "../../../../components/CommittedNumberField";
import Segmented from "../../../../components/Segmented";
import EditorIcon from "../../../../components/editor/EditorIcon";
import EditorMenu from "../../../../components/editor/EditorMenu";
import { Z_STEPS } from "../steps";
import { useI18n } from "../../../../i18n";
import type { GuidedCalibrationTaskProps as Props } from "./types";
export default function PenTask({ controls: c }: Props) {
  const { t } = useI18n(),
    cal = c.cal!,
    [tab, setTab] = useState<"move" | "values">("move"),
    [which, setWhich] = useState<"down" | "up">("down");
  return (
    <div className="calibration-task">
      <p>{t("paper.penLocation", { x: cal.calibration_x.toFixed(1), y: cal.calibration_y.toFixed(1) })}</p>
      <button type="button" disabled={!c.canMove || !c.homed} onClick={c.preparePen}>{t("paper.preparePen")}</button>
      <p title={t("paper.step2Hint")}>{t("calibration.penHint")}</p>
      <div className="calibration-task-tabs">
        <button
          type="button"
          aria-pressed={tab === "move"}
          onClick={() => setTab("move")}
        >
          {t("calibration.penMove")}
        </button>
        <button
          type="button"
          aria-pressed={tab === "values"}
          onClick={() => setTab("values")}
        >
          {t("paper.manualValues")}
        </button>
      </div>
      {tab === "move" ? (
        <>
          <Segmented
            value={which}
            onChange={setWhich}
            options={[
              { value: "down", label: t("calibration.contact") },
              { value: "up", label: t("calibration.lift") },
            ]}
          />
          <p className="calibration-task-note">
            {t(
              which === "down"
                ? "paper.penContactInstruction"
                : "paper.penLiftInstruction",
            )}
          </p>
          <div className="calibration-z-heading">
            <span>Z</span>
            <strong>
              {c.homed && c.pos
                ? `${c.pos.z.toFixed(2)} mm`
                : t("paper.notHomed")}
            </strong>
          </div>
          <Segmented
            value={c.zStep}
            onChange={c.setZStep}
            options={Z_STEPS.map((step) => ({
              value: step,
              label: String(step),
            }))}
            suffix={<em>mm</em>}
          />
          <div className="calibration-z-controls calibration-jog-scope" ref={c.jogScope} tabIndex={0} role="group" aria-label={t("paper.keyboardZ")} onClickCapture={() => c.jogScope.current?.focus({ preventScroll: true })}>
            <button
              type="button"
              disabled={!c.canMove || !c.homed || !c.atPenPosition}
              onClick={() => c.jogZ(1)}
            >

              ↑ Z + {c.zStep}
            </button>
            <button
              type="button"
              disabled={!c.canMove || !c.homed || !c.atPenPosition}
              onClick={() => c.jogZ(-1)}
            >

              ↓ Z − {c.zStep}
            </button>
          </div>
          <div className="calibration-save-height">
            <button
              type="button"
              disabled={!c.canMove || !c.homed || !c.atPenPosition}
              onClick={() =>
                void c.savePenHeight(which).then((saved) => {
                  if (saved && which === "down") setWhich("up");
                })
              }
            >
              <EditorIcon name="check" size={16} />
              {t(which === "down" ? "paper.saveAsDown" : "paper.saveAsUp")}
            </button>
            {!c.homed && (
              <button type="button" disabled={!c.canMove} onClick={c.homeAll}>
                {t("paper.homeXYZ")}
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="calibration-machine-fields">
          <CommittedNumberField
            label={t("calibrate.penDownZ")}
            value={cal.pen_down_z}
            min={0}
            max={cal.z_max}
            step={0.05}
            disabled={!c.canEdit}
            onChange={(value) => c.setPenHeightValue("down", value)}
          />
          <CommittedNumberField
            label={t("calibrate.penUpZ")}
            value={cal.pen_up_z}
            min={0}
            max={cal.z_max}
            step={0.05}
            disabled={!c.canEdit}
            onChange={(value) => c.setPenHeightValue("up", value)}
          />
        </div>
      )}
      <div className="calibration-task-actions">
        <span
          className="calibration-saved-height"
          title={t("paper.heightSet", {
            down: cal.pen_down_z.toFixed(2),
            up: cal.pen_up_z.toFixed(2),
          })}
        >
          ↓ {cal.pen_down_z.toFixed(2)} · ↑ {cal.pen_up_z.toFixed(2)} mm
        </span>
        <EditorMenu
          label={t("calibration.testPen")}
          active={c.visible}
          items={[
            {
              id: "down",
              label: t("paper.testLower"),
              disabled: !c.canMove || !c.homed || !c.atPenPosition || !c.heightSaved,
              action: () => c.testPen(true),
            },
            {
              id: "up",
              label: t("paper.testRaise"),
              disabled: !c.canMove || !c.homed || !c.atPenPosition || !c.heightSaved,
              action: () => c.testPen(false),
            },
          ]}
        />
        <button
          type="button"
          className="primary"
          disabled={!c.heightSaved}
          onClick={() => c.setActive("corners")}
        >
          {t("common.next")} →
        </button>
      </div>
    </div>
  );
}
