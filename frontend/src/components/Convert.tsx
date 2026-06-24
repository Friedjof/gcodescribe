import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type GcodePreview, type GcodePreview3D, type Job } from "../api";
import { useI18n } from "../i18n";
import Modal from "./Modal";
import Gcode3D from "./Gcode3D";
import Segmented from "./Segmented";
import { useToasts } from "./Toasts";
import { useConfirm, usePrompt } from "./dialogs";

type ViewMode = "list" | "tile";
type SortBy = "date" | "name" | "size";
type DeleteMode = "all" | "plotted" | "selected";

interface JobGroup {
  id: string;
  jobs: Job[];
  isColor: boolean;
  created: number;
}

const jobThumbCache = new Map<string, GcodePreview>();

const COLOR_HEX: Record<string, string> = {
  black: "#111111", red: "#ff453a", blue: "#0a84ff", green: "#30d158",
};

function fmtSize(n: number) {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

function loadPlotted(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem("gcs:jobs:plotted") ?? "[]")); }
  catch { return new Set(); }
}

function savePlotted(s: Set<string>) {
  localStorage.setItem("gcs:jobs:plotted", JSON.stringify([...s]));
}

function buildGroups(jobs: Job[], sortBy: SortBy): JobGroup[] {
  const sorted = [...jobs].sort((a, b) => {
    if (sortBy === "name") return a.filename.localeCompare(b.filename);
    if (sortBy === "size") return b.size - a.size;
    return b.created - a.created;
  });

  const colorGroupMap = new Map<string, Job[]>();
  for (const j of jobs) {
    const gid = j.source?.kind === "paint_coloring" ? j.source.color_group_id : undefined;
    if (gid) {
      if (!colorGroupMap.has(gid)) colorGroupMap.set(gid, []);
      colorGroupMap.get(gid)!.push(j);
    }
  }

  const groups: JobGroup[] = [];
  const seenGroups = new Set<string>();

  for (const j of sorted) {
    const gid = j.source?.kind === "paint_coloring" ? j.source.color_group_id : undefined;
    if (gid) {
      if (seenGroups.has(gid)) continue;
      seenGroups.add(gid);
      const groupJobs = (colorGroupMap.get(gid) ?? [j]).sort(
        (a, b) => ((a.source?.color_order ?? 0) as number) - ((b.source?.color_order ?? 0) as number)
      );
      groups.push({ id: gid, jobs: groupJobs, isColor: true, created: Math.max(...groupJobs.map((j) => j.created)) });
    } else {
      groups.push({ id: j.filename, jobs: [j], isColor: false, created: j.created });
    }
  }

  return groups;
}

