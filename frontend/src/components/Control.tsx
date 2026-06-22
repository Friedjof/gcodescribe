import { useEffect, useState } from "react";
import { api, type SerialPortCandidate } from "../api";
import { useArrowKeys } from "../hooks";
import { useI18n } from "../i18n";
import Segmented from "./Segmented";
import { useToasts } from "./Toasts";

type Backend = { id: string; configured: boolean; online: boolean; active: boolean };

function PrinterOverview({ status, onAction }: { status: any; onAction: () => void }) {
  const { t } = useI18n();
  const [backends, setBackends] = useState<Backend[]>([]);
  const [busy, setBusy] = useState(false);

  const load = () => api.listBackends().then(setBackends).catch(() => {});
  useEffect(() => {
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, []);

  const configured = backends.filter((b) => b.configured);
  if (configured.length === 0) return null;

  const job = status?.job;
  const jobRunning = ["printing", "paused"].some((s) =>
    job?.state?.toLowerCase?.().includes(s)
  );

  const activate = (id: string) => {
    if (busy) return;
    setBusy(true);
    api
      .setBackend(id)
      .then(() => {
        load();
        onAction();
      })
      .catch(() => {})
      .finally(() => setBusy(false));
  };

  // Live activity is only known for the active backend (single-active model).
  const activity = (b: Backend): string => {
    if (!b.active) return b.online ? t("printer.state.ready") : t("printer.state.offline");
    const state = job?.state?.toLowerCase?.() ?? "";
    if (state.includes("printing")) {
      const pct = job?.progress?.completion;
      return t("printer.printingPct", { pct: pct != null ? pct.toFixed(0) : "?" });
    }
    if (state.includes("paused")) return t("printer.paused");
    return t("printer.idle");
  };

  return (
    <div className="printer-overview">
      <div className="muted printer-overview-head">{t("control.printersHeading")}</div>
      <div className="printer-cards">
        {configured.map((b) => (
          <div key={b.id} className={`printer-card${b.active ? " active" : ""}`}>
            <div className="printer-card-top">
              <span className="dot" data-online={b.online} />
              <strong>{t(`printer.backend.${b.id}`)}</strong>
              {b.active && (
                <span className="pbadge pbadge-active">{t("printer.state.active")}</span>
              )}
            </div>
            <div className="muted printer-card-activity">{activity(b)}</div>
            {b.active && job?.job?.file?.name && (
              <div className="muted printer-card-job">{job.job.file.name}</div>
            )}
            {!b.active && (
              <button
                className="printer-activate"
                disabled={busy || jobRunning}
                title={jobRunning ? t("printer.switchBlocked") : ""}
                onClick={() => activate(b.id)}
              >
                {t("printer.activate")}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SerialPortHint() {
  const { t } = useI18n();
  const [ports, setPorts] = useState<SerialPortCandidate[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = () => {
    setLoading(true);
    api.listSerialPorts().then(setPorts).catch(() => setPorts([])).finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  return (
    <div className="serial-port-hint">
      <button onClick={refresh} disabled={loading}>
        {loading ? t("serial.scanning") : t("serial.rescan")}
      </button>
      {ports.length === 0 ? (
        <p className="muted">{t("serial.noPorts")}</p>
      ) : (
        <ul className="serial-port-list">
          {ports.map((p) => (
            <li key={p.byId ?? p.device}>
              <code>{p.byId ?? p.device}</code>
              {p.likelyPrinter && <span className="pbadge pbadge-active">{t("serial.likelyPrinter")}</span>}
              <span className="muted">{p.description || p.manufacturer || p.device}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Control({
  status,
  onAction,
}: {
  status: any;
  onAction: () => void;
}) {
  const { t } = useI18n();
  const toast = useToasts();
  const [step, setStep] = useState(10);
  const [limitPlot, setLimitPlot] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const online = status?.online;
  const job = status?.job;
  const progress = job?.progress?.completion;
  const printing = job?.state?.toLowerCase?.().includes("printing");
  const paused = job?.state?.toLowerCase?.().includes("paused");

  const run = (fn: () => Promise<any>) => {
    setErr(null);
    return fn().then(onAction).catch((e) => setErr(String(e.message)));
  };

  useEffect(() => {
    if (err) toast.error(err);
  }, [err, toast]);

  const jog = (x: number, y: number, z: number) =>
    run(() =>
      api.jog(x * step, y * step, z * step, { limit: limitPlot ? "plot" : "bed" })
    );

  const pressed = useArrowKeys(
    {
      left: () => jog(-1, 0, 0),
      right: () => jog(1, 0, 0),
      up: () => jog(0, 1, 0),
      down: () => jog(0, -1, 0),
      raise: () => jog(0, 0, 1),
      lower: () => jog(0, 0, -1),
    },
    online
  );
  const kbd = (dir: string) => (pressed === dir ? " kbd-active" : "");

  if (!online)
    return (
      <div className="card">
        <h2>{t("control.title")}</h2>
        <PrinterOverview status={status} onAction={onAction} />
        {status?.backend === "serial" ? (
          <>
            <p className="muted">
              {t("control.offlineHintSerial")}
              <code> PRINTER_SERIAL_PORT</code>.
            </p>
            <SerialPortHint />
          </>
        ) : (
          <p className="muted">
            {t("control.offlineHint")}
            <code> OCTOPRINT_URL</code> {t("common.and")} <code>OCTOPRINT_API_KEY</code>.
          </p>
        )}
      </div>
    );

  return (
    <div className="grid">
      <section className="card">
        <h2>{t("control.motion")}</h2>
        <PrinterOverview status={status} onAction={onAction} />
        <Segmented
          value={step}
          onChange={setStep}
          options={[0.1, 1, 10, 50].map((s) => ({ value: s, label: `${s} mm` }))}
        />
        <div className="jog">
          <div className="xy">
            <button onClick={() => jog(0, 1, 0)} className={"up" + kbd("up")}>↑ Y+</button>
            <button onClick={() => jog(-1, 0, 0)} className={"left" + kbd("left")}>← X-</button>
            <button onClick={() => run(() => api.home(["x", "y"]))} className="home">⌂</button>
            <button onClick={() => jog(1, 0, 0)} className={"right" + kbd("right")}>X+ →</button>
            <button onClick={() => jog(0, -1, 0)} className={"down" + kbd("down")}>↓ Y-</button>
          </div>
          <div className="z">
            <button onClick={() => jog(0, 0, 1)} className={kbd("raise").trim()}>Z+ ↑</button>
            <button onClick={() => run(() => api.home(["z"]))} className="home">⌂ Z</button>
            <button onClick={() => jog(0, 0, -1)} className={kbd("lower").trim()}>Z- ↓</button>
          </div>
        </div>
        <p className="muted kbd-hint">
          {t("common.keyboard")}: <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> {t("control.kbdMove")} ·{" "}
          <kbd>{t("common.pageUpKey")}</kbd><kbd>{t("common.pageDownKey")}</kbd> Z
        </p>
        <div className="pen-row">
          <button onClick={() => run(() => api.pen(false))}>{t("control.penUp")}</button>
          <button onClick={() => run(() => api.pen(true))}>{t("control.penDown")}</button>
          <button onClick={() => run(() => api.home())}>{t("control.homeAll")}</button>
        </div>
        <label className="switch-label" style={{ marginTop: 14, justifyContent: "flex-start" }}>
          <button
            className={`switch ${limitPlot ? "on" : ""}`}
            onClick={() => setLimitPlot(!limitPlot)}
            aria-pressed={limitPlot}
          >
            <i />
          </button>
          <span className="muted">{t("control.limitPlot")}</span>
        </label>
      </section>

      <section className="card">
        <h2>{t("control.print")}</h2>
        {job?.job?.file?.name ? (
          <p>
            <strong>{job.job.file.name}</strong>
            {progress != null && <> · {progress.toFixed(0)}%</>}
          </p>
        ) : (
          <p className="muted">{t("control.noJob")}</p>
        )}
        {progress != null && (
          <div className="progress">
            <div style={{ width: `${progress}%` }} />
          </div>
        )}
        <div className="job-controls">
          {!printing && !paused && (
            <button className="primary" onClick={() => run(() => api.jobCommand("start"))}>
              ▶ {t("control.start")}
            </button>
          )}
          {printing && (
            <button onClick={() => run(() => api.jobCommand("pause"))}>⏸ {t("control.pause")}</button>
          )}
          {paused && (
            <button className="primary" onClick={() => run(() => api.jobCommand("resume"))}>
              ▶ {t("control.resume")}
            </button>
          )}
          {(printing || paused) && (
            <button className="danger" onClick={() => run(() => api.jobCommand("cancel"))}>
              ⏹ {t("control.cancel")}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
