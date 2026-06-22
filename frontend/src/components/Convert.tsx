import { useEffect, useState } from "react";
import { api, type GcodePreview, type GcodePreview3D, type Job } from "../api";
import { useI18n } from "../i18n";
import Modal from "./Modal";
import Gcode3D from "./Gcode3D";
import { usePrompt } from "./dialogs";

const jobThumbCache = new Map<string, GcodePreview>();

// Pen-colour palette for coloring jobs (matches the coloring editor).
const COLOR_HEX: Record<string, string> = {
  black: "#111111", red: "#ff453a", blue: "#0a84ff", green: "#30d158",
};

function fmtSize(n: number) {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

export default function Convert({
  status,
  onAction,
  visible = true,
}: {
  status: any;
  onAction: () => void;
  visible?: boolean; // false while the tab is kept mounted but hidden
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ name: string; data: GcodePreview3D | null }>();
  const [fullscreen, setFullscreen] = useState(false);
  const [onlyActiveProfile, setOnlyActiveProfile] = useState(false);
  const [query, setQuery] = useState("");
  const { t } = useI18n();
  const { prompt, PromptNode } = usePrompt();

  const openPreview = (name: string) => {
    setPreview({ name, data: null });
    api
      .jobPreview3D(name)
      .then((data) => setPreview({ name, data }))
      .catch((e) => {
        setErr(String(e.message ?? e));
        setPreview(undefined);
      });
  };

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFullscreen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const refresh = () => api.listJobs().then(setJobs).catch(() => {});
  // The tab is kept mounted across switches; refresh whenever it becomes
  // visible so newly generated jobs show up without a full reload-on-click.
  useEffect(() => {
    if (visible) refresh();
  }, [visible]);

  const flash = (m: string) => {
    setMsg(m);
    setErr(null);
    setTimeout(() => setMsg(null), 4000);
  };
  const fail = (e: any) => setErr(String(e.message ?? e));

  const send = async (name: string, start: boolean) => {
    try {
      await api.send(name, start);
      flash(start ? t("convert.sentStarted") : t("convert.sent"));
      onAction();
    } catch (e) {
      fail(e);
    }
  };

  const rename = async (name: string) => {
    const base = name.replace(/\.gcode$/i, "");
    const next = await prompt(t("convert.renamePrompt"), base);
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === base) return;
    api
      .renameJob(name, trimmed)
      .then((j) => {
        flash(t("convert.renamed", { file: j.filename }));
        refresh();
      })
      .catch(fail);
  };

  const octoReady = status?.online;

  // The backend blocks sending for these anyway (409); the UI mirrors that
  // so users see *why* before they click.
  const profileBlocked = (j: Job) => !!j.profile && !j.profile.matchesActive;

  const profileIssue = (j: Job): string | null => {
    if (!j.profile || j.profile.matchesActive) return null;
    if (j.profile.legacy) return t("convert.profileLegacyHint");
    if (j.profile.missing) return t("convert.profileMissingHint", { name: j.profile.name ?? "?" });
    if (j.profile.archived) return t("convert.profileArchivedHint", { name: j.profile.name ?? "?" });
    if (j.profile.stale) return t("convert.profileStaleHint");
    return t("convert.profileOtherHint", { name: j.profile.name ?? "?" });
  };

  const profileBadge = (j: Job) => {
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
      return (
        <span className="pbadge pbadge-other" title={t("convert.profileOtherHint", { name: j.profile.name ?? "?" })}>
          {j.profile.name}
        </span>
      );
    return <span className="pbadge pbadge-active">{j.profile.name}</span>;
  };

  const profileJobs = onlyActiveProfile
    ? jobs.filter((j) => j.profile?.matchesActive)
    : jobs;
  const hiddenCount = jobs.length - profileJobs.length;
  const q = query.trim().toLowerCase();
  const visibleJobs = q
    ? profileJobs.filter((j) => j.filename.toLowerCase().includes(q))
    : profileJobs;

  return (
    <>
    <div className="single-col">
      <section className="card">
        <h2>{t("convert.title")}</h2>
        <p className="muted">{t("convert.hint")}</p>
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
        {jobs.length > 0 && (
          <input
            className="job-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("convert.search")}
          />
        )}
        {jobs.length === 0 && <p className="muted">{t("convert.noJobs")}</p>}
        {jobs.length > 0 && visibleJobs.length === 0 && q && (
          <p className="muted">{t("convert.noMatches")}</p>
        )}
        <ul className="jobs">
          {visibleJobs.map((j) => {
            const unfit = j.fits === false;
            const blocked = profileBlocked(j);
            const blockTitle = profileIssue(j) ?? (unfit ? j.issue ?? t("convert.unfitShort") : "");
            return (
              <li key={j.filename} className={(unfit ? "job-unfit" : "") + (blocked ? " job-foreign" : "")}>
                <button
                  className="job-thumb-btn"
                  title={t("convert.openPreview")}
                  onClick={() => openPreview(j.filename)}
                >
                  <JobThumb filename={j.filename} />
                </button>
                <button
                  className="job-meta job-open"
                  title={t("convert.openPreview")}
                  onClick={() => openPreview(j.filename)}
                >
                  <span className="name" title={j.filename}>{j.filename}</span>
                  <span className="job-badges">
                    {j.source?.kind === "paint_coloring" && j.source.color && (
                      <span className="job-color-badge" title={t("convert.colorJob")}>
                        <span className="dot" style={{ background: COLOR_HEX[j.source.color] ?? "#888" }} />
                        {j.source.color_order ? `${String(j.source.color_order).padStart(2, "0")} ` : ""}
                        {j.source.color_label ?? j.source.color}
                      </span>
                    )}
                    {profileBadge(j)}
                    {unfit ? (
                      <span className="job-warn" title={j.issue ?? ""}>
                        {t("convert.unfit")}
                      </span>
                    ) : (
                      <span className="muted">{fmtSize(j.size)} · {t("convert.preview3d")}</span>
                    )}
                  </span>
                </button>
                <div className="job-actions">
                  <button
                    className="ghost"
                    title={t("convert.preview3d")}
                    onClick={() => openPreview(j.filename)}
                  >
                    ◰
                  </button>
                  <button
                    className="ghost"
                    title={t("common.rename")}
                    onClick={() => rename(j.filename)}
                  >
                    ✎
                  </button>
                  <a href={`/api/jobs/${encodeURIComponent(j.filename)}`}>↓</a>
                  <button
                    disabled={!octoReady || unfit || blocked}
                    title={blockTitle || (octoReady ? "" : t("status.octoOffline"))}
                    onClick={() => send(j.filename, false)}
                  >
                    {t("common.send")}
                  </button>
                  <button
                    className="primary"
                    disabled={!octoReady || unfit || blocked}
                    title={blockTitle}
                    onClick={() => send(j.filename, true)}
                  >
                    {t("common.print")}
                  </button>
                  <button
                    className="ghost"
                    onClick={() =>
                      api.deleteJob(j.filename).then(refresh).catch(fail)
                    }
                  >
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {msg && <div className="banner ok">{msg}</div>}
        {err && <div className="banner err">{err}</div>}
      </section>

      {preview && (() => {
        const job = jobs.find((j) => j.filename === preview.name);
        const unfit = job?.fits === false;
        const blocked = job ? profileBlocked(job) : false;
        const blockTitle = job ? profileIssue(job) ?? (unfit ? job.issue ?? "" : "") : "";
        return (
        <>
        <Modal
          title={<>{t("convert.preview3d")} · <span className="muted">{preview.name}</span></>}
          onClose={() => setPreview(undefined)}
          footer={
            <>
              {(unfit || blocked) && (
                <span className="job-warn" style={{ marginRight: "auto", alignSelf: "center" }}>
                  {blocked ? blockTitle : t("convert.unfit")}
                </span>
              )}
              {preview.data && (preview.data.draws.length || preview.data.travels.length) && (
                <button onClick={() => setFullscreen(true)}>{t("convert.fullscreen")}</button>
              )}
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
    return () => {
      alive = false;
    };
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
  const toPath = (lines: number[][][]) => lines.map((line) => "M" + line.map(([x, y]) => `${x},${y}`).join("L")).join("");
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
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const line of lines) {
    for (const [x, y] of line) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}
