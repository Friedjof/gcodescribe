import { useI18n } from "../../i18n";
import PaginationBar from "../../components/paging/PaginationBar";
import { useFitListPage } from "../../components/paging/useFitListPage";
import { useEffect, useState } from "react";
import { useProjectCalibration } from "../../state/ProjectCalibrationContext";
import { api, type Calibration, type CalibrationProfile, type CalibrationProfileSummary, type PageIndex, type PaintProject } from "../../api";
import Modal from "../../components/Modal";
import PageThumbnail from "./PageThumbnail";

const NUMBERS: { key: keyof Calibration; label: string }[] = [
  { key: "bed_width", label: "calibration.bed_width" }, { key: "bed_height", label: "calibration.bed_height" },
  { key: "z_max", label: "setup.zLimit" },
  { key: "plot_width", label: "calibration.plot_width" }, { key: "plot_height", label: "calibration.plot_height" },
  { key: "origin_x", label: "calibration.origin_x" }, { key: "origin_y", label: "calibration.origin_y" },
  { key: "pen_up_z", label: "calibration.pen_up_z" }, { key: "pen_down_z", label: "calibration.pen_down_z" },
  { key: "pen_pressure_max_depth", label: "calibration.pen_pressure_max_depth" },
  { key: "travel_feed", label: "calibration.travel_feed" }, { key: "draw_feed", label: "calibration.draw_feed" },
  { key: "z_feed", label: "calibration.z_feed" }, { key: "paper_margin", label: "interface.canvasPadding" },
  { key: "z_max_feedrate", label: "calibration.z_max_feedrate" },
  { key: "park_x", label: "calibration.park_x" }, { key: "park_y", label: "calibration.park_y" },
  { key: "park_lift_z", label: "calibration.park_lift_z" },
  { key: "calibration_x", label: "calibration.calibration_x" }, { key: "calibration_y", label: "calibration.calibration_y" },
  { key: "calibration_pressure_offset", label: "calibration.calibration_pressure_offset" },
  { key: "merge_tolerance", label: "calibration.merge_tolerance" },
];
const FLAGS: { key: keyof Calibration; label: string }[] = [
  { key: "flip_y", label: "calibration.flip_y" },
  { key: "fit_to_area", label: "calibration.fit_to_area" },
  { key: "park_after_plot", label: "calibration.park_after_plot" },
  { key: "pen_calibrated", label: "calibration.pen_calibrated" },
  { key: "trust_axis_home", label: "calibration.trust_axis_home" },
];

