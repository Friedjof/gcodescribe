import type { Calibration } from "../../api";
import CommittedNumberField from "../../components/CommittedNumberField";
import EditorIcon, {
  type EditorIconName,
} from "../../components/editor/EditorIcon";
import { useI18n } from "../../i18n";

const FIELDS: {
  key: keyof Calibration;
  labelKey: string;
  unit: string;
  groupKey: string;
}[] = [
  {
    key: "bed_width",
    labelKey: "calibrate.bedWidth",
    unit: "mm",
    groupKey: "calibrate.groupMachine",
  },
  {
    key: "bed_height",
    labelKey: "calibrate.bedHeight",
    unit: "mm",
    groupKey: "calibrate.groupMachine",
  },
  {
    key: "z_max",
    labelKey: "calibrate.zMax",
    unit: "mm",
    groupKey: "calibrate.groupMachine",
  },
  {
    key: "plot_width",
    labelKey: "calibrate.plotWidth",
    unit: "mm",
    groupKey: "calibrate.groupArea",
  },
  {
    key: "plot_height",
    labelKey: "calibrate.plotHeight",
    unit: "mm",
    groupKey: "calibrate.groupArea",
  },
  {
    key: "origin_x",
    labelKey: "calibrate.originX",
    unit: "mm",
    groupKey: "calibrate.groupArea",
  },
  {
    key: "origin_y",
    labelKey: "calibrate.originY",
    unit: "mm",
    groupKey: "calibrate.groupArea",
  },
  {
    key: "pen_up_z",
    labelKey: "calibrate.penUpZ",
    unit: "mm",
    groupKey: "calibrate.groupPen",
  },
  {
    key: "pen_down_z",
    labelKey: "calibrate.penDownZ",
    unit: "mm",
    groupKey: "calibrate.groupPen",
  },
  {
    key: "park_x",
    labelKey: "calibrate.parkX",
    unit: "mm",
    groupKey: "calibrate.groupPark",
  },
  {
    key: "park_y",
    labelKey: "calibrate.parkY",
    unit: "mm",
    groupKey: "calibrate.groupPark",
  },
  {
    key: "park_lift_z",
    labelKey: "calibrate.parkLiftZ",
    unit: "mm",
    groupKey: "calibrate.groupPark",
  },
  {
    key: "calibration_x",
    labelKey: "calibrate.calibrationX",
    unit: "mm",
    groupKey: "calibrate.groupCalibrationPosition",
  },
  {
    key: "calibration_y",
    labelKey: "calibrate.calibrationY",
    unit: "mm",
    groupKey: "calibrate.groupCalibrationPosition",
  },
  {
    key: "travel_feed",
    labelKey: "calibrate.travelFeed",
    unit: "mm/s",
    groupKey: "calibrate.groupSpeed",
  },
  {
    key: "draw_feed",
    labelKey: "calibrate.drawFeed",
    unit: "mm/s",
    groupKey: "calibrate.groupSpeed",
  },
  {
    key: "z_feed",
    labelKey: "calibrate.zFeed",
    unit: "mm/s",
    groupKey: "calibrate.groupSpeed",
  },
  {
    key: "z_max_feedrate",
    labelKey: "calibrate.zMaxFeedrate",
    unit: "mm/s",
    groupKey: "calibrate.groupSpeed",
  },
  {
    key: "merge_tolerance",
    labelKey: "calibrate.mergeTolerance",
    unit: "mm",
    groupKey: "calibrate.groupOptimize",
  },
];

const COLUMNS = [
  ["calibrate.groupMachine", "calibrate.groupArea"],
  [
    "calibrate.groupPen",
    "calibrate.groupPark",
    "calibrate.groupCalibrationPosition",
  ],
  ["calibrate.groupSpeed", "calibrate.groupOptimize"],
];
const ICONS: Record<string, EditorIconName> = {
  "calibrate.groupMachine": "settings",
  "calibrate.groupArea": "pages",
  "calibrate.groupPen": "draw",
  "calibrate.groupPark": "home",
  "calibrate.groupCalibrationPosition": "center",
  "calibrate.groupSpeed": "play",
  "calibrate.groupOptimize": "line",
};
const OPTIONS: Record<string, { key: keyof Calibration; label: string }[]> = {
  "calibrate.groupMachine": [
    { key: "trust_axis_home", label: "calibrate.trustAxisHome" },
  ],
  "calibrate.groupArea": [
    { key: "fit_to_area", label: "calibrate.fitToArea" },
    { key: "flip_y", label: "calibrate.flipY" },
  ],
  "calibrate.groupPark": [
    { key: "park_after_plot", label: "calibrate.parkAfterPlot" },
  ],
};

/** Show related settings together; keep every field mounted and directly reachable. */
export default function ProfileSettings({
  cal,
  onChange,
  canTest,
  speedTesting,
  onSpeedTest,
}: {
  cal: Calibration;
  onChange: (key: keyof Calibration, value: number | boolean) => void;
  canTest: boolean;
  speedTesting: boolean;
  onSpeedTest: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="profile-settings-overview">
      {COLUMNS.map((groups, column) => (
        <div className="profile-settings-column" key={column}>
          {groups.map((group) => (
            <section
              className="profile-settings-group"
              key={group}
              aria-label={t(group)}
            >
              <header>
                <h3>
                  <EditorIcon name={ICONS[group]} size={15} />
                  {t(group)}
                </h3>
                <details className="profile-group-help">
                  <summary
                    aria-label={t("profiles.groupHelp", { group: t(group) })}
                  >
                    <EditorIcon name="help" size={14} />
                  </summary>
                  <p>{t(`${group}Hint`)}</p>
                </details>
              </header>
              <div className="fields">
                {FIELDS.filter((field) => field.groupKey === group).map(
                  (field) => (
                    <CommittedNumberField
                      key={field.key}
                      label={t(field.labelKey)}
                      unit={field.unit}
                      value={cal[field.key] as number}
                      min={0}
                      onChange={(value) => onChange(field.key, value)}
                    />
                  ),
                )}
              </div>
              {OPTIONS[group]?.map((option) => (
                <label className="profile-option" key={option.key}>
                  <input
                    type="checkbox"
                    checked={!!cal[option.key]}
                    onChange={(event) =>
                      onChange(option.key, event.target.checked)
                    }
                  />
                  <span>{t(option.label)}</span>
                </label>
              ))}
              {group === "calibrate.groupSpeed" && (
                <div className="profile-speed-test">
                  <p>{t("calibrate.speedTestTitle")}</p>
                  <details className="profile-group-help">
                    <summary>{t("profiles.testDetails")}</summary>
                    <p>
                      {t("calibrate.speedTestHint")}
                      <br />
                      {t("calibrate.speedTestFeeds", {
                        travel: cal.travel_feed,
                        z: cal.z_feed,
                      })}
                    </p>
                  </details>
                  <button
                    type="button"
                    disabled={!canTest || speedTesting}
                    onClick={onSpeedTest}
                  >
                    <EditorIcon name="play" size={14} />
                    {t(
                      speedTesting
                        ? "calibrate.speedTestRunning"
                        : "calibrate.speedTestButton",
                    )}
                  </button>
                  {!canTest && (
                    <small>{t("calibrate.speedTestNeedsSavedActive")}</small>
                  )}
                </div>
              )}
            </section>
          ))}
        </div>
      ))}
    </div>
  );
}
