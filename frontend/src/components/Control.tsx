import { useState } from "react";
import { api } from "../api";
import { useArrowKeys } from "../hooks";
import Segmented from "./Segmented";

export default function Control({
  status,
  onAction,
}: {
  status: any;
  onAction: () => void;
}) {
  const [step, setStep] = useState(10);
  const [limitPlot, setLimitPlot] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const online = status?.online;
  const job = status?.job;
  const progress = job?.progress?.completion;
  const printing = job?.state?.toLowerCase?.().includes("printing");
  const paused = job?.state?.toLowerCase?.().includes("paused");

  const run = (fn: () => Promise<any>) => fn().then(onAction).catch((e) => setErr(String(e.message)));

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
        <h2>Steuerung</h2>
        <p className="muted">
          OctoPrint ist offline oder nicht konfiguriert. Setze
          <code> OCTOPRINT_URL</code> und <code>OCTOPRINT_API_KEY</code>.
        </p>
      </div>
    );

  return (
    <div className="grid">
      <section className="card">
        <h2>Bewegung</h2>
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
          Tastatur: <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> bewegen ·{" "}
          <kbd>Bild↑</kbd><kbd>Bild↓</kbd> Z
        </p>
        <div className="pen-row">
          <button onClick={() => run(() => api.pen(false))}>Stift hoch</button>
          <button onClick={() => run(() => api.pen(true))}>Stift runter</button>
          <button onClick={() => run(() => api.home())}>Home alle</button>
        </div>
        <label className="switch-label" style={{ marginTop: 14, justifyContent: "flex-start" }}>
          <button
            className={`switch ${limitPlot ? "on" : ""}`}
            onClick={() => setLimitPlot(!limitPlot)}
            aria-pressed={limitPlot}
          >
            <i />
          </button>
          <span className="muted">
            Nur Plotbereich (XY im Papier, Z nicht unter Stift-unten)
          </span>
        </label>
        {err && <div className="banner err">{err}</div>}
      </section>

      <section className="card">
        <h2>Druck</h2>
        {job?.job?.file?.name ? (
          <p>
            <strong>{job.job.file.name}</strong>
            {progress != null && <> · {progress.toFixed(0)}%</>}
          </p>
        ) : (
          <p className="muted">Kein Job geladen.</p>
        )}
        {progress != null && (
          <div className="progress">
            <div style={{ width: `${progress}%` }} />
          </div>
        )}
        <div className="job-controls">
          {!printing && !paused && (
            <button className="primary" onClick={() => run(() => api.jobCommand("start"))}>
              ▶ Start
            </button>
          )}
          {printing && (
            <button onClick={() => run(() => api.jobCommand("pause"))}>⏸ Pause</button>
          )}
          {paused && (
            <button className="primary" onClick={() => run(() => api.jobCommand("pause"))}>
              ▶ Fortsetzen
            </button>
          )}
          {(printing || paused) && (
            <button className="danger" onClick={() => run(() => api.jobCommand("cancel"))}>
              ⏹ Abbrechen
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
