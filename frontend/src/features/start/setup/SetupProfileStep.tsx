import { useRef, useState } from "react";
import { api, type CalibrationProfile, type PageIndex } from "../../../api";
import { flushEdits } from "../../../api/pageEdits";
import { useI18n } from "../../../i18n";
import { useSetupTask } from "./useSetupTask";

export default function SetupProfileStep({
  index,
  profile,
  active,
  locked,
  onUse,
  onCreated,
}: {
  index: PageIndex;
  profile: CalibrationProfile;
  active: boolean;
  locked: boolean;
  onUse: () => void;
  onCreated: (index: PageIndex) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(t("setup.defaultProfile")),
    [projectName, setProjectName] = useState(t("setup.defaultProject"));
  const [width, setWidth] = useState("210"),
    [height, setHeight] = useState("210"),
    [zmax, setZmax] = useState("205");
  const [confirmed, setConfirmed] = useState(false),
    [creating, setCreating] = useState(false);
  const created = useRef<CalibrationProfile | null>(null),
    task = useSetupTask(index.project!.id, active && !locked);
  const valid =
    [width, height].every(
      (value) =>
        Number.isFinite(Number(value)) &&
        Number(value) >= 20 &&
        Number(value) <= 3000,
    ) &&
    Number(zmax) >= 10 &&
    Number(zmax) <= 3000 &&
    !!name.trim() &&
    !!projectName.trim() &&
    confirmed;
  const save = () =>
    task.run(async (isCurrent) => {
      if (!valid) return;
      if (index.activeId) await flushEdits(index.activeId);
      if (!isCurrent()) return;
      const calibration = {
        bed_width: Number(width),
        bed_height: Number(height),
        z_max: Number(zmax),
        plot_width: Number(width) - 10,
        plot_height: Number(height) - 10,
        origin_x: 5,
        origin_y: 5,
        pen_calibrated: false,
        pen_pressure_max_depth: 0,
        paper_corners: {},
        obstacles: [],
        defined_positions: [],
      };
      const next = created.current
        ? await api.saveProfile(created.current.id, {
            name: name.trim(),
            calibration,
          })
        : await api.createProfile(name.trim(), calibration);
      created.current = next;
      if (!isCurrent()) return;
      const project = await api.createProject(
        projectName.trim(),
        undefined,
        next.id,
      );
      if (isCurrent()) onCreated(project);
    });
  return (
    <section className="setup-step-content">
      <h2>{t("setup.profileTitle")}</h2>
      <p className="setup-lead">{t("setup.profileIntro")}</p>
      {!creating && <div className="setup-existing">
        <div>
          <strong>{profile.name}</strong>
          <span>
            {index.project?.name} · {profile.calibration.bed_width} ×{" "}
            {profile.calibration.bed_height} mm
          </span>
        </div>
        <button
          type="button"
          disabled={task.busy || locked}
          className={!creating ? "primary" : ""}
          onClick={onUse}
        >
          {t("setup.useExisting")}
        </button>
      </div>}
      <button
        className="ghost setup-create-toggle"
        aria-expanded={creating}
        onClick={() => setCreating(!creating)}
      >
        {t("setup.createNew")}
      </button>
      {creating && (
        <form
          className="setup-profile-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label>
            {t("setup.profileName")}
            <input
              value={name}
              maxLength={120}
              disabled={task.busy}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <label>
            {t("setup.projectName")}
            <input
              value={projectName}
              maxLength={120}
              disabled={task.busy}
              onChange={(e) => setProjectName(e.target.value)}
              required
            />
          </label>
          <fieldset>
            <legend>{t("setup.machineSize")}</legend>
            <p>{t("setup.machineSizeHint")}</p>
            <div className="setup-dimension-fields">
              {[
                {
                  label: t("paper.bedWidth"),
                  value: width,
                  set: setWidth,
                  min: 20,
                },
                {
                  label: t("paper.bedHeight"),
                  value: height,
                  set: setHeight,
                  min: 20,
                },
                {
                  label: t("setup.zLimit"),
                  value: zmax,
                  set: setZmax,
                  min: 10,
                },
              ].map((field) => (
                <label key={field.label}>
                  {field.label}
                  <span>
                    <input
                      type="number"
                      min={field.min}
                      max={3000}
                      step="any"
                      value={field.value}
                      disabled={task.busy}
                      onChange={(event) => field.set(event.target.value)}
                      required
                    />{" "}
                    mm
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="setup-check">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={task.busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {t("setup.confirmDimensions")}
          </label>
          {created.current && (
            <p className="muted">{t("setup.profileAlreadyCreated")}</p>
          )}
          <button className="primary" disabled={!valid || task.busy || locked}>
            {t(task.busy ? "common.loading" : "setup.createProfileProject")}
          </button>
        </form>
      )}
      {locked && <p className="banner warn">{t("setup.printerBusy")}</p>}
      {task.error && (
        <p className="banner err" role="alert">
          {task.error}
        </p>
      )}
      <p className="setup-note">{t("setup.profileNote")}</p>
    </section>
  );
}
