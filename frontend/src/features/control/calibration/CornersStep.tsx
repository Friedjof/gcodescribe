import { useI18n } from "../../../i18n";
import type { CalibrationController } from "./useCalibrationController";
import type { Calibration } from "../../../api";
import Segmented from "../../../components/Segmented";
import { CORNERS, XY_STEPS } from "./steps";

type Controls = Pick<CalibrationController,
  "clearCorner" | "xyStep" | "setXyStep" | "canMove" | "jogXY" | "kbd" | "testPen" | "homed" |
  "capture" | "driveToCorner" | "capturedCount" | "resetCorners" | "rect" | "adoptPaperArea" |
  "setActive" | "fail">;

export default function CornersStep({ cal, controls }: { cal: Calibration; controls: Controls }) {
  const { t } = useI18n();
  const { clearCorner, xyStep, setXyStep, canMove, jogXY, kbd, testPen, homed, capture, driveToCorner, capturedCount, resetCorners, rect, adoptPaperArea, setActive, fail } = controls;
  return (
    <>
      <p className="muted">{t("paper.step3Hint")}</p>
      <p className="calibration-group-hint">{t("paper.cornerMethods")}</p>
      {/* Corner chips */}
      <div className="corner-chips">
        {CORNERS.map((c) => {
          const cap = cal.paper_corners?.[c.id];
          return (
            <span
              key={c.id}
              className={`corner-chip ${cap ? "set" : ""}`}
            >
              {t(c.labelKey)}
              {cap
                ? ` ${cap[0].toFixed(0)},${cap[1].toFixed(0)}`
                : " —"}
              {cap && (
                <button
                  className="ghost tiny"
                  onClick={() => clearCorner(c.id)}
                  title={t("paper.resetCorners")}
                >✕</button>
              )}
            </span>
          );
        })}
      </div>

      <p className="muted" style={{ margin: "8px 0" }}>
        {t("paper.dragCornerHint")}
      </p>

      {/* Manual jog + capture — collapsed */}
      <details className="collapsible">
        <summary className="muted">{t("paper.manualCapture")}</summary>
        <div style={{ marginTop: 8 }}>
          <Segmented
            value={xyStep}
            onChange={setXyStep}
            options={XY_STEPS.map((st) => ({ value: st, label: st }))}
            suffix={<em className="muted">mm</em>}
          />
          <div className="jog compact">
            <div className="xy">
              <button disabled={!canMove} onClick={() => jogXY(0, 1)} className={"up" + kbd("up")}>↑</button>
              <button disabled={!canMove} onClick={() => jogXY(-1, 0)} className={"left" + kbd("left")}>←</button>
              <span className="pad-center" />
              <button disabled={!canMove} onClick={() => jogXY(1, 0)} className={"right" + kbd("right")}>→</button>
              <button disabled={!canMove} onClick={() => jogXY(0, -1)} className={"down" + kbd("down")}>↓</button>
            </div>
            <div className="z">
              <button disabled={!canMove} onClick={() => testPen(true)}>{t("paper.penDownShort")}</button>
              <button disabled={!canMove} onClick={() => testPen(false)}>{t("paper.penUpShort")}</button>
            </div>
          </div>
          <p className="muted kbd-hint">
            {t("common.keyboard")}: <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> {t("control.kbdMove")}
          </p>
          <div className="corner-grid">
            {CORNERS.map((c) => {
              const captured = cal.paper_corners?.[c.id];
              return (
                <div key={c.id} className={`corner ${captured ? "set" : ""}`}>
                  <button disabled={!canMove || !homed} onClick={() => capture(c.id)}>
                    {t(c.labelKey)}
                  </button>
                  {captured ? (
                    <span className="coords">
                      {captured[0].toFixed(1)} / {captured[1].toFixed(1)}
                      <button
                        className="ghost tiny"
                        disabled={!canMove}
                        title={t("paper.driveCorner")}
                        onClick={() => driveToCorner(c.id, "paper")}
                      >➜</button>
                    </span>
                  ) : (
                    <span className="coords muted">—</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </details>

      <div className="save-row" style={{ marginTop: 12 }}>
        {capturedCount > 0 && (
          <button className="ghost" onClick={resetCorners}>{t("paper.resetCorners")}</button>
        )}
        <button className="primary" disabled={!rect} onClick={() => {
          adoptPaperArea().then(() => setActive("apply")).catch(fail);
        }}>
          {t("paper.usePaperArea")}
        </button>
        <button onClick={() => setActive("apply")}>{t("paper.useCurrentArea")}</button>
      </div>
    </>
  );
}