export default function Convert({
  status,
  onAction,
  visible = true,
}: {
  status: any;
  onAction: () => void;
  visible?: boolean;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ name: string; data: GcodePreview3D | null }>();
  const [fullscreen, setFullscreen] = useState(false);
  const [onlyActiveProfile, setOnlyActiveProfile] = useState(false);
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem("gcs:jobs:view") as ViewMode) ?? "list"
  );
  const [sortBy, setSortBy] = useState<SortBy>("date");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteMenuOpen, setDeleteMenuOpen] = useState(false);
  const [plottedFiles, setPlottedFiles] = useState<Set<string>>(loadPlotted);
  const deleteMenuRef = useRef<HTMLDivElement>(null);

  const { t } = useI18n();
  const toast = useToasts();
  const { confirm, ConfirmNode } = useConfirm();
  const { prompt, PromptNode } = usePrompt();

  const refresh = () => api.listJobs().then(setJobs).catch(() => {});

  useEffect(() => { if (visible) refresh(); }, [visible]);
  useEffect(() => { if (err) toast.error(err); }, [err, toast]);

  useEffect(() => {
    localStorage.setItem("gcs:jobs:view", viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFullscreen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  useEffect(() => {
    if (!deleteMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (deleteMenuRef.current && !deleteMenuRef.current.contains(e.target as Node)) {
        setDeleteMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [deleteMenuOpen]);

  const markPlotted = (filename: string) => {
    setPlottedFiles((prev) => {
      const next = new Set(prev).add(filename);
      savePlotted(next);
      return next;
    });
  };

  const removePlotted = (filenames: string[]) => {
    setPlottedFiles((prev) => {
      const next = new Set(prev);
      filenames.forEach((f) => next.delete(f));
      savePlotted(next);
      return next;
    });
  };

  const fail = (e: any) => setErr(String(e.message ?? e));

  const openPreview = (name: string) => {
    setErr(null);
    setPreview({ name, data: null });
    api.jobPreview3D(name).then((data) => setPreview({ name, data })).catch((e) => {
      setErr(String(e.message ?? e));
      setPreview(undefined);
    });
  };

  const send = async (name: string, start: boolean) => {
    try {
      await api.send(name, start);
      if (start) markPlotted(name);
      toast.success(start ? t("convert.sentStarted") : t("convert.sent"));
      onAction();
    } catch (e) { fail(e); }
  };

  const rename = async (name: string) => {
    const base = name.replace(/\.gcode$/i, "");
    const next = await prompt(t("convert.renamePrompt"), base);
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === base) return;
    api.renameJob(name, trimmed)
      .then((j) => { toast.success(t("convert.renamed", { file: j.filename })); refresh(); })
      .catch(fail);
  };

  const deleteSingle = (filename: string) => {
    api.deleteJob(filename)
      .then(() => { removePlotted([filename]); refresh(); })
      .catch(fail);
  };

  const octoReady = status?.online;
  const profileBlocked = (j: Job) => !!j.profile && !j.profile.matchesActive;

  const profileIssue = (j: Job): string | null => {
    if (!j.profile || j.profile.matchesActive) return null;
    if (j.profile.legacy) return t("convert.profileLegacyHint");
    if (j.profile.missing) return t("convert.profileMissingHint", { name: j.profile.name ?? "?" });
    if (j.profile.archived) return t("convert.profileArchivedHint", { name: j.profile.name ?? "?" });
    if (j.profile.stale) return t("convert.profileStaleHint");
    return t("convert.profileOtherHint", { name: j.profile.name ?? "?" });
  };

  const profileBadge = (j: Job): ReactNode => {
    if (!j.profile) return null;
    if (j.profile.legacy)
      return <span className="pbadge pbadge-muted" title={t("convert.profileLegacyHint")}>{t("convert.profileLegacy")}</span>;
    if (j.profile.missing)
      return <span className="pbadge pbadge-muted" title={t("convert.profileMissingHint", { name: j.profile.name ?? "?" })}>{t("convert.profileMissing")}</span>;
    if (j.profile.archived)
      return <span className="pbadge pbadge-muted" title={t("convert.profileArchivedHint", { name: j.profile.name ?? "?" })}>{t("convert.profileArchived")}</span>;
    if (j.profile.stale)
      return <span className="pbadge pbadge-warn" title={t("convert.profileStaleHint")}>{t("convert.profileStale")}</span>;
    if (!j.profile.matchesActive)
      return <span className="pbadge pbadge-other" title={t("convert.profileOtherHint", { name: j.profile.name ?? "?" })}>{j.profile.name}</span>;
    return <span className="pbadge pbadge-active">{j.profile.name}</span>;
  };

  // Filtering
  const profileJobs = onlyActiveProfile ? jobs.filter((j) => j.profile?.matchesActive) : jobs;
  const hiddenCount = jobs.length - profileJobs.length;
  const q = query.trim().toLowerCase();
  const visibleJobs = q ? profileJobs.filter((j) => j.filename.toLowerCase().includes(q)) : profileJobs;

  const groups = useMemo(() => buildGroups(visibleJobs, sortBy), [visibleJobs, sortBy]);

  const allVisibleFilenames = useMemo(
    () => new Set(visibleJobs.map((j) => j.filename)),
    [visibleJobs]
  );
  const plottedVisibleCount = useMemo(
    () => visibleJobs.filter((j) => plottedFiles.has(j.filename)).length,
    [visibleJobs, plottedFiles]
  );

  const toggleSelect = (filename: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  const toggleGroupSelect = (group: JobGroup) => {
    const allSel = group.jobs.every((j) => selectedIds.has(j.filename));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSel) group.jobs.forEach((j) => next.delete(j.filename));
      else group.jobs.forEach((j) => next.add(j.filename));
      return next;
    });
  };

  const toggleSelectMode = () => {
    if (selectMode) setSelectedIds(new Set());
    setSelectMode((s) => !s);
  };

  const executeDelete = async (mode: DeleteMode) => {
    setDeleteMenuOpen(false);
    let toDelete: string[];
    if (mode === "selected") {
      toDelete = [...selectedIds].filter((id) => allVisibleFilenames.has(id));
    } else if (mode === "plotted") {
      toDelete = [...allVisibleFilenames].filter((f) => plottedFiles.has(f));
    } else {
      toDelete = [...allVisibleFilenames];
    }
    if (toDelete.length === 0) return;

    const ok = await confirm(t("convert.deleteConfirm", { count: String(toDelete.length) }));
    if (!ok) return;

    await Promise.allSettled(toDelete.map((f) => api.deleteJob(f)));
    removePlotted(toDelete);
    if (mode === "selected") { setSelectedIds(new Set()); setSelectMode(false); }
    refresh();
    toast.success(t("convert.deleteSuccess", { count: String(toDelete.length) }));
  };

  // ---- render helpers ----

  const renderBadges = (j: Job) => (
    <>
      {j.source?.kind === "paint_coloring" && j.source.color && (
        <span className="job-color-badge" title={t("convert.colorJob")}>
          <span className="dot" style={{ background: COLOR_HEX[j.source.color] ?? "#888" }} />
          {j.source.color_order ? `${String(j.source.color_order).padStart(2, "0")} ` : ""}
          {j.source.color_label ?? j.source.color}
        </span>
      )}
      {profileBadge(j)}
      {plottedFiles.has(j.filename) && (
        <span className="pbadge pbadge-plotted" title={t("convert.plottedHint")}>
          {t("convert.plotted")}
        </span>
      )}
      {j.fits === false && (
        <span className="job-warn" title={j.issue ?? ""}>{t("convert.unfit")}</span>
      )}
    </>
  );

  const renderActions = (j: Job, compact = false) => {
    const unfit = j.fits === false;
    const blocked = profileBlocked(j);
    const blockTitle = profileIssue(j) ?? (unfit ? j.issue ?? t("convert.unfitShort") : "");
    return (
      <div className={compact ? "job-tile-actions" : "job-actions"}>
        <button className="ghost" title={t("convert.preview3d")} onClick={() => openPreview(j.filename)}>◰</button>
        {!compact && (
          <button className="ghost" title={t("common.rename")} onClick={() => rename(j.filename)}>✎</button>
        )}
        {!compact && <a href={`/api/jobs/${encodeURIComponent(j.filename)}`}>↓</a>}
        {!compact && (
          <button
            disabled={!octoReady || unfit || blocked}
            title={blockTitle || (octoReady ? "" : t("status.octoOffline"))}
            onClick={() => send(j.filename, false)}
          >
            {t("common.send")}
          </button>
        )}
        <button
          className="primary"
          disabled={!octoReady || unfit || blocked}
          title={blockTitle}
          onClick={() => send(j.filename, true)}
        >
          {t("common.print")}
        </button>
        <button className="ghost" onClick={() => deleteSingle(j.filename)}>✕</button>
      </div>
    );
  };

  const renderListJob = (j: Job, indented = false) => {
    const unfit = j.fits === false;
    const blocked = profileBlocked(j);
    const isSelected = selectedIds.has(j.filename);
    return (
      <li
        key={j.filename}
        className={[
          unfit ? "job-unfit" : "",
          blocked ? "job-foreign" : "",
          isSelected ? "job-selected" : "",
          indented ? "job-indented" : "",
        ].filter(Boolean).join(" ")}
      >
        {selectMode && (
          <button
            className={`job-check ${isSelected ? "checked" : ""}`}
            onClick={() => toggleSelect(j.filename)}
          />
        )}
        <button
          className="job-thumb-btn"
          title={t("convert.openPreview")}
          onClick={() => selectMode ? toggleSelect(j.filename) : openPreview(j.filename)}
        >
          <JobThumb filename={j.filename} />
        </button>
        <button
          className="job-meta job-open"
          title={t("convert.openPreview")}
          onClick={() => selectMode ? toggleSelect(j.filename) : openPreview(j.filename)}
        >
          <span className="name" title={j.filename}>{j.filename}</span>
          <span className="job-badges">
            {renderBadges(j)}
            {j.fits !== false && <span className="muted">{fmtSize(j.size)}</span>}
          </span>
        </button>
        {!selectMode && renderActions(j)}
      </li>
    );
  };

  const renderTileJob = (j: Job) => {
    const unfit = j.fits === false;
    const blocked = profileBlocked(j);
    const isSelected = selectedIds.has(j.filename);
    return (
      <div
        key={j.filename}
        className={[
          "job-tile",
          unfit ? "job-tile-unfit" : "",
          blocked ? "job-tile-foreign" : "",
          isSelected ? "job-tile-selected" : "",
        ].filter(Boolean).join(" ")}
      >
        <button
          className="job-tile-thumb"
          onClick={() => selectMode ? toggleSelect(j.filename) : openPreview(j.filename)}
        >
          <JobThumb filename={j.filename} />
          {isSelected && <span className="job-tile-check-icon">✓</span>}
        </button>
        <div className="job-tile-meta">
          <strong className="job-tile-name" title={j.filename}>{j.filename}</strong>
          <div className="job-badges">
            {renderBadges(j)}
            {j.fits !== false && <span className="muted">{fmtSize(j.size)}</span>}
          </div>
        </div>
        {!selectMode && renderActions(j, true)}
      </div>
    );
  };

  const renderColorGroupHeader = (group: JobGroup) => {
    const allSel = group.jobs.every((j) => selectedIds.has(j.filename));
    return (
      <li key={`${group.id}--hdr`} className="job-group-header-row">
        {selectMode && (
          <button
            className={`job-check ${allSel ? "checked" : ""}`}
            onClick={() => toggleGroupSelect(group)}
          />
        )}
        <div className="job-group-dots">
          {group.jobs.map((j) => (
            <span
              key={j.filename}
              className="job-group-dot"
              style={{ background: COLOR_HEX[j.source?.color ?? ""] ?? "#888" }}
            />
          ))}
        </div>
        <span className="job-group-label">{t("convert.colorGroup")}</span>
        <span className="muted">{t("convert.colorGroupCount", { count: String(group.jobs.length) })}</span>
      </li>
    );
  };

  return (
    <>
      <div className="jobs-page">
        <section className="card">
          <div className="jobs-head">
            <div>
              <h2>{t("convert.title")}</h2>
              <p className="muted">{t("convert.hint")}</p>
            </div>
          </div>

          {/* ---- toolbar ---- */}
          <div className="jobs-toolbar">
            <input
              className="jobs-search"
              type="search"
              placeholder={t("convert.search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Segmented<SortBy>
              className="jobs-sort-seg"
              value={sortBy}
              onChange={setSortBy}
              options={[
                { value: "date", label: t("convert.sortDate") },
                { value: "name", label: t("convert.sortName") },
                { value: "size", label: t("convert.sortSize") },
              ]}
            />
            <Segmented<ViewMode>
              className="jobs-view-seg"
              value={viewMode}
              onChange={setViewMode}
              options={[
                { value: "list", label: "≡" },
                { value: "tile", label: "⊞" },
              ]}
            />
          </div>

          {/* ---- filter + actions row ---- */}
          <div className="jobs-filter-row">
            <label className="check">
              <input
                type="checkbox"
                checked={onlyActiveProfile}
                onChange={(e) => setOnlyActiveProfile(e.target.checked)}
              />
              {t("convert.onlyActiveProfile")}
              {onlyActiveProfile && hiddenCount > 0 && (
                <span className="muted"> · {t("convert.hiddenJobs", { count: String(hiddenCount) })}</span>
              )}
            </label>
            <div className="jobs-actions-right">
              {selectMode && selectedIds.size > 0 && (
                <span className="muted jobs-select-count">
                  {t("convert.selected", { count: String(selectedIds.size) })}
                </span>
              )}
              {jobs.length > 0 && (
                <button className="ghost" onClick={toggleSelectMode}>
                  {selectMode ? t("convert.selectDone") : t("convert.selectMode")}
                </button>
              )}
              {jobs.length > 0 && (
                <div className="job-delete-wrap" ref={deleteMenuRef}>
                  <button
                    className="ghost job-delete-btn"
                    onClick={() => setDeleteMenuOpen((o) => !o)}
                  >
                    {t("convert.deleteMenu")} ▾
                  </button>
                  {deleteMenuOpen && (
                    <div className="job-delete-dropdown">
                      <button onClick={() => executeDelete("all")}>
                        {t("convert.deleteAll", { count: String(allVisibleFilenames.size) })}
                      </button>
                      <button
                        disabled={plottedVisibleCount === 0}
                        onClick={() => executeDelete("plotted")}
                      >
                        {t("convert.deletePlotted", { count: String(plottedVisibleCount) })}
                      </button>
                      <button
                        disabled={selectedIds.size === 0}
                        onClick={() => executeDelete("selected")}
                      >
                        {t("convert.deleteSelected", { count: String(selectedIds.size) })}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ---- empty states ---- */}
          {jobs.length === 0 && <p className="muted">{t("convert.noJobs")}</p>}
          {jobs.length > 0 && visibleJobs.length === 0 && q && (
            <p className="muted">{t("convert.noMatches")}</p>
          )}

          {/* ---- content ---- */}
          {visibleJobs.length > 0 && (
            viewMode === "tile" ? (
              <div className="jobs-tile-outer">
                {groups.map((group) =>
                  group.isColor ? (
                    <div key={group.id} className="job-color-group-tile">
                      <div className="job-group-tile-header">
                        {selectMode && (
                          <button
                            className={`job-check ${group.jobs.every((j) => selectedIds.has(j.filename)) ? "checked" : ""}`}
                            onClick={() => toggleGroupSelect(group)}
                          />
                        )}
                        <div className="job-group-dots">
                          {group.jobs.map((j) => (
                            <span
                              key={j.filename}
                              className="job-group-dot"
                              style={{ background: COLOR_HEX[j.source?.color ?? ""] ?? "#888" }}
                            />
                          ))}
                        </div>
                        <span className="job-group-label">{t("convert.colorGroup")}</span>
                        <span className="muted">· {t("convert.colorGroupCount", { count: String(group.jobs.length) })}</span>
                      </div>
                      <div className="job-group-tile-grid">
                        {group.jobs.map((j) => renderTileJob(j))}
                      </div>
                    </div>
                  ) : (
                    renderTileJob(group.jobs[0])
                  )
                )}
              </div>
            ) : (
              <ul className="jobs">
                {groups.flatMap((group) =>
                  group.isColor
                    ? [renderColorGroupHeader(group), ...group.jobs.map((j) => renderListJob(j, true))]
                    : [renderListJob(group.jobs[0])]
                )}
              </ul>
            )
          )}
        </section>

        {/* ---- preview modal ---- */}
        {preview &&
          (() => {
            const job = jobs.find((j) => j.filename === preview.name);
            const unfit = job?.fits === false;
            const blocked = job ? profileBlocked(job) : false;
            const blockTitle = job ? profileIssue(job) ?? (unfit ? job.issue ?? "" : "") : "";
            return (
              <>
                <Modal
                  title={
                    <>
                      {t("convert.preview3d")} · <span className="muted">{preview.name}</span>
                    </>
                  }
                  onClose={() => setPreview(undefined)}
                  footer={
                    <>
                      {(unfit || blocked) && (
                        <span className="job-warn" style={{ marginRight: "auto", alignSelf: "center" }}>
                          {blocked ? blockTitle : t("convert.unfit")}
                        </span>
                      )}
                      {preview.data &&
                        (preview.data.draws.length || preview.data.travels.length) ? (
                        <button onClick={() => setFullscreen(true)}>{t("convert.fullscreen")}</button>
                      ) : null}
                      <button
                        className="primary"
                        disabled={!octoReady || unfit || blocked}
                        title={blockTitle}
                        onClick={() => {
                          send(preview.name, false);
                          setPreview(undefined);
                        }}
                      >
                        {t("common.sendOcto")}
                      </button>
                    </>
                  }
                >
                  {preview.data ? (
                    preview.data.draws.length || preview.data.travels.length ? (
                      <Gcode3D data={preview.data} />
                    ) : (
                      <p className="muted">{t("convert.noMoves")}</p>
                    )
                  ) : (
                    <p className="muted">{t("convert.loadingPreview")}</p>
                  )}
                </Modal>
                {fullscreen && preview.data && (
                  <div className="g3d-fullscreen" onClick={() => setFullscreen(false)}>
                    <div className="g3d-fullscreen-view" onClick={(e) => e.stopPropagation()}>
                      <Gcode3D data={preview.data} chrome={false} />
                    </div>
                  </div>
                )}
              </>
            );
          })()}
      </div>
      {ConfirmNode}
      {PromptNode}
    </>
  );
}

function JobThumb({ filename }: { filename: string }) {
  const [preview, setPreview] = useState<GcodePreview | null>(jobThumbCache.get(filename) ?? null);

  useEffect(() => {
    if (preview) return;
    let alive = true;
    api
      .jobPreview(filename)
      .then((data) => {
        jobThumbCache.set(filename, data);
        if (alive) setPreview(data);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [filename, preview]);

  if (!preview) return <span className="job-thumb-placeholder">…</span>;
  return <GcodeThumbSvg preview={preview} />;
}

function GcodeThumbSvg({ preview }: { preview: GcodePreview }) {
  const bounds = preview.bounds ?? boundsFromPolylines([...preview.polylines, ...preview.travels]);
  if (!bounds) return <span className="job-thumb-placeholder">–</span>;

  const [x0, y0, x1, y1] = bounds;
  const width = Math.max(x1 - x0, 1);
  const height = Math.max(y1 - y0, 1);
  const pad = Math.max(width, height) * 0.05;
  const toPath = (lines: number[][][]) =>
    lines.map((line) => "M" + line.map(([x, y]) => `${x},${y}`).join("L")).join("");
  const strokeWidth = Math.max(width, height) / 180;

  return (
    <svg
      className="job-thumb-svg"
      viewBox={`${x0 - pad} ${y0 - pad} ${width + pad * 2} ${height + pad * 2}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <path d={toPath(preview.travels)} className="job-thumb-travel" fill="none" strokeWidth={strokeWidth} />
      <path d={toPath(preview.polylines)} className="job-thumb-draw" fill="none" strokeWidth={strokeWidth} />
    </svg>
  );
}

function boundsFromPolylines(lines: number[][][]): [number, number, number, number] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const line of lines) {
    for (const [x, y] of line) {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}
