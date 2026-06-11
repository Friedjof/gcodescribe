import { useEffect, useState } from "react";
import { api, type GcodePreview3D, type Job } from "../api";
import { useI18n } from "../i18n";
import Modal from "./Modal";
import Gcode3D from "./Gcode3D";

function fmtSize(n: number) {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

export default function Convert({
  status,
  onAction,
}: {
  status: any;
  onAction: () => void;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ name: string; data: GcodePreview3D | null }>();
  const [fullscreen, setFullscreen] = useState(false);
  const { t } = useI18n();

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
  useEffect(() => {
    refresh();
  }, []);

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

  const rename = (name: string) => {
    const base = name.replace(/\.gcode$/i, "");
    const next = window.prompt(t("convert.renamePrompt"), base);
    if (next == null) return; // cancelled
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

  return (
    <div className="single-col">
      <section className="card">
        <h2>{t("convert.title")}</h2>
        <p className="muted">{t("convert.hint")}</p>
        {jobs.length === 0 && <p className="muted">{t("convert.noJobs")}</p>}
        <ul className="jobs">
          {jobs.map((j) => {
            const unfit = j.fits === false;
            return (
              <li key={j.filename} className={unfit ? "job-unfit" : ""}>
                <button
                  className="job-meta job-open"
                  title={t("convert.openPreview")}
                  onClick={() => openPreview(j.filename)}
                >
                  <span className="name">{j.filename}</span>
                  {unfit ? (
                    <span className="job-warn" title={j.issue ?? ""}>
                      {t("convert.unfit")}
                    </span>
                  ) : (
                    <span className="muted">{fmtSize(j.size)} · {t("convert.preview3d")}</span>
                  )}
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
                    disabled={!octoReady || unfit}
                    title={
                      unfit
                        ? j.issue ?? t("convert.unfitShort")
                        : octoReady
                        ? ""
                        : t("status.octoOffline")
                    }
                    onClick={() => send(j.filename, false)}
                  >
                    {t("common.send")}
                  </button>
                  <button
                    className="primary"
                    disabled={!octoReady || unfit}
                    title={unfit ? j.issue ?? t("convert.unfitShort") : ""}
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
        return (
        <>
        <Modal
          title={<>{t("convert.preview3d")} · <span className="muted">{preview.name}</span></>}
          onClose={() => setPreview(undefined)}
          footer={
            <>
              {unfit && (
                <span className="job-warn" style={{ marginRight: "auto", alignSelf: "center" }}>
                  {t("convert.unfit")}
                </span>
              )}
              {preview.data && (preview.data.draws.length || preview.data.travels.length) && (
                <button onClick={() => setFullscreen(true)}>{t("convert.fullscreen")}</button>
              )}
              <button
                className="primary"
                disabled={!octoReady || unfit}
                title={unfit ? job?.issue ?? "" : ""}
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
  );
}
