import { useState } from "react";
import type { Calibration } from "../../../api";
import EditorIcon from "../../../components/editor/EditorIcon";
import { useI18n } from "../../../i18n";
import { PAPER_FORMATS } from "../paperLayout";
import CalibrationMap from "./CalibrationMap";
import type { CalibrationPreviewControls } from "./CalibrationPreview";
export default function CompactCalibrationPreview({
  cal,
  controls: c,
}: {
  cal: Calibration;
  controls: CalibrationPreviewControls;
}) {
  const { t } = useI18n(),
    [panel, setPanel] = useState<"view" | "paper" | "job">("view");
  return (
    <section className="card paper-live-panel compact-calibration-preview">
      <div
        className="calibration-preview-tabs"
        role="tablist"
        aria-label={t("paper.liveView")}
      >
        {(["view", "paper", "job"] as const).map((id) => (
          <button
            type="button"
            key={id}
            role="tab"
            aria-selected={panel === id}
            onClick={() => setPanel(id)}
          >
            <EditorIcon
              name={
                id === "view" ? "select" : id === "paper" ? "pages" : "preview"
              }
              size={15}
            />
            {t(`calibration.preview.${id}`)}
          </button>
        ))}
      </div>
      {panel === "paper" && (
        <div className="calibration-map-options">
          <label>
            {t("paper.formatCompare")}
            <select
              aria-label={t("paper.formatCompare")}
              value={c.formatId ?? ""}
              onChange={(e) =>
                c.setFormatId((e.target.value as typeof c.formatId) || null)
              }
            >
              <option value="">{t("paper.formatOff")}</option>
              {PAPER_FORMATS.map((format) => (
                <option key={format.id} value={format.id}>
                  {format.id}
                </option>
              ))}
            </select>
          </label>
          {c.currentFormat && (
            <button
              type="button"
              title={t("paper.landscape")}
              onClick={() => c.setFormatLandscape((value) => !value)}
            >
              <EditorIcon name="redo" size={15} />
            </button>
          )}
        </div>
      )}
      {panel === "job" && (
        <div className="calibration-map-options">
          <label>
            {t("paper.gcodePreview")}
            <select
              value={c.previewJob}
              onChange={(e) => c.setPreviewJob(e.target.value)}
            >
              <option value="">{t("paper.chooseJob")}</option>
              {c.jobs.map((job) => (
                <option key={job.filename} value={job.filename}>
                  {job.filename}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            aria-label={t("common.refresh")}
            title={t("common.refresh")}
            onClick={c.refreshJobs}
          >
            ↻
          </button>
        </div>
      )}
      <CalibrationMap cal={cal} controls={c} />
      <div className="calibration-map-status">
        {c.homed && c.pos && <span className={c.pos.z >= cal.pen_up_z - 0.001 ? "pen-state up" : "pen-state down"}
          title={t("paper.defaultPenUp")}>{t(c.pos.z >= cal.pen_up_z - 0.001 ? "paper.penUpStrong" : "paper.penDownStrong")}</span>}
        <span title={t("paper.drawingArea")}>
          {c.currentPlot.w.toFixed(0)} × {c.currentPlot.h.toFixed(0)} mm
        </span>
        <span>
          {c.homed && c.pos
            ? `X ${c.pos.x.toFixed(1)} · Y ${c.pos.y.toFixed(1)} · Z ${c.pos.z.toFixed(2)}`
            : t("paper.posUnknown")}
        </span>
        <button
          type="button"
          aria-label={t("paper.clickMove")}
          title={t(
            c.clickMove ? "paper.clickMoveEnabled" : "paper.clickMoveDisabled",
          )}
          aria-pressed={c.clickMove && !c.positionsOpen}
          disabled={
            !c.homed || !c.canMove || c.positionsOpen || c.positions.busy
          }
          onClick={() => c.setClickMove(!c.clickMove)}
        >
          <EditorIcon name="select" size={15} />
        </button>
      </div>
    </section>
  );
}
