import { useI18n } from "../../../i18n";
import type { CalibrationController } from "./useCalibrationController";
import { CORNERS } from "./steps";

type Controls = Pick<CalibrationController,
  "homed" | "heightSaved" | "currentBase" | "margin" | "setMargin" | "marginValid" | "apply" |
  "canMove" | "plotFrame" | "projectId" | "rect" | "adoptPaperArea" | "fail" | "driveToCorner">;

export default function ReviewStep({ controls }: { controls: Controls }) {
  const { t } = useI18n();
  const { homed, heightSaved, currentBase, margin, setMargin, marginValid, apply, canMove, plotFrame, projectId, rect, adoptPaperArea, fail, driveToCorner } = controls;
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
              type="number" aria-label={t("paper.margin")} step="1" min="0" max={(Math.min(currentBase.w, currentBase.h) - 5) / 2} value={margin}
              onChange={(e) => setMargin(parseFloat(e.target.value) || 0)}
            />
            <em>mm</em>
          </div>
        </label>
        <button className="primary" disabled={!marginValid} onClick={apply}>
          {t("paper.applyMargin")}
        </button>
        <button
          disabled={!canMove || !homed || !heightSaved}
          onClick={plotFrame}
          title={t("paper.testFrameTip")}
        >
          {t("paper.testFrame")}
        </button>
        <a className="btn-link" href={`/api/calibration/export${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`} download>
          {t("common.exportXml")}
        </a>
      </div>
      <button type="button" className="ghost" disabled={!rect} onClick={() => { adoptPaperArea().catch(fail); }}
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
