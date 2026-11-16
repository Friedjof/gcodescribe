import CommittedNumberField from "../../../../components/CommittedNumberField";
import EditorIcon from "../../../../components/editor/EditorIcon";
import EditorMenu from "../../../../components/editor/EditorMenu";
import { CORNERS } from "../steps";
import { useI18n } from "../../../../i18n";
import type { GuidedCalibrationTaskProps as Props } from "./types";
export default function ReviewTask({ controls: c }: Props) {
  const { t } = useI18n(),
    cal = c.cal!;
  return (
    <div className="calibration-task">
      <p>{t("paper.reviewHint")}</p>
      <dl className="calibration-summary">
        <div>
          <dt>{t("paper.drawingArea")}</dt>
          <dd>
            {cal.plot_width.toFixed(1)} × {cal.plot_height.toFixed(1)} mm
          </dd>
        </div>
        <div>
          <dt>{t("calibrate.penDownZ")}</dt>
          <dd>{cal.pen_down_z.toFixed(2)} mm</dd>
        </div>
        <div>
          <dt>{t("calibrate.penUpZ")}</dt>
          <dd>{cal.pen_up_z.toFixed(2)} mm</dd>
        </div>
      </dl>
      <div className="calibration-margin-row">
        <CommittedNumberField
          label={t("paper.margin")}
          value={c.margin}
          min={0}
          max={(Math.min(c.currentBase.w, c.currentBase.h) - 5) / 2}
          disabled={!c.canEdit}
          onChange={c.setMargin}
        />
        <button
          type="button"
          className="primary"
          disabled={!c.canEdit || !c.marginValid}
          onClick={c.apply}
        >
          {t("paper.applyMargin")}
        </button>
      </div>
      <p className="calibration-task-note">{t("paper.marginHint")}</p>
      <div className="calibration-task-actions">
        <EditorMenu
          label={t("paper.driveToPlotCorners")}
          active={c.visible}
          items={CORNERS.map((item) => ({
            id: item.id,
            label: t(item.labelKey),
            disabled: !c.canMove || !c.homed,
            action: () => c.driveToCorner(item.id, "plot"),
          }))}
        />
        <button
          type="button"
          disabled={!c.canMove || !c.homed || !c.heightSaved}
          onClick={c.plotFrame}
          title={t("paper.testFrameTip")}
        >
          <EditorIcon name="shape" size={16} />
          {t("paper.testFrame")}
        </button>
      </div>
    </div>
  );
}