export default function ProjectOverviewPopup({ activeId, movePageId, onClose, onActivate, beforeChange, onRefresh, confirm }: {
  activeId?: string;
  movePageId?: string | null;
  onClose: () => void;
  onActivate: (index: PageIndex) => Promise<void>;
  beforeChange: () => Promise<void>;
  onRefresh: () => Promise<unknown>;
  confirm: (message: string) => Promise<boolean>;
}) {
  const { t, lang } = useI18n();
  const { profileChanged } = useProjectCalibration();
  const [settingsGroup, setSettingsGroup] = useState("general");
  const [projects, setProjects] = useState<PaintProject[]>([]);
  const [profiles, setProfiles] = useState<CalibrationProfileSummary[]>([]);
  const [mode, setMode] = useState<"list" | "create" | "settings">("list");
  const [selected, setSelected] = useState<PaintProject | null>(null);
  const [profile, setProfile] = useState<CalibrationProfile | null>(null);
  const [originalCalibration, setOriginalCalibration] = useState<Calibration | null>(null);
  const [name, setName] = useState("");
  const [profileName, setProfileName] = useState("");
  const [originalProfileName, setOriginalProfileName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [corners, setCorners] = useState("{}");
  const [obstacles, setObstacles] = useState("[]");
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [numberDrafts, setNumberDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = () => Promise.all([api.listProjects(), api.listProfiles(false)]).then(([p, profiles]) => {
    setProjects(p); setProfiles(profiles);
  });
  useEffect(() => { load().catch((e) => setError(String(e.message ?? e))); }, []);
  const run = async (task: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await task(); } catch (e: any) { setError(String(e.message ?? e)); }
    finally { setBusy(false); }
  };
  const applyProfileDraft = (next: CalibrationProfile) => {
    setProfile(next); setProfileName(next.name); setOriginalProfileName(next.name);
    setOriginalCalibration(next.calibration);
    setNumberDrafts({});
    setCorners(JSON.stringify(next.calibration.paper_corners, null, 2));
    setObstacles(JSON.stringify(next.calibration.obstacles, null, 2));
  };
  const openSettings = (p: PaintProject) => run(async () => {
    setSelected(p); setName(p.name); setProfile(null); setTemplateId("");
    setMode("settings"); setSettingsGroup("general");
    applyProfileDraft(await api.getProfile(p.profileId));
  });
  const selectProfile = (id: string) => run(async () => applyProfileDraft(await api.getProfile(id)));
  const activate = (p: PaintProject) => run(async () => {
    await beforeChange();
    const next = await api.activateProject(p.id);
    try { await onActivate(next); onClose(); }
    catch (error) {
      if (activeId) await api.activateProject(activeId);
      throw error;
    }
  });
  const create = () => run(async () => {
    await beforeChange();
    const index = await api.createProject(name.trim() || t("projects.newProject"), undefined, templateId || undefined);
    await onActivate(index); onClose();
  });
  const move = (project: PaintProject) => run(async () => {
    if (!movePageId) return;
    await beforeChange();
    await onActivate(await api.movePageToProject(movePageId, project.id));
    onClose();
  });
  const save = () => run(async () => {
    if (!selected || !profile) return;
    const paper_corners = JSON.parse(corners);
    const obstacleList = JSON.parse(obstacles);
    if (!paper_corners || typeof paper_corners !== "object" || !Array.isArray(obstacleList))
      throw new Error(t("projects.invalidGeometry"));
    const calibration = { ...profile.calibration, paper_corners, obstacles: obstacleList };
    const updates = Object.fromEntries(Object.keys(calibration)
      .filter((key) => key !== "defined_positions" && JSON.stringify(calibration[key as keyof Calibration]) !==
        JSON.stringify(originalCalibration?.[key as keyof Calibration]))
      .map((key) => [key, calibration[key as keyof Calibration]])) as Partial<Calibration>;
    const defined = calibration.defined_positions ?? [];
    const originalDefined = originalCalibration?.defined_positions ?? [];
    if (!defined.includes("park") && originalDefined.includes("park")) {
      updates.park_x = null as unknown as number;
      updates.park_y = null as unknown as number;
      updates.park_lift_z = null as unknown as number;
    } else if (defined.includes("park") && !originalDefined.includes("park")) {
      updates.park_x = calibration.park_x;
      updates.park_y = calibration.park_y;
      updates.park_lift_z = calibration.park_lift_z;
    }
    if (!defined.includes("calibration") && originalDefined.includes("calibration")) {
      updates.calibration_x = null as unknown as number;
      updates.calibration_y = null as unknown as number;
    } else if (defined.includes("calibration") && !originalDefined.includes("calibration")) {
      updates.calibration_x = calibration.calibration_x;
      updates.calibration_y = calibration.calibration_y;
    }
    if (selected.id === activeId) await beforeChange();
    if (Object.keys(updates).length || profileName.trim() !== originalProfileName) {
      await api.saveProfile(profile.id, { name: profileName.trim() || profile.name, calibration: updates });
    }
    await api.updateProject(selected.id, { name: name.trim() || selected.name,
      ...(profile.id !== selected.profileId ? { profileId: profile.id } : {}) });
    profileChanged(profile.id);
    await load(); await onRefresh(); setMode("list");
  });
  const archive = (p: PaintProject) => run(async () => {
    if (!await confirm(t(p.archived?"projects.restoreConfirm":"projects.archiveConfirm",{name:p.name}))) return;
    if (p.id === activeId && !p.archived) await beforeChange();
    await api.updateProject(p.id, { archived: !p.archived });
    await load();
    if (p.id === activeId && !p.archived) await onActivate(await api.listPages());
  });
  const updateNumber = (key: keyof Calibration, value: string) => {
    setNumberDrafts((drafts) => ({ ...drafts, [key]: value }));
    const number = Number(value);
    if (!profile || !value.trim() || !Number.isFinite(number)) return;
    const kind = key === "park_x" || key === "park_y" || key === "park_lift_z" ? "park"
      : key === "calibration_x" || key === "calibration_y" ? "calibration" : null;
    const defined_positions = kind
      ? [...new Set([...(profile.calibration.defined_positions ?? []), kind])]
      : profile.calibration.defined_positions;
    setProfile({ ...profile, calibration: { ...profile.calibration, [key]: number,
      defined_positions: defined_positions as Calibration["defined_positions"] } });
  };
  const visible = projects.filter((p) => p.archived === archived && p.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.modified - a.modified);
  const paging = useFitListPage(visible, 100, 4, mode === "list");
  const activeCount = projects.filter((p) => !p.archived).length;
  const archivedCount = projects.length - activeCount;
  const numberFields = (keys: (keyof Calibration)[]) => NUMBERS.filter(({ key }) => keys.includes(key)).map(({ key, label }) =>
    <label key={key}>{t(label)}<input type="number" step="any"
      min={key === "pen_pressure_max_depth" ? 0 : undefined}
      max={key === "pen_pressure_max_depth" ? profile?.calibration.pen_down_z : undefined}
      value={numberDrafts[key] ?? (profile?.calibration[key] as number ?? (key === "pen_pressure_max_depth" ? 0 : ""))}
      onChange={(event) => updateNumber(key, event.target.value)}
      onBlur={() => setNumberDrafts((drafts) => {
        const next = { ...drafts }; delete next[key]; return next;
      })} /></label>);
  const flagFields = (keys: (keyof Calibration)[]) => FLAGS.filter(({ key }) => keys.includes(key)).map(({ key, label }) =>
    <label className="project-profile-checkbox" key={key}><input type="checkbox"
      checked={!!profile?.calibration[key]} onChange={(event) => profile && setProfile({ ...profile, calibration: { ...profile.calibration, [key]: event.target.checked } })} />{t(label)}</label>);
  const areaKeys: (keyof Calibration)[] = ["bed_width", "bed_height", "z_max", "plot_width", "plot_height", "origin_x", "origin_y", "paper_margin"];
  const penKeys: (keyof Calibration)[] = ["pen_up_z", "pen_down_z", "pen_pressure_max_depth", "travel_feed", "draw_feed", "z_feed", "z_max_feedrate", "merge_tolerance", "calibration_pressure_offset"];
  const positionKeys: (keyof Calibration)[] = ["park_x", "park_y", "park_lift_z", "calibration_x", "calibration_y"];
  const footer = mode === "create" ? <>
    <button className="ghost" onClick={() => setMode("list")}>{t("tour.back")}</button>
    <button className="primary" disabled={busy || !name.trim()} onClick={create}>{t("projects.createProject")}</button>
  </> : mode === "settings" ? <>
    <button className="ghost" onClick={() => setMode("list")}>{t("projects.backToOverview")}</button>
    <span className="project-footer-spacer" />
    <button className="primary" disabled={busy || !profile || !name.trim() || !profileName.trim()} onClick={save}>{t("projects.saveChanges")}</button>
  </> : undefined;

  return <Modal title={mode === "list" ? t(movePageId?"projects.moveSlide":"app.projects") : mode === "create" ? t("projects.newProject") : t("projects.namedProject",{name:selected?.name??""})}
    onClose={() => !busy && onClose()} footer={footer} className={`project-overview-popup project-mode-${mode}`} bodyClassName="project-overview-body">
    {error && <p className="banner err" role="alert">{error}</p>}
    {mode === "list" ? <>
      <div className="project-overview-intro">
        <div><strong>{t(movePageId?"projects.chooseDestination":"projects.yourProjects")}</strong>
          <p>{t(movePageId?"projects.moveHint":"projects.overviewHint")}</p></div>
        {!movePageId && <button className="primary" onClick={() => { setName(""); setTemplateId(""); setMode("create"); }}>{t("projects.newProject")}</button>}
      </div>
      {!movePageId && <div className="project-popup-tabs" role="tablist" aria-label={t("projects.projectStatus")}>
        <button role="tab" aria-selected={!archived} className={!archived ? "active" : ""} onClick={() => { setArchived(false); paging.setPage(0); }}>{t("profiles.activeBadge")} <span>{activeCount}</span></button>
        <button role="tab" aria-selected={archived} className={archived ? "active" : ""} onClick={() => { setArchived(true); paging.setPage(0); }}>{t("projects.archive")} <span>{archivedCount}</span></button>
      </div>}
      <div className="project-popup-toolbar">
        <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); paging.setPage(0); }}
          placeholder={t("projects.searchProjects")} aria-label={t("projects.searchProjects")} />
        <span>{visible.length} {t(visible.length===1?"setup.projectSelect":"app.projects")}</span>
      </div>
      <div className="project-popup-list" ref={paging.viewport}>
        {paging.items.map((p) => <article className={`project-popup-card${p.id === activeId ? " current" : ""}`} key={p.id}>
          <div className="project-popup-cover" aria-hidden="true">
            {p.coverPageId ? <PageThumbnail page={{ id: p.coverPageId, modified: p.coverModified ?? p.modified }} /> : <span>▤</span>}
          </div>
          <div className="project-popup-details">
            <div className="project-popup-title"><h3>{p.name}</h3>{p.id === activeId && !p.archived && <span className="project-current-badge">{t("projects.opened")}</span>}</div>
            <p>{profiles.find((item) => item.id === p.profileId)?.name ?? t("projects.defaultProfile")}</p>
            <small>{p.slideCount ?? 0} {t((p.slideCount ?? 0) === 1 ? "projects.oneSlide" : "projects.slides")}  {t("projects.lastModified")} {new Date(p.modified * 1000).toLocaleDateString(lang === "ba" ? "de-DE" : lang)}</small>
          </div>
          <div className="project-popup-actions">
            {!p.archived && (movePageId
              ? p.id !== activeId && <button className="primary" disabled={busy} onClick={() => move(p)}>{t("projects.moveHere")}</button>
              : p.id !== activeId && <button className="primary" disabled={busy} onClick={() => activate(p)}>{t("projects.open")}</button>)}
            {!movePageId && <button className="ghost" disabled={busy} onClick={() => openSettings(p)}>{t("settings.title")}</button>}
            {!movePageId && <button className="ghost project-archive-btn" disabled={busy} onClick={() => archive(p)}>{t(p.archived?"profiles.restore":"profiles.archive")}</button>}
          </div>
        </article>)}
        {visible.length === 0 && <div className="project-popup-empty"><span aria-hidden="true">▤</span>
          <strong>{t(query?"projects.noMatches":archived?"projects.noArchivedYet":"projects.noProjectsYet")}</strong>
          {!query && !archived && !movePageId && <button onClick={() => { setName(""); setTemplateId(""); setMode("create"); }}>{t("projects.createFirstProject")}</button>}
        </div>}
      </div>
      <PaginationBar page={paging.page} pages={paging.pages} onChange={paging.setPage} label={t("projects.projects")}/>
    </> : mode === "create" ? <div className="project-popup-form project-create-form">
      <div className="project-form-intro"><span aria-hidden="true">▤</span><div><strong>{t("projects.setUpANewProject")}</strong>
        <p>{t("projects.chooseAnExistingProfileOrCreate")}</p></div></div>
      <label>{t("setup.projectName")}<input autoFocus value={name} onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && name.trim()) create(); }} placeholder={t("projects.forExampleInvitations")} /></label>
      <label>{t("projects.profile")}<select value={templateId} disabled={busy} onChange={(event) => setTemplateId(event.target.value)}>
        <option value="">{t("projects.createASeparateProfile")}</option>
        {profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
    </div> : <fieldset disabled={busy} className="project-popup-form project-settings-form">
      <div className="project-settings-note">{t("projects.paperViewPreviewAndPlottingUse")}</div>
      <nav className="project-settings-tabs" aria-label={t("projects.projectSettings")}>{[["general", "projects.general"], ["area", "paper.plotArea"], ["pen", "projects.penMovement"], ["positions", "projects.positions"], ["geometry", "projects.geometry"]].map(([id, label]) => <button type="button" key={id} aria-pressed={settingsGroup === id} onClick={() => setSettingsGroup(id)}>{t(label)}</button>)}</nav>
      <section className="project-settings-section" hidden={settingsGroup !== "general"}><h3>{t("projects.general")}</h3>
        <label>{t("setup.projectName")}<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>{t("projects.profile")}<select value={profile?.id ?? selected?.profileId ?? ""} disabled={busy}
          onChange={(event) => selectProfile(event.target.value)}>
          {selected && !profiles.some((item) => item.id === selected.profileId) &&
            <option value={selected.profileId} disabled>{profile?.name ?? "Bisheriges Profil nicht verfügbar"}</option>}
          {profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
      </section>
      {profile && <>
        {projects.some((project) => project.id !== selected?.id && project.profileId === profile.id) &&
          <p className="muted" hidden={settingsGroup !== "general"}>{t("projects.otherProjectsAlsoUseThisProfile")}</p>}
        <section className="project-settings-section" hidden={settingsGroup !== "general"}><h3>{t("projects.renameProfile")}</h3>
          <div className="project-profile-fields"><label>{t("setup.profileName")}<input value={profileName} onChange={(event) => setProfileName(event.target.value)} /></label></div>
        </section>
        <section className="project-settings-section" hidden={settingsGroup !== "area"}><h3>{t("projects.drawingArea")} <small>{t("projects.bedPaperAndOrigin")}</small></h3>
          <div className="project-profile-fields">{numberFields(areaKeys)}{flagFields(["flip_y", "fit_to_area"])}</div></section>
        <section className="project-settings-section" hidden={settingsGroup !== "pen"}><h3>{t("projects.penAndMovement")} <small>{t("projects.heightsAndSpeeds")}</small></h3>
          <div className="project-profile-fields">{numberFields(penKeys)}{flagFields(["pen_calibrated", "trust_axis_home"])}</div>
          <p className="muted">{t("projects.xournalPressureVariationLowersThePen")}</p></section>
        <section className="project-settings-section" hidden={settingsGroup !== "positions"}><h3>{t("projects.parkingAndCalibration")} <small>{t("projects.savedPositions")}</small></h3>
          <div className="project-profile-fields">{numberFields(positionKeys)}{flagFields(["park_after_plot"])}
            {(["park", "calibration"] as const).map((kind) => <label className="project-profile-checkbox" key={kind}>
              <input type="checkbox" checked={profile.calibration.defined_positions?.includes(kind) ?? false}
                onChange={(event) => setProfile({ ...profile, calibration: { ...profile.calibration,
                  defined_positions: event.target.checked
                    ? [...new Set([...(profile.calibration.defined_positions ?? []), kind])]
                    : (profile.calibration.defined_positions ?? []).filter((value) => value !== kind) } })} />
              {kind === "park" ? "Parkposition festlegen" : "Kalibrierposition festlegen"}
            </label>)}
          </div></section>
        <section className="project-settings-section" hidden={settingsGroup !== "geometry"}><h3>{t("projects.moreSettings")} <small>{t("projects.paperObstaclesAndTemplates")}</small></h3>
          <div className="project-advanced-fields">
            <label>{t("projects.paperCornersJson")}<textarea rows={4} value={corners} onChange={(event) => setCorners(event.target.value)} /></label>
            <label>{t("projects.obstaclesJson")}<textarea rows={4} value={obstacles} onChange={(event) => setObstacles(event.target.value)} /></label>
          </div></section>
      </>}
    </fieldset>}
  </Modal>;
}
