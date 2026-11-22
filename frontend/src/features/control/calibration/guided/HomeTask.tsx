import CommittedNumberField from "../../../../components/CommittedNumberField";
import EditorIcon from "../../../../components/editor/EditorIcon";
import { useI18n } from "../../../../i18n";
import type { GuidedCalibrationTaskProps as Props } from "./types";
export default function HomeTask({ controls: c }: Props) {
  const { t } = useI18n(),
    cal = c.cal!;
  return (
    <div className="calibration-task">
      <p>{t("paper.step1Hint")}</p>
      <div className="calibration-machine-fields">
        <CommittedNumberField
          label={t("paper.bedWidth")}
          value={cal.bed_width}
          min={10}
          disabled={!c.canEdit}
          onChange={(value) => c.saveBedDimension("bed_width", value)}
        />
        <CommittedNumberField
          label={t("paper.bedHeight")}
          value={cal.bed_height}
          min={10}
          disabled={!c.canEdit}
          onChange={(value) => c.saveBedDimension("bed_height", value)}
        />
      </div>
      <p className="calibration-task-note">{t("paper.bedSizeHint")}</p>
      {c.homed && (
        <p className="calibration-check">
          <EditorIcon name="check" size={16} />
          {t("paper.homed")}
        </p>
      )}
      <div className="calibration-task-actions">
        <button
          type="button"
          disabled={!c.canMove}
          className={c.homed ? "" : "primary"}
          onClick={c.homeAll}
        >
          <EditorIcon name="home" size={16} />
          {t("paper.homeXYZ")}
        </button>
        <button
          type="button"
          className={c.homed ? "primary" : ""}
          disabled={!c.homed}
          onClick={() => c.setActive("positions")}
        >
          {t("common.next")} →
        </button>
      </div>
    </div>
  );
}
