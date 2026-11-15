import { useI18n } from "../../../i18n";
import LiveView from "../LiveView";
import type { Calibration } from "../../../api";
import { PAPER_FORMATS } from "../paperLayout";
import { CORNERS } from "./steps";
import type { CalibrationController } from "./useCalibrationController";

type Controls = Pick<CalibrationController,
  "positionsOpen" | "clickMove" | "formatId" | "setFormatId" | "currentFormat" |
  "formatLandscape" | "setFormatLandscape" | "pos" | "rect" | "preview" | "positions" |
  "visible" | "homed" | "canMove" | "moveTo" | "active" | "handleDragCorner" |
  "handleDropCorner" | "obstacles" | "saveObstacles" | "currentPlot" | "cornerAngles" |
  "setClickMove" | "previewJob" | "setPreviewJob" | "jobs" | "refreshJobs">;

export default function CalibrationPreview({ cal, controls }: { cal: Calibration; controls: Controls }) {
  const { t } = useI18n();
  const { positionsOpen, clickMove, formatId, setFormatId, currentFormat, formatLandscape, setFormatLandscape, pos, rect, preview, positions, visible, homed, canMove, moveTo, active, handleDragCorner, handleDropCorner, obstacles, saveObstacles, currentPlot, cornerAngles, setClickMove, previewJob, setPreviewJob, jobs, refreshJobs } = controls;
  return (
    <section className="card paper-live-panel">
      <h2>{t("paper.liveView")}</h2>
      <p className="calibration-group-hint">{positionsOpen ? t("paper.positionMapHint") : clickMove ? t("paper.clickMoveEnabled") : t("paper.clickMoveDisabled")}</p>
      <div className="paper-format-controls" title={t("paper.formatPassive")}>
        <label className="field">{t("paper.formatCompare")}
          <select aria-label={t("paper.formatCompare")} value={formatId ?? ""}
            onChange={(event) => setFormatId(event.target.value as typeof formatId || null)}>
            <option value="">{t("paper.formatOff")}</option>
            {PAPER_FORMATS.map((format) => <option key={format.id} value={format.id}>{format.id}</option>)}
          </select>
        </label>
        {currentFormat && <button type="button" className="ghost paper-format-orientation"
            aria-pressed={formatLandscape} onClick={() => setFormatLandscape((value) => !value)}>
            {formatLandscape ? t("paper.landscape") : t("paper.portrait")} ↻
          </button>}
      </div>
      <LiveView
        cal={cal}
        position={pos}
        rect={rect}
        preview={preview}
        onMoveTo={positionsOpen
          ? positions.ready && !positions.busy ? (x, y) => positions.move({ x, y }) : undefined
          : visible && clickMove && homed && canMove ? moveTo : undefined}
        selectedPosition={positionsOpen ? positions.kind : null}
        target={positions.target}
        onDragCorner={active === "corners" ? handleDragCorner : undefined}
        onDropCorner={active === "corners" ? handleDropCorner : undefined}
        formatPreview={currentFormat ? { format: currentFormat, landscape: formatLandscape } : undefined}
        obstacles={obstacles}
        editingObstacles={active === "obstacles"}
        onObstaclesChange={saveObstacles}
      />
      <div className="paper-area-readout">
        <span>{t("paper.drawingArea")} {currentPlot.w.toFixed(1)} × {currentPlot.h.toFixed(1)} mm</span>
      </div>
      <div className="paper-angle-readout" aria-label={t("paper.cornerAngles")}>
        <strong>{t("paper.cornerAngles")}</strong>
        {cornerAngles ? CORNERS.map(({ id, labelKey }) => {
          const angle = cornerAngles[id];
          const right = Math.abs(angle - 90) <= 1;
          return <span key={id} className={right ? "right" : "skewed"}
            title={t(labelKey)}>{t(labelKey).split(" ")[0]} {angle.toFixed(1)}° {right ? "✓" : "!"}</span>;
        }) : <span className="muted">{t("paper.angleNeedCorners")}</span>}
      </div>
      <div className="legend">
        <span><i className="sw paper" /> {t("paper.legPaper")}</span>
        <span><i className="sw" style={{ background: "var(--muted)" }} /> {t("paper.legPlot")}</span>
        <span><i className="sw corner" /> {t("paper.legCorner")}</span>
        <span><i className="sw head" /> {t("paper.legPen")}</span>
        <span><i className="sw park" /> {t("paper.legPark")}</span>
        <span>
          <i className="sw calibration" /> C · {t("calibrate.groupCalibrationPosition")}
        </span>
        {obstacles.length > 0 && <span><i className="sw obstacle" /> {t("paper.legObstacle")}</span>}
        {preview && <span><i className="sw draw" /> {t("paper.legPreview")}</span>}
      </div>
      <div className="pos-readout">
        {homed && pos ? (
          <>
            <span>X <strong>{pos.x.toFixed(1)}</strong></span>
            <span>Y <strong>{pos.y.toFixed(1)}</strong></span>
            <span>Z <strong>{pos.z.toFixed(2)}</strong></span>
          </>
        ) : (
          <span className="muted">{t("paper.posUnknown")}</span>
        )}
        <label className={`switch-label ${positionsOpen ? "disabled" : ""}`}>
          <span className="muted">{t("paper.clickMove")}</span>
          <button
            className={`switch ${clickMove && !positionsOpen ? "on" : ""}`}
            disabled={!homed || positionsOpen || positions.busy}
            aria-label={t("paper.clickMove")}
            onClick={() => setClickMove(!clickMove)}
            aria-pressed={clickMove && !positionsOpen}
          >
            <i />
          </button>
        </label>
      </div>

      <div className="paper-preview">
        <label htmlFor="paper-preview-job">{t("paper.gcodePreview")}</label>
        <div className="preview-row">
          <select id="paper-preview-job" value={previewJob} onChange={(e) => setPreviewJob(e.target.value)}>
            <option value="">{t("paper.chooseJob")}</option>
            {jobs.map((j) => (
              <option key={j.filename} value={j.filename}>{j.filename}</option>
            ))}
          </select>
          <button className="ghost" onClick={refreshJobs}>⟳</button>
        </div>
        {preview?.truncated && <p className="muted">{t("paper.previewTruncated")}</p>}
      </div>
    </section>
  );
}
