import { useCallback, useEffect, useState } from "react";
import {
  api,
  type Calibration,
  type GcodePreview,
  type Job,
  type PaperState,
  type Position,
} from "../api";
import LiveView from "./LiveView";
import Segmented from "./Segmented";
import { useArrowKeys } from "../hooks";

const CORNERS: { id: string; label: string }[] = [
  { id: "tl", label: "↖ oben links" },
  { id: "tr", label: "↗ oben rechts" },
  { id: "bl", label: "↙ unten links" },
  { id: "br", label: "↘ unten rechts" },
];

const XY_STEPS = [0.1, 1, 10, 50];
const Z_STEPS = [0.05, 0.1, 0.5, 1, 5];

export default function Paper({
  status,
  onAction,
}: {
  status: any;
  onAction: () => void;
}) {
  const [cal, setCal] = useState<Calibration | null>(null);
  const [rect, setRect] = useState<[number, number, number, number] | null>(null);
  const [pos, setPos] = useState<Position | null>(null);
  const [active, setActive] = useState(1);
  const [xyStep, setXyStep] = useState(10);
  const [zStep, setZStep] = useState(0.1);
  const [clickMove, setClickMove] = useState(false);
  const [margin, setMargin] = useState(5);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [previewJob, setPreviewJob] = useState("");
  const [preview, setPreview] = useState<GcodePreview | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const online = status?.online;
  const homed = !!pos?.homed;
  // Derived from persisted calibration, so it survives tab switches & restarts.
  const heightSaved = !!cal?.pen_calibrated;

  const applyPaperState = (s: PaperState) => {
    setCal(s.calibration);
    setRect(s.rect);
  };

  const refreshPosition = useCallback(
    () => api.position().then(setPos).catch(() => setPos(null)),
    []
  );

  useEffect(() => {
    api
      .paper()
      .then((s) => {
        applyPaperState(s);
        setMargin(s.calibration.paper_margin ?? 5);
      })
      .catch((e) => setErr(String(e.message)));
    api.listJobs().then(setJobs).catch(() => {});
    refreshPosition();
    const id = setInterval(refreshPosition, 2000);
    return () => clearInterval(id);
  }, [refreshPosition]);

  useEffect(() => {
    if (!previewJob) {
      setPreview(null);
      return;
    }
    api.jobPreview(previewJob).then(setPreview).catch((e) => setErr(String(e.message)));
  }, [previewJob]);

  const flash = (m: string) => {
    setMsg(m);
    setErr(null);
    setTimeout(() => setMsg(null), 4000);
  };
  const fail = (e: any) => setErr(String(e.message ?? e));
  const run = (fn: () => Promise<any>) => fn().then(refreshPosition).catch(fail);

  const jogXY = (x: number, y: number) => run(() => api.jog(x * xyStep, y * xyStep, 0));
  const jogZ = (dz: number) => run(() => api.jog(0, 0, dz * zStep));

  // Arrow keys: XY while setting corners (step 3), Z height (step 2 & 3).
  // NOTE: must run on every render (before any early return) per hook rules.
  const pressed = useArrowKeys(
    {
      left: active === 3 ? () => jogXY(-1, 0) : undefined,
      right: active === 3 ? () => jogXY(1, 0) : undefined,
      up: active === 3 ? () => jogXY(0, 1) : undefined,
      down: active === 3 ? () => jogXY(0, -1) : undefined,
      raise: homed ? () => jogZ(1) : undefined,
      lower: homed ? () => jogZ(-1) : undefined,
    },
    online && (active === 2 || active === 3)
  );
  const kbd = (dir: string) => (pressed === dir ? " kbd-active" : "");

  if (!cal) return <div className="card">Lade…</div>;

  const homeAll = () =>
    api
      .home()
      .then(() => {
        refreshPosition();
        flash("Genullt — Position ist jetzt exakt (0, 0, 0).");
        setActive(2);
      })
      .catch(fail);

  const savePenHeight = (which: "up" | "down") =>
    api
      .penFromPosition(which)
      .then((c) => {
        setCal(c);
        flash(
          which === "down"
            ? `Stift unten = Z ${c.pen_down_z.toFixed(2)} mm gespeichert.`
            : `Stift oben = Z ${c.pen_up_z.toFixed(2)} mm gespeichert.`
        );
      })
      .catch(fail);

  // Set a pen height directly by typing the Z value (no jogging needed).
  const setPenHeightValue = (which: "up" | "down", z: number) => {
    const updates =
      which === "down"
        ? { pen_down_z: z, pen_calibrated: true }
        : { pen_up_z: z };
    api
      .saveCalibration(updates)
      .then((c) => setCal(c))
      .catch(fail);
  };

  const capture = (corner: string) =>
    api
      .setCorner(corner)
      .then((s) => {
        applyPaperState(s);
        flash(`Ecke ${corner.toUpperCase()} gespeichert.`);
      })
      .catch(fail);

  const clearCorner = (corner: string) =>
    api.clearCorner(corner).then(applyPaperState).catch(fail);
  const resetCorners = () => api.resetPaper().then(applyPaperState).catch(fail);

  const apply = () =>
    api
      .applyPaper(margin)
      .then((s) => {
        applyPaperState(s);
        flash("Plotbereich auf das Papier gesetzt — Konvertierungen mappen jetzt darauf.");
        onAction();
      })
      .catch(fail);

  const plotFrame = () =>
    api
      .testPattern("frame")
      .then((j) => api.send(j.filename, true))
      .then(() => {
        flash("Test-Rahmen wird geplottet.");
        onAction();
      })
      .catch(fail);

  const moveTo = (x: number, y: number) => run(() => api.move(x, y));

  // The backend always lifts the pen to pen_up_z before the XY travel.
  const driveToCorner = (corner: string, target: "paper" | "plot") =>
    run(() => api.moveToCorner(corner, target));

  const capturedCount = Object.keys(cal.paper_corners ?? {}).length;

  const steps = [
    { n: 1, title: "Papier auflegen & nullen", done: homed, locked: false },
    // Openable once homed OR a height is already saved, so you can always come
    // back to test / re-adjust the pen height (movements still need homing).
    { n: 2, title: "Stift-Höhe einstellen", done: heightSaved, locked: !homed && !heightSaved },
    { n: 3, title: "Papierecken setzen", done: !!rect, locked: !homed },
    { n: 4, title: "Als Plotbereich übernehmen", done: false, locked: !rect },
  ];

  return (
    <div className="grid paper-grid">
      <section className="card">
        <h2>Live-Ansicht</h2>
        <LiveView
          cal={cal}
          position={pos}
          rect={rect}
          preview={preview}
          onMoveTo={clickMove && homed ? moveTo : undefined}
        />
        <div className="legend">
          <span><i className="sw paper" /> Papier</span>
          <span><i className="sw plot" /> Plotbereich</span>
          <span><i className="sw corner" /> Ecke</span>
          <span><i className="sw head" /> Stift</span>
          {preview && <span><i className="sw draw" /> Vorschau</span>}
        </div>
        <div className="pos-readout">
          {homed && pos ? (
            <>
              <span>X <strong>{pos.x.toFixed(1)}</strong></span>
              <span>Y <strong>{pos.y.toFixed(1)}</strong></span>
              <span>Z <strong>{pos.z.toFixed(2)}</strong></span>
            </>
          ) : (
            <span className="muted">Position unbekannt — bitte nullen (Schritt 1).</span>
          )}
          <label className="switch-label">
            <span className="muted">Klick fährt an</span>
            <button
              className={`switch ${clickMove ? "on" : ""}`}
              disabled={!homed}
              onClick={() => setClickMove(!clickMove)}
              aria-pressed={clickMove}
            >
              <i />
            </button>
          </label>
        </div>

        <div className="field-group" style={{ marginTop: 16 }}>
          <h3>G-code-Vorschau (Mapping)</h3>
          <div className="preview-row">
            <select value={previewJob} onChange={(e) => setPreviewJob(e.target.value)}>
              <option value="">— Job wählen —</option>
              {jobs.map((j) => (
                <option key={j.filename} value={j.filename}>{j.filename}</option>
              ))}
            </select>
            <button className="ghost" onClick={() => api.listJobs().then(setJobs).catch(() => {})}>
              ⟳
            </button>
          </div>
          {preview?.truncated && <p className="muted">Vorschau gekürzt (sehr großer Job).</p>}
        </div>
      </section>

      <section className="card">
        <h2>Papier kalibrieren</h2>
        {!online && (
          <div className="banner err" style={{ marginBottom: 14 }}>
            OctoPrint ist offline — Bewegung nicht möglich.
          </div>
        )}

        <div className="wizard">
          {steps.map((s) => (
            <div key={s.n} className={`wstep ${s.locked ? "locked" : ""} ${active === s.n ? "open" : ""}`}>
              <button
                className="wstep-head"
                disabled={s.locked}
                onClick={() => setActive(s.n)}
              >
                <span className={`badge ${s.done ? "done" : ""}`}>
                  {s.done ? "✓" : s.locked ? "🔒" : s.n}
                </span>
                <span className="wstep-title">{s.title}</span>
              </button>

              {active === s.n && !s.locked && (
                <div className="wstep-body">
                  {s.n === 1 && (
                    <>
                      <p className="muted">
                        Blatt aufs Bett legen (z. B. mit Klebeband fixieren), dann alle
                        Achsen nullen. Danach ist die Kopfposition exakt bekannt — auch
                        nach einem Neustart der Anwendung.
                      </p>
                      <button className="primary big" disabled={!online} onClick={homeAll}>
                        ⌂ Home XYZ
                      </button>
                    </>
                  )}

                  {s.n === 2 && (
                    <>
                      {heightSaved && (
                        <div className="banner ok" style={{ marginTop: 0, marginBottom: 12 }}>
                          ✓ Stift-Höhe eingerichtet — unten {cal.pen_down_z.toFixed(2)} mm,
                          oben {cal.pen_up_z.toFixed(2)} mm. Unten testen oder neu justieren.
                        </div>
                      )}
                      {!homed && (
                        <div className="banner warn-inline">
                          <span>
                            Zum Testen und Anfahren erst homen — sonst kennt der Drucker
                            die Z-Null nicht. Die Höhen lassen sich aber direkt eintippen.
                          </span>
                          <button
                            className="primary"
                            disabled={!online}
                            onClick={homeAll}
                          >
                            ⌂ Home XYZ
                          </button>
                        </div>
                      )}
                      <p className="muted">
                        Stift in kleinen Schritten absenken, bis er das Papier gerade
                        berührt, dann als <strong>Stift unten</strong> speichern. Oder die
                        Höhen direkt eintippen.
                      </p>
                      <div className="z-panel">
                        <div className="z-readout">
                          <span className="muted">Aktuelle Z</span>
                          <strong>{homed && pos ? `${pos.z.toFixed(2)} mm` : "— (nicht gehomet)"}</strong>
                        </div>
                        <Segmented
                          value={zStep}
                          onChange={setZStep}
                          options={Z_STEPS.map((st) => ({ value: st, label: st }))}
                        />
                        <div className="z-buttons">
                          <button className={"big" + kbd("raise")} disabled={!online || !homed} onClick={() => jogZ(1)}>
                            Z + {zStep}
                          </button>
                          <button className={"big" + kbd("lower")} disabled={!online || !homed} onClick={() => jogZ(-1)}>
                            Z − {zStep}
                          </button>
                        </div>
                        {homed && (
                          <p className="muted kbd-hint">
                            Tastatur: <kbd>Bild↑</kbd><kbd>Bild↓</kbd> Z bewegen
                          </p>
                        )}
                        <div className="save-row">
                          <button disabled={!online || !homed} onClick={() => savePenHeight("down")}>
                            ✓ Aktuelle Z als <strong>Stift unten</strong>
                          </button>
                          <button disabled={!online || !homed} onClick={() => savePenHeight("up")}>
                            ✓ Aktuelle Z als <strong>Stift oben</strong>
                          </button>
                        </div>
                      </div>

                      <div className="height-fields">
                        <label className="field">
                          <span>Stift unten (Z)</span>
                          <div className="input-unit">
                            <input
                              type="number"
                              step="0.05"
                              value={cal.pen_down_z}
                              onChange={(e) =>
                                setPenHeightValue("down", parseFloat(e.target.value) || 0)
                              }
                            />
                            <em>mm</em>
                          </div>
                        </label>
                        <label className="field">
                          <span>Stift oben (Z)</span>
                          <div className="input-unit">
                            <input
                              type="number"
                              step="0.05"
                              value={cal.pen_up_z}
                              onChange={(e) =>
                                setPenHeightValue("up", parseFloat(e.target.value) || 0)
                              }
                            />
                            <em>mm</em>
                          </div>
                        </label>
                      </div>

                      <div className="save-row" style={{ marginTop: 4 }}>
                        <button
                          disabled={!online || !homed || !heightSaved}
                          title={
                            !heightSaved
                              ? "Erst eine Stift-unten-Höhe einrichten"
                              : !homed
                              ? "Erst homen (oben)"
                              : "Fährt Z auf die gespeicherte Stift-unten-Höhe"
                          }
                          onClick={() => run(() => api.pen(true))}
                        >
                          ↓ Test: Stift senken
                        </button>
                        <button
                          disabled={!online || !homed || !heightSaved}
                          title={
                            !heightSaved
                              ? "Erst eine Stift-unten-Höhe einrichten"
                              : !homed
                              ? "Erst homen (oben)"
                              : "Fährt Z auf die gespeicherte Stift-oben-Höhe"
                          }
                          onClick={() => run(() => api.pen(false))}
                        >
                          ↑ Test: Stift heben
                        </button>
                      </div>

                      <button className="primary" onClick={() => setActive(3)}>
                        Weiter zu den Ecken →
                      </button>
                    </>
                  )}

                  {s.n === 3 && (
                    <>
                      <p className="muted">
                        Den Stift exakt über eine Papierecke fahren (Jog-Pad oder
                        „Klick fährt an“ in der Live-Ansicht aktivieren), dann die Ecke
                        speichern. Zwei diagonale Ecken reichen, vier sind genauer.
                      </p>
                      <Segmented
                        value={xyStep}
                        onChange={setXyStep}
                        options={XY_STEPS.map((st) => ({ value: st, label: st }))}
                        suffix={<em className="muted">mm</em>}
                      />
                      <div className="jog compact">
                        <div className="xy">
                          <button disabled={!online} onClick={() => jogXY(0, 1)} className={"up" + kbd("up")}>↑</button>
                          <button disabled={!online} onClick={() => jogXY(-1, 0)} className={"left" + kbd("left")}>←</button>
                          <span className="pad-center" />
                          <button disabled={!online} onClick={() => jogXY(1, 0)} className={"right" + kbd("right")}>→</button>
                          <button disabled={!online} onClick={() => jogXY(0, -1)} className={"down" + kbd("down")}>↓</button>
                        </div>
                        <div className="z">
                          <button disabled={!online} onClick={() => run(() => api.pen(true))}>Stift ↓</button>
                          <button disabled={!online} onClick={() => run(() => api.pen(false))}>Stift ↑</button>
                        </div>
                      </div>
                      <p className="muted kbd-hint">
                        Tastatur: <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> bewegen
                        {homed && <> · <kbd>Bild↑</kbd><kbd>Bild↓</kbd> Z</>}
                      </p>
                      <div className="corner-grid">
                        {CORNERS.map((c) => {
                          const captured = cal.paper_corners?.[c.id];
                          return (
                            <div key={c.id} className={`corner ${captured ? "set" : ""}`}>
                              <button disabled={!online || !homed} onClick={() => capture(c.id)}>
                                {c.label}
                              </button>
                              {captured ? (
                                <span className="coords">
                                  {captured[0].toFixed(1)} / {captured[1].toFixed(1)}
                                  <button
                                    className="ghost tiny"
                                    disabled={!online}
                                    title="Ecke anfahren — Stift wird zuerst angehoben"
                                    onClick={() => driveToCorner(c.id, "paper")}
                                  >
                                    ➜
                                  </button>
                                  <button className="ghost tiny" onClick={() => clearCorner(c.id)}>✕</button>
                                </span>
                              ) : (
                                <span className="coords muted">—</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div className="save-row">
                        {capturedCount > 0 && (
                          <button className="ghost" onClick={resetCorners}>Ecken zurücksetzen</button>
                        )}
                        <button className="primary" disabled={!rect} onClick={() => setActive(4)}>
                          Weiter →
                        </button>
                      </div>
                    </>
                  )}

                  {s.n === 4 && (
                    <>
                      <p className="muted">
                        {rect
                          ? `Erfasstes Papier: ${rect[2].toFixed(1)} × ${rect[3].toFixed(1)} mm ab (${rect[0].toFixed(1)}, ${rect[1].toFixed(1)}).`
                          : "Noch kein Papier erfasst."}{" "}
                        Konvertierte PDFs werden in diesen Bereich eingepasst.
                      </p>
                      <div className="apply-row">
                        <label className="field">
                          <span>Rand</span>
                          <div className="input-unit">
                            <input
                              type="number" step="1" min="0" value={margin}
                              onChange={(e) => setMargin(parseFloat(e.target.value) || 0)}
                            />
                            <em>mm</em>
                          </div>
                        </label>
                        <button className="primary" disabled={!rect} onClick={apply}>
                          Übernehmen
                        </button>
                        <button
                          disabled={!online || !rect}
                          onClick={plotFrame}
                          title="Plottet den Umriss des Plotbereichs"
                        >
                          Rahmen testen
                        </button>
                        <a className="btn-link" href="/api/calibration/export" download>
                          ↓ Export (XML)
                        </a>
                      </div>
                      <div className="field-group" style={{ marginTop: 14 }}>
                        <h3>Plotbereich-Ecken anfahren</h3>
                        <p className="muted" style={{ margin: "0 0 8px" }}>
                          Stift wird immer zuerst auf „oben“ gehoben, dann angefahren.
                        </p>
                        <div className="save-row">
                          {CORNERS.map((c) => (
                            <button
                              key={c.id}
                              disabled={!online || !homed}
                              onClick={() => driveToCorner(c.id, "plot")}
                            >
                              {c.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {msg && <div className="banner ok">{msg}</div>}
        {err && <div className="banner err">{err}</div>}
      </section>
    </div>
  );
}
