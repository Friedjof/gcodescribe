import { useI18n } from "../../../i18n";
import type { CalibrationController } from "./useCalibrationController";
import { targetQuery } from "../../../api/calibrationTarget";
import { CORNERS } from "./steps";

type Controls = Pick<CalibrationController,
  "homed" | "heightSaved" | "currentBase" | "margin" | "setMargin" | "marginValid" | "apply" |
  "canMove" | "canEdit" | "plotFrame" | "plotCornerTest" | "target" | "rect" | "adoptPaperArea" | "driveToCorner">;

export default function ReviewStep({ controls }: { controls: Controls }) {
  const { t } = useI18n();
  const { homed, heightSaved, currentBase, margin, setMargin, marginValid, apply, canMove, canEdit, plotFrame, target, rect, adoptPaperArea, driveToCorner } = controls;
  return (
    <>
      <p className="muted">{t("paper.reviewHint")}</p>
      <p className="muted">{t("paper.marginHint")}</p>
      {(!homed || !heightSaved) && <p className="calibration-group-hint">{t("paper.frameNeedsSetup")}</p>}
      <div className="apply-row">
        <label className="field">
          <span>{t("paper.margin")}</span>
          <div className="input-unit">
            <input
              type="number" disabled={!canEdit} aria-label={t("paper.margin")} step="1" min="0" max={(Math.min(currentBase.w, currentBase.h) - 5) / 2} value={margin}
              onChange={(e) => setMargin(parseFloat(e.target.value) || 0)}
            />
            <em>mm</em>
          </div>
        </label>
        <button className="primary" disabled={!marginValid || !canEdit} onClick={apply}>
          {t("paper.applyMargin")}
        </button>
        <button
          disabled={!canMove || !homed || !heightSaved}
          onClick={plotFrame}
          title={t("paper.testFrameTip")}
        >
          {t("paper.testFrame")}
        </button>
        <a className="btn-link" href={`/api/calibration/export${targetQuery(target)}`} download>
          {t("common.exportXml")}
        </a>
        <button disabled={!canMove || !homed || !heightSaved} onClick={controls.plotCornerTest}
          title={t("paper.testCornersHint")}>{t("paper.testCorners")}</button>
      </div>
      <p className="calibration-task-note">{t("paper.testCornersHint")}</p>
      <button type="button" className="ghost" disabled={!rect || !canEdit} onClick={() => { void adoptPaperArea(); }}
        style={{ marginTop: 10 }}>{t("paper.fromCorners")}</button>
      <div className="field-group" style={{ marginTop: 14 }}>
        <h3>{t("paper.driveToPlotCorners")}</h3>
        <p className="muted" style={{ margin: "0 0 8px" }}>
          {t("paper.driveNote")}
        </p>
        <div className="save-row">
          {CORNERS.map((c) => (
            <button
              key={c.id}
              disabled={!canMove || !homed}
              onClick={() => driveToCorner(c.id, "plot")}
            >
              {t(c.labelKey)}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
