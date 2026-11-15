import { useEffect, useRef, useState } from "react";
import { api, type Calibration, type CalibrationProfileSummary } from "../../api";
import CommittedNumberField from "../../components/CommittedNumberField";
import { useI18n } from "../../i18n";
import { useConfirm } from "../../components/dialogs";
import { useToasts } from "../../components/Toasts";
import { useProjectCalibration } from "../../state/ProjectCalibrationContext";
import { errorMessage, isAbortError } from "../../api/errors";

const FIELDS: { key: keyof Calibration; labelKey: string; unit: string; groupKey: string }[] = [
  { key: "bed_width", labelKey: "calibrate.bedWidth", unit: "mm", groupKey: "calibrate.groupMachine" },
  { key: "bed_height", labelKey: "calibrate.bedHeight", unit: "mm", groupKey: "calibrate.groupMachine" },
  { key: "z_max", labelKey: "calibrate.zMax", unit: "mm", groupKey: "calibrate.groupMachine" },
  { key: "plot_width", labelKey: "calibrate.plotWidth", unit: "mm", groupKey: "calibrate.groupArea" },
  { key: "plot_height", labelKey: "calibrate.plotHeight", unit: "mm", groupKey: "calibrate.groupArea" },
  { key: "origin_x", labelKey: "calibrate.originX", unit: "mm", groupKey: "calibrate.groupArea" },
  { key: "origin_y", labelKey: "calibrate.originY", unit: "mm", groupKey: "calibrate.groupArea" },
  { key: "pen_up_z", labelKey: "calibrate.penUpZ", unit: "mm", groupKey: "calibrate.groupPen" },
  { key: "pen_down_z", labelKey: "calibrate.penDownZ", unit: "mm", groupKey: "calibrate.groupPen" },
  { key: "park_x", labelKey: "calibrate.parkX", unit: "mm", groupKey: "calibrate.groupPark" },
  { key: "park_y", labelKey: "calibrate.parkY", unit: "mm", groupKey: "calibrate.groupPark" },
  { key: "park_lift_z", labelKey: "calibrate.parkLiftZ", unit: "mm", groupKey: "calibrate.groupPark" },
  { key: "calibration_x", labelKey: "calibrate.calibrationX", unit: "mm", groupKey: "calibrate.groupCalibrationPosition" },
  { key: "calibration_y", labelKey: "calibrate.calibrationY", unit: "mm", groupKey: "calibrate.groupCalibrationPosition" },
  { key: "travel_feed", labelKey: "calibrate.travelFeed", unit: "mm/s", groupKey: "calibrate.groupSpeed" },
  { key: "draw_feed", labelKey: "calibrate.drawFeed", unit: "mm/s", groupKey: "calibrate.groupSpeed" },
  { key: "z_feed", labelKey: "calibrate.zFeed", unit: "mm/s", groupKey: "calibrate.groupSpeed" },
  { key: "z_max_feedrate", labelKey: "calibrate.zMaxFeedrate", unit: "mm/s", groupKey: "calibrate.groupSpeed" },
  { key: "merge_tolerance", labelKey: "calibrate.mergeTolerance", unit: "mm", groupKey: "calibrate.groupOptimize" },
];

