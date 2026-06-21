import { useEffect, useState } from "react";
import { api, type Calibration, type CalibrationProfileSummary } from "../api";
import { useI18n } from "../i18n";
import { useConfirm } from "./dialogs";

const FIELDS: { key: keyof Calibration; labelKey: string; unit: string; groupKey: string }[] = [
  { key: "bed_width", labelKey: "calibrate.bedWidth", unit: "mm", groupKey: "calibrate.groupArea" },
  { key: "bed_height", labelKey: "calibrate.bedHeight", unit: "mm", groupKey: "calibrate.groupArea" },
  { key: "z_max", labelKey: "calibrate.zMax", unit: "mm", groupKey: "calibrate.groupArea" },
  { key: "plot_width", labelKey: "calibrate.plotWidth", unit: "mm", groupKey: "calibrate.groupArea" },
  { key: "plot_height", labelKey: "calibrate.plotHeight", unit: "mm", groupKey: "calibrate.groupArea" },
  { key: "origin_x", labelKey: "calibrate.originX", unit: "mm", groupKey: "calibrate.groupArea" },
  { key: "origin_y", labelKey: "calibrate.originY", unit: "mm", groupKey: "calibrate.groupArea" },
  { key: "pen_up_z", labelKey: "calibrate.penUpZ", unit: "mm", groupKey: "calibrate.groupPen" },
  { key: "pen_down_z", labelKey: "calibrate.penDownZ", unit: "mm", groupKey: "calibrate.groupPen" },
  { key: "travel_feed", labelKey: "calibrate.travelFeed", unit: "mm/min", groupKey: "calibrate.groupSpeed" },
  { key: "draw_feed", labelKey: "calibrate.drawFeed", unit: "mm/min", groupKey: "calibrate.groupSpeed" },
  { key: "z_feed", labelKey: "calibrate.zFeed", unit: "mm/min", groupKey: "calibrate.groupSpeed" },
];

export default function Calibrate() {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<CalibrationProfileSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cal, setCal] = useState<Calibration | null>(null);
  const [name, setName] = useState("");
  const [dirty, setDirty] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { confirm, ConfirmNode } = useConfirm();

  const flash = (m: string) => {
    setMsg(m);
    setErr(null);
    setTimeout(() => setMsg(null), 3000);
  };
  const fail = (e: Error) => setErr(String(e.message));

  const loadProfiles = () =>
    api.listProfiles().then((list) => {
      setProfiles(list);
      return list;
    });

  const openProfile = (id: string) =>
    api.getProfile(id).then((p) => {
      setSelectedId(p.id);
      setName(p.name);
      setCal(p.calibration);
      setDirty(false);
    });

  useEffect(() => {
    loadProfiles()
      .then((list) => {
        const active = list.find((p) => p.active) ?? list[0];
        if (active) return openProfile(active.id);
      })
      .catch(fail);
  }, []);

  if (!cal) return <div className="card">{t("calibrate.loading")}</div>;

  const selected = profiles.find((p) => p.id === selectedId) ?? null;

  const confirmDiscard = async () => !dirty || await confirm(t("profiles.unsaved"));

  const select = async (id: string) => {
    if (id === selectedId || !await confirmDiscard()) return;
    openProfile(id).catch(fail);
  };

  const set = (k: keyof Calibration, v: number | boolean) => {
    setCal({ ...cal, [k]: v });
    setDirty(true);
  };

  const save = () => {
    if (!selectedId) return;
    api
      .saveProfile(selectedId, { name, calibration: cal })
      .then((p) => {
        setName(p.name);
        setCal(p.calibration);
        setDirty(false);
        flash(t("profiles.saved"));
        return loadProfiles();
      })
      .catch(fail);
  };

  const activate = (id: string) =>
    api
      .activateProfile(id)
      .then((p) => {
        flash(t("profiles.activated", { name: p.name }));
        return loadProfiles();
      })
      .catch(fail);

  const createProfile = () => {
    if (!confirmDiscard()) return;
    api
      .createProfile()
      .then((p) => loadProfiles().then(() => openProfile(p.id)))
      .catch(fail);
  };

  const duplicate = () => {
    if (!selectedId || !confirmDiscard()) return;
    api
      .duplicateProfile(selectedId)
      .then((p) => loadProfiles().then(() => openProfile(p.id)))
      .catch(fail);
  };

  const setArchived = (archived: boolean) => {
    if (!selectedId) return;
    api
      .archiveProfile(selectedId, archived)
      .then(() => loadProfiles())
      .catch(fail);
  };

  const importProfileFile = (file: File) =>
    api
      .importProfile(file)
      .then(async (p) => {
        flash(t("profiles.imported", { name: p.name }));
        await loadProfiles();
        if (await confirmDiscard()) openProfile(p.id);
      })
      .catch(fail);

  const importAllFile = (file: File) =>
    api
      .importAllProfiles(file)
      .then((r) => {
        flash(t("profiles.importedAll", { count: String(r.imported.length + r.replaced.length) }));
        return loadProfiles();
      })
      .catch(fail);

  const importCalibrationXml = (file: File) =>
    api
      .importCalibration(file)
      .then(() => {
        flash(t("calibrate.imported", { name: file.name }));
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

        <section className="card profile-detail">
          <h2>{t("calibrate.title")}</h2>
            <div className="field-group">
              <label className="field">
                <span>{t("profiles.name")}</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => {
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
                <h3>{t(g)}</h3>
                <div className="fields">
                  {FIELDS.filter((f) => f.groupKey === g).map((f) => (
                    <label key={f.key} className="field">
                      <span>{t(f.labelKey)}</span>
                      <div className="input-unit">
                        <input
                          type="number"
                          step="0.1"
                          value={cal[f.key] as number}
                          onChange={(e) => set(f.key, parseFloat(e.target.value) || 0)}
                        />
                        <em>{f.unit}</em>
                      </div>
                    </label>
                  ))}
                </div>
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
            {msg && <div className="banner ok">{msg}</div>}
            {err && <div className="banner err">{err}</div>}
        </section>
      </div>
    </div>
    {ConfirmNode}
    </>
  );
}
