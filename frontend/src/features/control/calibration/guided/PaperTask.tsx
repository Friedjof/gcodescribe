import { useState } from "react";
import Segmented from "../../../../components/Segmented";
import EditorIcon from "../../../../components/editor/EditorIcon";
import EditorMenu from "../../../../components/editor/EditorMenu";
import { CORNERS, XY_STEPS } from "../steps";
import { useI18n } from "../../../../i18n";
import type { GuidedCalibrationTaskProps as Props } from "./types";
export default function PaperTask({ controls: c }: Props) {
  const { t } = useI18n(),
    [method, setMethod] = useState<"map" | "head">("map"),
    [corner, setCorner] = useState("tl");
  return (
    <div className="calibration-task">
      <p>{t("paper.step3Hint")}</p>
      <div className="calibration-task-tabs">
        <button
          type="button"
          aria-pressed={method === "map"}
          onClick={() => setMethod("map")}
        >
          {t("calibration.dragPaper")}
        </button>
        <button
          type="button"
          aria-pressed={method === "head"}
          onClick={() => setMethod("head")}
        >
          {t("paper.manualCapture")}
        </button>
      </div>
      {method === "map" ? (
        <>
          <p className="calibration-task-note">{t("paper.dragCornerHint")}</p>
          <div className="calibration-corner-list">
            {CORNERS.map((item) => {
              const point = c.cal!.paper_corners?.[item.id];
              return (
                <div key={item.id}>
                  <span>{t(item.labelKey)}</span>
                  <strong>
                    {point
                      ? `${point[0].toFixed(1)} / ${point[1].toFixed(1)}`
                      : "—"}
                  </strong>
                  <button
                    type="button"
                    className="ghost icon-button"
                    disabled={!c.canEdit || !point}
                    aria-label={`${t("paper.resetCorners")}: ${t(item.labelKey)}`}
                    onClick={() => c.clearCorner(item.id)}
                  >
                    <EditorIcon name="close" size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <Segmented
            value={c.xyStep}
            onChange={c.setXyStep}
            options={XY_STEPS.map((value) => ({ value, label: String(value) }))}
            suffix={<em>mm</em>}
          />
          <div className="calibration-capture-layout">
            <div className="jog compact">
              <div className="xy">
                <button
                  type="button"
                  disabled={!c.canMove}
                  onClick={() => c.jogXY(0, 1)}
                  className="up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={!c.canMove}
                  onClick={() => c.jogXY(-1, 0)}
                  className="left"
                >
                  ←
                </button>
                <span className="pad-center" />
                <button
                  type="button"
                  disabled={!c.canMove}
                  onClick={() => c.jogXY(1, 0)}
                  className="right"
                >
                  →
                </button>
                <button
                  type="button"
                  disabled={!c.canMove}
                  onClick={() => c.jogXY(0, -1)}
                  className="down"
                >
                  ↓
                </button>
              </div>
            </div>
            <div className="calibration-capture-choice">
              <select
                aria-label={t("calibration.corner")}
                value={corner}
                onChange={(e) => setCorner(e.target.value)}
              >
                {CORNERS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {t(item.labelKey)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!c.canMove || !c.homed}
                onClick={() => c.capture(corner)}
              >
                {t("calibration.captureCorner")}
              </button>
              <button
                type="button"
                disabled={
                  !c.canMove || !c.homed || !c.cal!.paper_corners?.[corner]
                }
                onClick={() => c.driveToCorner(corner, "paper")}
              >
                {t("paper.driveCorner")}
              </button>
            </div>
          </div>
        </>
      )}
      <div className="calibration-task-actions">
        <EditorMenu
          label={t("paint.moreActions")}
          active={c.visible}
          items={[
            {
              id: "reset",
              label: t("paper.resetCorners"),
              disabled: !c.canEdit || c.capturedCount === 0,
              action: c.resetCorners,
            },
            {
              id: "existing",
              label: t("paper.useCurrentArea"),
              action: () => c.setActive("apply"),
            },
          ]}
        >
          <EditorIcon name="more" size={17} />
        </EditorMenu>
        <button
          type="button"
          className="primary"
          disabled={!c.rect || !c.canEdit}
          onClick={() => void c.adoptPaperArea(true)}
        >
          {t("paper.usePaperArea")} →
        </button>
      </div>
    </div>
  );
}
