import ProfileLibrary from "./ProfileLibrary";
import ProfileVisualEditor from "./ProfileVisualEditor";
import EditorIcon from "../../components/editor/EditorIcon";
import { useAppTour } from "../tour/TourProvider";
import ProfileSettings from "./ProfileSettings";
import { useEffect, useRef, useState } from "react";
import { api, type Calibration, type PrinterStatus, type CalibrationProfileSummary } from "../../api";
import { useI18n } from "../../i18n";
import { useConfirm } from "../../components/dialogs";
import { useToasts } from "../../components/Toasts";
import { useProjectCalibration } from "../../state/ProjectCalibrationContext";
import { errorMessage, isAbortError } from "../../api/errors";

const noop = () => {};
export default function Calibrate({ status = null, visible = true, onAction = noop, onSettings = noop, request, onSetup }: {
  status?: PrinterStatus | null; visible?: boolean; onAction?: () => void; onSettings?: () => void;
  request?: { id: string; nonce: number }; onSetup?: () => void;
} = {}) {
  const { t } = useI18n();
  const toast = useToasts();
  const { profileRevision, profileChanged, index } = useProjectCalibration();
  const tour = useAppTour();
  const [mode, setMode] = useState<"visual" | "details">("visual");
  const [motionBusy, setMotionBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const handledRequest = useRef("");
  const initialProjectChosen = useRef(false);
  const read = useRef<AbortController | null>(null);
  const draftRevision = useRef(0);
  const detailRef = useRef<HTMLElement>(null);
  const [profiles, setProfiles] = useState<CalibrationProfileSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cal, setCal] = useState<Calibration | null>(null);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  useEffect(() => { setRenaming(false); }, [selectedId, mode, visible]);
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
      const active = list.find(p => p.id === index?.project?.profileId) ?? list.find(p => !p.archived) ?? list[0];
      if (active) return openProfile(active.id);
    }).catch(fail);
    return () => { cancelled = true; read.current?.abort(); };
  }, []);

  useEffect(() => {
    const projectProfile = index?.project?.profileId;
    if (!projectProfile || !selectedId || initialProjectChosen.current || motionBusy || speedTesting || saving) return;
    initialProjectChosen.current = true;
    if (!dirty && selectedId !== projectProfile) void openProfile(projectProfile).catch(fail);
  }, [index?.project?.profileId, selectedId, motionBusy, speedTesting, saving]);

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

  useEffect(() => {
    const tourProfile = tour?.step?.calibration ? index?.project?.profileId : undefined;
    const id = tourProfile ?? request?.id;
    const token = tourProfile ? `tour:${tour?.request}:${id}` : `request:${request?.nonce}:${id}`;
    if (!id || !cal || !visible || motionBusy || speedTesting || saving || handledRequest.current === token) return;
    handledRequest.current = token;
    initialProjectChosen.current = true;
    void (async () => {
      if (dirty && (!await confirm(t("profiles.saveBeforeVisual")) || !await save())) return;
      if (focusInvalidInput()) return;
      await openProfile(id);
      setMode("visual");
    })().catch(fail);
  }, [request?.nonce, tour?.request, tour?.step?.calibration, index?.project?.profileId, visible, !!cal, motionBusy, speedTesting, saving]);

  if (!cal) return <div className="card">{t("calibrate.loading")}</div>;

  const selected = profiles.find((p) => p.id === selectedId) ?? null;

  const focusInvalidInput = () => {
    const input = detailRef.current?.querySelector<HTMLInputElement>('input[aria-invalid="true"]');
    if (input) {
      requestAnimationFrame(() => input.focus());
    }
    return !!input;
  };

  const runSpeedTest = async () => {
    if (!selectedId || selected?.archived || dirty || speedTesting || focusInvalidInput()) return;
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
    if (motionBusy || speedTesting || saving || id === selectedId || !await confirmDiscard()) return;
    initialProjectChosen.current = true;
    openProfile(id).catch(fail);
  };

  const set = (k: keyof Calibration, v: number | boolean) => {
    read.current?.abort();
    draftRevision.current++;
    setCal({ ...cal, [k]: v });
    setDirty(true);
  };

  const save = async (): Promise<boolean> => {
    if (!selectedId || savingRef.current || focusInvalidInput()) return false;
    const revision = draftRevision.current;
    savingRef.current = true; setSaving(true);
    try {
      const p = await api.saveProfile(selectedId, { name, calibration: cal });
      if (draftRevision.current === revision) { setName(p.name); setCal(p.calibration); setDirty(false); }
      profileChanged(p.id); toast.success(t("profiles.saved"));
      await loadProfiles();
      return draftRevision.current === revision;
    } catch (error) { fail(error); return false; }
    finally { savingRef.current = false; setSaving(false); }
  };
  const renameProfile = async () => {
    const nextName = renameDraft.trim();
    if (!selectedId || !nextName || savingRef.current || motionBusy || speedTesting) return;
    savingRef.current = true; setSaving(true);
    try {
      // Visual calibration saves independently: never send its potentially stale snapshot.
      const updated = await api.saveProfile(selectedId, { name: nextName });
      setName(updated.name); setRenaming(false);
      profileChanged(updated.id); toast.success(t("profiles.saved"));
      await loadProfiles();
    } catch (error) { fail(error); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const changeMode = async (next: "visual" | "details") => {
    if (mode === next || motionBusy || speedTesting || saving || focusInvalidInput()) return;
    if (dirty && (!await confirm(t("profiles.saveBeforeVisual")) || !await save())) return;
    if (selectedId) await openProfile(selectedId);
    setMode(next);
  };

  const createProfile = async () => {
    if (motionBusy || speedTesting || saving || !await confirmDiscard()) return;
    api
      .createProfile()
      .then((p) => { profileChanged(p.id); return loadProfiles().then(() => openProfile(p.id)); })
      .catch(fail);
  };

  const duplicate = async () => {
    if (motionBusy || speedTesting || saving || !selectedId || !await confirmDiscard()) return;
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
      .importCalibration(file, selectedId ? { profileId: selectedId } : undefined)
      .then(() => {
        profileChanged();
        toast.success(t("calibrate.imported", { name: file.name }));
        return loadProfiles().then(() => { if (selectedId) return openProfile(selectedId); });
      })
      .catch(fail);

  const filePicker = (label: string, accept: string, onFile: (f: File) => void) => (
    <label className="btn-link">
      {label}
      <input
        type="file"
        disabled={motionBusy || speedTesting || saving}
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

  const visibleProfiles = profiles.filter((p) => showArchived || !p.archived);
  const archivedCount = profiles.filter((p) => p.archived).length;

  return (
    <>
    <div className="calibrate-profiles">
      <div className="profile-layout">
        <aside className="card profile-panel">
          <h2>{t("profiles.title")}</h2>
          <ProfileLibrary profiles={visibleProfiles} selectedId={selectedId} onSelect={select} projectProfileId={index?.project?.profileId} disabled={motionBusy || speedTesting || saving}/>
          {archivedCount > 0 && <button className="link-button" onClick={() => setShowArchived(!showArchived)}>{showArchived ? t("profiles.hideArchived") : t("profiles.showArchived", { count: String(archivedCount) })}</button>}
          <div className="profile-list-actions">
            <button disabled={motionBusy || speedTesting || saving} onClick={createProfile}>{t("profiles.new")}</button>
            {filePicker(t("profiles.importProfile"), ".json,application/json", importProfileFile)}
            {filePicker(t("profiles.importAll"), ".json,application/json", importAllFile)}
            <a className="btn-link" href="/api/profiles/export-all" download>
              {t("profiles.exportAll")}
            </a>
          </div>
        </aside>

        <section ref={detailRef} className={`card profile-detail${mode === "visual" ? " profile-detail-visual" : ""}`}>
          <header className="profile-editor-heading">
            {mode === "visual" && renaming ? <form className="profile-heading-name" onSubmit={event => { event.preventDefault(); void renameProfile(); }}>
              <input autoFocus aria-label={t("profiles.name")} value={renameDraft} disabled={saving}
                aria-invalid={!renameDraft.trim()} onChange={event => setRenameDraft(event.target.value)}
                onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setRenaming(false); } }} />
              <button type="submit" disabled={saving || !renameDraft.trim()} aria-label={t("common.save")} title={t("common.save")}><EditorIcon name="check" size={16}/></button>
              <button type="button" disabled={saving} onClick={() => setRenaming(false)} aria-label={t("common.cancel")} title={t("common.cancel")}><EditorIcon name="close" size={16}/></button>
            </form> : <div className="profile-heading-name"><h2 title={name}>{name}</h2>
              {mode === "visual" && <button type="button" disabled={motionBusy || speedTesting || saving}
                aria-label={t("profiles.rename")} title={t("profiles.rename")}
                onClick={() => { setRenameDraft(name); setRenaming(true); }}><EditorIcon name="text" size={15}/>{t("profiles.renameAction")}</button>}
            </div>}
            {mode === "visual" && selectedId && <div className="profile-heading-export">
              <a className="btn-link" href={`/api/profiles/${encodeURIComponent(selectedId)}/export`} download
                aria-disabled={renaming || saving} onClick={event => { if (renaming || saving) event.preventDefault(); }}>{t("profiles.exportProfile")}</a>
              <a className="btn-link" href={`/api/calibration/export?profile_id=${encodeURIComponent(selectedId)}`} download
                aria-label={t("common.exportXml")} title={t("common.exportXml")}
                aria-disabled={renaming || saving} onClick={event => { if (renaming || saving) event.preventDefault(); }}>XML</a>
            </div>}
            <div className="profile-view-toggle" role="group" aria-label={t("profiles.viewMode")}>
              <button aria-pressed={mode === "visual"} disabled={motionBusy || speedTesting || saving} onClick={() => void changeMode("visual").catch(fail)}><EditorIcon name="preview" size={15}/>{t("profiles.visual")}</button>
              <button aria-pressed={mode === "details"} disabled={motionBusy || speedTesting || saving} onClick={() => void changeMode("details").catch(fail)}><EditorIcon name="settings" size={15}/>{t("profiles.details")}</button>
            </div>
            {onSetup && request && <button className="ghost profile-setup-return" onClick={onSetup}>{t("profiles.backToSetup")}</button>}
          </header>
          <p className="profile-project-context">{t("profiles.projectContext")}{index?.project && <> {t("profiles.currentProject", { name: index.project.name, profile: profiles.find(p => p.id === index?.project?.profileId)?.name ?? "—" })}</>}</p>
          {mode === "visual" && selectedId && selected ? <ProfileVisualEditor profileId={selectedId} archived={selected.archived}
            visible={visible} status={status} onAction={onAction} onSettings={onSettings} onBusyChange={setMotionBusy}/> : <>
          <p className="calibration-intro">{t("profiles.detailsHint")}</p>
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
            </div>
            <ProfileSettings cal={cal} onChange={set} canTest={!!selected && !selected.archived && !dirty}
              speedTesting={speedTesting} onSpeedTest={runSpeedTest}/>
            <div className="profile-actions">
              <div className="profile-actions-main">
                <button className="primary" disabled={saving} onClick={() => void save()}>
                  {t("common.save")}
                  {dirty ? " *" : ""}
                </button>
                <button onClick={duplicate}>{t("profiles.duplicate")}</button>
                {selected && !selected.archived && selected.id !== index?.project?.profileId && !selected.active && (
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
                <a className="btn-link" href={`/api/calibration/export?profile_id=${encodeURIComponent(selectedId ?? "")}`} download>
                  {t("common.exportXml")}
                </a>
                {filePicker(t("common.importXml"), ".xml,application/xml,text/xml", importCalibrationXml)}
              </div>
            </div>
          </>}
        </section>
      </div>
    </div>
    {ConfirmNode}
    </>
  );
}
