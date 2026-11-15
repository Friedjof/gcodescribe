import { useI18n } from "../../../i18n";
import type { CalibrationController } from "./useCalibrationController";
import Segmented from "../../../components/Segmented";
import { XY_STEPS } from "./steps";

type Controls = Pick<CalibrationController,
  "obsCaptureActive" | "obsCaptureCorner1" | "obstacles" | "deleteObstacle" | "xyStep" |
  "setXyStep" | "canMove" | "jogXY" | "kbd" | "homed" | "pos" | "startObstacleCapture" |
  "captureObstacleCorner" | "cancelObstacleCapture" | "setActive">;

export default function ObstaclesStep({ controls }: { controls: Controls }) {
  const { t } = useI18n();
  const { obsCaptureActive, obsCaptureCorner1, obstacles, deleteObstacle, xyStep, setXyStep, canMove, jogXY, kbd, homed, pos, startObstacleCapture, captureObstacleCorner, cancelObstacleCapture, setActive } = controls;
  return (
    <>
      <p className="muted">{t("paper.step4ObstaclesHint")}</p>

      {!obsCaptureActive ? (
        <>
          <button
            className="primary"
            onClick={startObstacleCapture}
            style={{ marginBottom: 10 }}
          >
            + {t("paper.obsStartCapture")}
          </button>
          {obstacles.length === 0 && (
            <p className="muted" style={{ fontSize: "0.85em" }}>
              {t("paper.noObstacles")}
            </p>
          )}
          {obstacles.length > 0 && (
            <div className="obstacle-list">
              {obstacles.map((obs, i) => (
                <div key={obs.id} className="obstacle-item">
                  <span className="obstacle-idx">{i + 1}</span>
                  <span className="obs-coords muted">
                    X{obs.x.toFixed(0)} Y{obs.y.toFixed(0)} · {obs.w.toFixed(0)}×{obs.h.toFixed(0)} mm
                  </span>
                  <button
                    className="ghost tiny danger"
                    onClick={() => deleteObstacle(obs.id)}
                    title={t("paper.deleteObstacle")}
                  >🗑</button>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="obs-capture-panel">
          <p className="muted">
            {t(obsCaptureCorner1 ? "paper.obsHintCorner2" : "paper.obsHintCorner1")}
          </p>
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
          </div>
          <p className="muted kbd-hint">
            {t("common.keyboard")}: <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> {t("control.kbdMove")}
          </p>
          {obsCaptureCorner1 && (
            <div className="banner ok" style={{ marginTop: 8, marginBottom: 8 }}>
              {t("paper.obsCorner1Set", {
                x: obsCaptureCorner1[0].toFixed(1),
                y: obsCaptureCorner1[1].toFixed(1),
              })}
            </div>
          )}
          <div className="save-row" style={{ marginTop: 12 }}>
            {!obsCaptureCorner1 ? (
              <button
                className="primary"
                disabled={!homed || !pos}
                onClick={captureObstacleCorner}
              >
                {t("paper.obsSetCorner1")}
              </button>
            ) : (
              <button
                className="primary"
                disabled={!homed || !pos}
                onClick={captureObstacleCorner}
              >
                {t("paper.obsSetCorner2")}
              </button>
            )}
            <button
              className="ghost"
              onClick={cancelObstacleCapture}
            >
              {t("paper.obsCancelCapture")}
            </button>
          </div>
        </div>
      )}
      <div className="save-row" style={{ marginTop: 14 }}>
        <button className="primary" onClick={() => setActive("apply")}>
          {t("common.next")} →
        </button>
      </div>
    </>
  );
}