export default function Calibrate() {
  const { t } = useI18n();
  const toast = useToasts();
  const { profileRevision, profileChanged } = useProjectCalibration();
  const read = useRef<AbortController | null>(null);
  const draftRevision = useRef(0);
  const detailRef = useRef<HTMLElement>(null);
  const [profiles, setProfiles] = useState<CalibrationProfileSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cal, setCal] = useState<Calibration | null>(null);
  const [name, setName] = useState("");
  const [dirty, setDirty] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [speedTesting, setSpeedTesting] = useState(false);
  const { confirm, ConfirmNode } = useConfirm();

  const fail = (e: unknown) => { if (!isAbortError(e)) toast.error(errorMessage(e)); };

  const loadProfiles = () =>
    api.listProfiles().then((list) => {
      setProfiles(list);
      return list;
    });

  const openProfile = (id: string) => {
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    return api.getProfile(id, controller.signal).then(p => {
      if (controller.signal.aborted) return;
      draftRevision.current++;
      setSelectedId(p.id); setName(p.name); setCal(p.calibration); setDirty(false);
    });
  };

  useEffect(() => {
    let cancelled = false;
    loadProfiles().then(list => {
      if (cancelled) return;
      const active = list.find(p => p.active) ?? list[0];
      if (active) return openProfile(active.id);
    }).catch(fail);
    return () => { cancelled = true; read.current?.abort(); };
  }, []);

  // Persisted changes are shared; the editor's unsaved draft remains local.
  useEffect(() => {
    if (dirty || !selectedId || profileRevision === 0) return;
    let cancelled = false;
    const controller = new AbortController();
    const revision = draftRevision.current;
    loadProfiles().catch(fail);
    api.getProfile(selectedId, controller.signal).then(p => {
      if (cancelled || revision !== draftRevision.current) return;
      setName(p.name); setCal(p.calibration);
    }).catch(fail);
    return () => { cancelled = true; controller.abort(); };
  }, [profileRevision, selectedId, dirty]);

  if (!cal) return <div className="card">{t("calibrate.loading")}</div>;

  const selected = profiles.find((p) => p.id === selectedId) ?? null;

  const focusInvalidInput = () => {
    const input = detailRef.current?.querySelector<HTMLInputElement>('input[aria-invalid="true"]');
    input?.focus();
    return !!input;
  };

  const runSpeedTest = async () => {
    if (!selectedId || !selected?.active || dirty || speedTesting || focusInvalidInput()) return;
    setSpeedTesting(true);
    try {
      await api.speedTest(selectedId);
      toast.success(t("calibrate.speedTestSent"));
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setSpeedTesting(false);
    }
  };

  const confirmDiscard = async () => !dirty || await confirm(t("profiles.unsaved"));

  const select = async (id: string) => {
    if (id === selectedId || !await confirmDiscard()) return;
    openProfile(id).catch(fail);
  };

  const set = (k: keyof Calibration, v: number | boolean) => {
    read.current?.abort();
    draftRevision.current++;
    setCal({ ...cal, [k]: v });
    setDirty(true);
  };

  const save = () => {
    if (!selectedId || focusInvalidInput()) return;
    const revision = draftRevision.current;
    api
      .saveProfile(selectedId, { name, calibration: cal })
      .then((p) => {
        if (draftRevision.current === revision) {
          setName(p.name); setCal(p.calibration); setDirty(false);
        }
        profileChanged(p.id);
        toast.success(t("profiles.saved"));
        return loadProfiles();
      })
      .catch(fail);
  };

  const activate = (id: string) =>
    api
      .activateProfile(id)
      .then((p) => {
        profileChanged(p.id);
        toast.success(t("profiles.activated", { name: p.name }));
        return loadProfiles();
      })
      .catch(fail);

  const createProfile = async () => {
    if (!await confirmDiscard()) return;
    api
      .createProfile()
      .then((p) => { profileChanged(p.id); return loadProfiles().then(() => openProfile(p.id)); })
      .catch(fail);
  };

  const duplicate = async () => {
    if (!selectedId || !await confirmDiscard()) return;
    api
      .duplicateProfile(selectedId)
      .then((p) => { profileChanged(p.id); return loadProfiles().then(() => openProfile(p.id)); })
      .catch(fail);
  };

  const setArchived = (archived: boolean) => {
    if (!selectedId) return;
    api
      .archiveProfile(selectedId, archived)
      .then(() => { profileChanged(selectedId); return loadProfiles(); })
      .catch(fail);
  };

  const importProfileFile = (file: File) =>
    api
      .importProfile(file)
      .then(async (p) => {
        profileChanged(p.id);
        toast.success(t("profiles.imported", { name: p.name }));
        await loadProfiles();
        if (await confirmDiscard()) openProfile(p.id);
      })
      .catch(fail);

  const importAllFile = (file: File) =>
    api
      .importAllProfiles(file)
      .then((r) => {
        profileChanged();
        toast.success(t("profiles.importedAll", { count: String(r.imported.length + r.replaced.length) }));
        return loadProfiles();
      })
      .catch(fail);

  const importCalibrationXml = (file: File) =>
    api
      .importCalibration(file)
      .then(() => {
        profileChanged();
        toast.success(t("calibrate.imported", { name: file.name }));
        // The XML import updates the *active* profile's calibration.
        return loadProfiles().then((list) => {
          const active = list.find((p) => p.active);
          if (active && active.id === selectedId) return openProfile(active.id);
        });
      })
      .catch(fail);

  const filePicker = (label: string, accept: string, onFile: (f: File) => void) => (
    <label className="btn-link">
      {label}
      <input
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </label>
  );

  const groups = [...new Set(FIELDS.map((f) => f.groupKey))];
  const visibleProfiles = profiles.filter((p) => showArchived || !p.archived);
  const archivedCount = profiles.filter((p) => p.archived).length;

  return (
    <>
    <div className="calibrate-profiles">
      <div className="profile-layout">
        <aside className="card profile-panel">
          <h2>{t("profiles.title")}</h2>
          <div className="profile-list-scroll">
            {visibleProfiles.map((p) => (
              <div
                key={p.id}
                className={
                  "profile-item" +
                  (p.id === selectedId ? " selected" : "") +
                  (p.active ? " active" : "") +
                  (p.archived ? " archived" : "")
                }
                onClick={() => select(p.id)}
              >
                <div className="profile-item-head">
                  <strong>{p.name}</strong>
                  {p.active && <span className="pbadge pbadge-active">{t("profiles.activeBadge")}</span>}
                  {p.archived && <span className="pbadge pbadge-muted">{t("profiles.archivedBadge")}</span>}
                </div>
                <div className="profile-item-info">
                  {p.plot_width.toFixed(0)} × {p.plot_height.toFixed(0)} mm · @{" "}
                  {p.origin_x.toFixed(0)}/{p.origin_y.toFixed(0)}
                  {p.paper_margin > 0 && <> · {t("profiles.margin")} {p.paper_margin.toFixed(0)} mm</>}
                </div>
                <div className="profile-item-info">
                  <span className={p.pen_calibrated ? "pen-ok" : "pen-missing"}>
                    {p.pen_calibrated ? t("profiles.penOk") : t("profiles.penMissing")}
                  </span>
                </div>
                {!p.active && !p.archived && (
                  <button
                    className="profile-activate"
                    onClick={(e) => {
                      e.stopPropagation();
                      activate(p.id);
                    }}
                  >
                    {t("profiles.activate")}
                  </button>
                )}
              </div>
            ))}
            {archivedCount > 0 && (
              <button className="link-button" onClick={() => setShowArchived(!showArchived)}>
                {showArchived
                  ? t("profiles.hideArchived")
                  : t("profiles.showArchived", { count: String(archivedCount) })}
              </button>
            )}
          </div>
          <div className="profile-list-actions">
            <button onClick={createProfile}>{t("profiles.new")}</button>
            {filePicker(t("profiles.importProfile"), ".json,application/json", importProfileFile)}
            {filePicker(t("profiles.importAll"), ".json,application/json", importAllFile)}
            <a className="btn-link" href="/api/profiles/export-all" download>
              {t("profiles.exportAll")}
            </a>
          </div>
        </aside>

        <section ref={detailRef} className="card profile-detail">
          <h2>{t("calibrate.title")}</h2>
          <p className="calibration-intro">{t("profiles.purpose")}</p>
            <div className="field-group">
              <label className="field">
                <span>{t("profiles.name")}</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    read.current?.abort();
                    draftRevision.current++;
                    setName(e.target.value);
                    setDirty(true);
                  }}
                />
              </label>
              {selected && !selected.active && (
                <p className="muted">{t("profiles.editingInactive")}</p>
              )}
            </div>
            {groups.map((g) => (
              <div key={g} className="field-group">
                <h3>
                  {g === "calibrate.groupPark" ? "P · " : g === "calibrate.groupCalibrationPosition" ? "C · " : ""}
                  {t(g)}
                </h3>
                <p className="calibration-group-hint">{t(`${g}Hint`)}</p>
                <div className="fields">
                  {FIELDS.filter((f) => f.groupKey === g).map((f) => (
                    <CommittedNumberField key={f.key} label={t(f.labelKey)} unit={f.unit}
                      value={cal[f.key] as number} min={0}
                      onChange={(value) => set(f.key, value)} />
                  ))}
                </div>
                {g === "calibrate.groupSpeed" && <div className="calibrate-speed-test">
                  <div>
                    <strong>{t("calibrate.speedTestTitle")}</strong>
                    <p>{t("calibrate.speedTestHint")}</p>
                    <small>{t("calibrate.speedTestFeeds", {
                      travel: cal.travel_feed, z: cal.z_feed,
                    })}</small>
                    {(!selected?.active || dirty) && <small>{t("calibrate.speedTestNeedsSavedActive")}</small>}
                  </div>
                  <button type="button" className="primary" disabled={!selected?.active || dirty || speedTesting}
                    onClick={runSpeedTest}>
                    {speedTesting ? t("calibrate.speedTestRunning") : t("calibrate.speedTestButton")}
                  </button>
                </div>}
              </div>
            ))}
            <div className="field-group">
              <h3>{t("calibrate.layout")}</h3>
              <div className="layout-toggle-row">
                <button
                  type="button"
                  className={"toggle-pill" + (cal.fit_to_area ? " on" : "")}
                  aria-pressed={cal.fit_to_area}
                  onClick={() => set("fit_to_area", !cal.fit_to_area)}
                >
                  <span>{t("calibrate.fitToArea")}</span>
                  <i />
                </button>
                <button
                  type="button"
                  className={"toggle-pill" + (cal.flip_y ? " on" : "")}
                  aria-pressed={cal.flip_y}
                  onClick={() => set("flip_y", !cal.flip_y)}
                >
                  <span>{t("calibrate.flipY")}</span>
                  <i />
                </button>
                <button
                  type="button"
                  className={"toggle-pill" + (cal.trust_axis_home ? " on" : "")}
                  aria-pressed={cal.trust_axis_home}
                  onClick={() => set("trust_axis_home", !cal.trust_axis_home)}
                >
                  <span>{t("calibrate.trustAxisHome")}</span>
                  <i />
                </button>
                <button
                  type="button"
                  className={"toggle-pill" + (cal.park_after_plot ? " on" : "")}
                  aria-pressed={cal.park_after_plot}
                  onClick={() => set("park_after_plot", !cal.park_after_plot)}
                >
                  <span>{t("calibrate.parkAfterPlot")}</span>
                  <i />
                </button>
              </div>
            </div>
            <div className="profile-actions">
              <div className="profile-actions-main">
                <button className="primary" onClick={save}>
                  {t("common.save")}
                  {dirty ? " *" : ""}
                </button>
                {selected && !selected.active && !selected.archived && (
                  <button onClick={() => activate(selected.id)}>{t("profiles.activate")}</button>
                )}
                <button onClick={duplicate}>{t("profiles.duplicate")}</button>
                {selected && !selected.archived && !selected.active && (
                  <button onClick={() => setArchived(true)}>{t("profiles.archive")}</button>
                )}
                {selected?.archived && (
                  <button onClick={() => setArchived(false)}>{t("profiles.unarchive")}</button>
                )}
                {selectedId && (
                  <a className="btn-link" href={`/api/profiles/${selectedId}/export`} download>
                    {t("profiles.exportProfile")}
                  </a>
                )}
              </div>
              <div className="profile-actions-secondary">
                <a className="btn-link" href="/api/calibration/export" download>
                  {t("common.exportXml")}
                </a>
                {filePicker(t("common.importXml"), ".xml,application/xml,text/xml", importCalibrationXml)}
              </div>
            </div>
        </section>
      </div>
    </div>
    {ConfirmNode}
    </>
  );
}
