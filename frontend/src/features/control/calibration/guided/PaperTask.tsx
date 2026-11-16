import { useState } from "react";
import Segmented from "../../../../components/Segmented";
import EditorIcon from "../../../../components/editor/EditorIcon";
import EditorMenu from "../../../../components/editor/EditorMenu";
import XYJogPad from "../XYJogPad";
import { CORNERS, XY_STEPS } from "../steps";
import { useI18n } from "../../../../i18n";
import type { GuidedCalibrationTaskProps as Props } from "./types";
export default function PaperTask({ controls: c }: Props) {
  const { t } = useI18n(),
    [corner, setCorner] = useState("tl");
  return (
    <div className="calibration-task">
      <p>{t("paper.step3Hint")}</p>
      <span className="calibration-task-note">{t("paper.xyStep")}</span>
      <Segmented
        value={c.xyStep}
        onChange={c.setXyStep}
        options={XY_STEPS.map((value) => ({ value, label: String(value) }))}
        suffix={<em>mm</em>}
      />
      <div className="calibration-capture-layout">
        <XYJogPad controls={c} />
        <div className="calibration-capture-choice">
          <select
            aria-label={t("calibration.corner")}
            value={corner}
            onChange={(e) => setCorner(e.target.value)}
          >
            {CORNERS.map((item) => (
              <option key={item.id} value={item.id}>
                {t(item.labelKey)}
                {c.cal!.paper_corners?.[item.id] ? " ✓" : ""}
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
            disabled={!c.canMove || !c.homed || !c.cal!.paper_corners?.[corner]}
            onClick={() => c.driveToCorner(corner, "paper")}
          >
            {t("paper.driveCorner")}
          </button>
        </div>
      </div>
      <div className="calibration-selected-corner">
        <span>{t(CORNERS.find((item) => item.id === corner)!.labelKey)}</span>
        <strong>
          {c
            .cal!.paper_corners?.[corner]?.map((value) => value.toFixed(1))
            .join(" / ") ?? "—"}{" "}
          mm
        </strong>
        <button
          type="button"
          className="ghost icon-button"
          disabled={!c.canEdit || !c.cal!.paper_corners?.[corner]}
          aria-label={t("paper.resetCorners")}
          onClick={() => c.clearCorner(corner)}
        >
          <EditorIcon name="close" size={14} />
        </button>
      </div>
      <p className="calibration-task-note">{t("paper.dragCornerHint")}</p>

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
          {t("paper.usePaperArea")}
        </button>
      </div>
    </div>
  );
}
