import { useCallback, useEffect, useState } from "react";
import {
  api,
  type Calibration,
  type GcodePreview,
  type Job,
  type Obstacle,
  type PaperState,
  type Position,
} from "../api";
import LiveView from "./LiveView";
import Segmented from "./Segmented";
import { useArrowKeys } from "../hooks";
import { useI18n } from "../i18n";
import { useToasts } from "./Toasts";

const CORNERS: { id: string; labelKey: string }[] = [
  { id: "tl", labelKey: "paper.cornerTL" },
  { id: "tr", labelKey: "paper.cornerTR" },
  { id: "bl", labelKey: "paper.cornerBL" },
  { id: "br", labelKey: "paper.cornerBR" },
];

const XY_STEPS = [0.1, 1, 10, 50];
const Z_STEPS = [0.05, 0.1, 0.5, 1, 5];

export default function Paper({
  status,
  onAction,
  visible = true,
}: {
  status: any;
  onAction: () => void;
  visible?: boolean;
}) {
  const { t } = useI18n();
  const toast = useToasts();
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
  const [profileName, setProfileName] = useState<string | null>(null);
  // Track whether the head has been driven to calibration position in step 2
  const [atCalibPos, setAtCalibPos] = useState(false);
  // Obstacle (no-go zone) editing
  const [obstacles, setObstacles] = useState<Obstacle[]>([]);

  const online = status?.online;
  const homed = !!pos?.homed;
  const heightSaved = !!cal?.pen_calibrated;

  const notifyCalibrationChanged = () =>
    window.dispatchEvent(new CustomEvent("gcs:calibration-changed"));

  const applyPaperState = (s: PaperState) => {
    setCal(s.calibration);
    setRect(s.rect);
    setObstacles(s.calibration.obstacles ?? []);
    notifyCalibrationChanged();
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
      .catch((e) => toast.error(String(e.message)));
    api.listJobs().then(setJobs).catch(() => {});
    api.activeProfile().then((p) => setProfileName(p.name)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!visible) return;
    refreshPosition();
    const id = setInterval(refreshPosition, 2000);
    return () => clearInterval(id);
  }, [visible, refreshPosition]);

  useEffect(() => {
    if (!previewJob) { setPreview(null); return; }
    api.jobPreview(previewJob).then(setPreview).catch((e) => toast.error(String(e.message)));
  }, [previewJob]);

  const fail = (e: any) => toast.error(String(e.message ?? e));
  const run = (fn: () => Promise<any>) => fn().then(refreshPosition).catch(fail);

  const jogXY = (x: number, y: number) => run(() => api.jog(x * xyStep, y * xyStep, 0));
  const jogZ = (dz: number) => run(() => api.jog(0, 0, dz * zStep));

  const pressed = useArrowKeys(
    {
      left: active === 3 ? () => jogXY(-1, 0) : undefined,
      right: active === 3 ? () => jogXY(1, 0) : undefined,
      up: active === 3 ? () => jogXY(0, 1) : undefined,
      down: active === 3 ? () => jogXY(0, -1) : undefined,
      raise: homed ? () => jogZ(1) : undefined,
      lower: homed ? () => jogZ(-1) : undefined,
    },
    visible && online && (active === 2 || active === 3)
  );
  const kbd = (dir: string) => (pressed === dir ? " kbd-active" : "");

  if (!cal) return <div className="card">{t("common.loading")}</div>;

  const homeAll = () =>
    api.home()
      .then(() => { refreshPosition(); setActive(2); })
      .catch(fail);

  const savePenHeight = (which: "up" | "down") =>
    api.penFromPosition(which)
      .then((c) => {
        setCal(c);
        notifyCalibrationChanged();
        toast.success(
          which === "down"
            ? t("paper.penDownSaved", { z: c.pen_down_z.toFixed(2) })
            : t("paper.penUpSaved", { z: c.pen_up_z.toFixed(2) })
        );
      })
      .catch(fail);

  const setPenHeightValue = (which: "up" | "down", z: number) => {
    const updates =
      which === "down"
        ? { pen_down_z: z, pen_calibrated: true }
        : { pen_up_z: z };
    api.saveCalibration(updates).then((c) => { setCal(c); notifyCalibrationChanged(); }).catch(fail);
  };

  const saveBedDimension = (field: "bed_width" | "bed_height", val: number) => {
    if (val < 10) return;
    api.saveCalibration({ [field]: val }).then((c) => { setCal(c); notifyCalibrationChanged(); }).catch(fail);
  };

  const capture = (corner: string) =>
    api.setCorner(corner)
      .then((s) => { applyPaperState(s); toast.success(t("paper.cornerSaved", { corner: corner.toUpperCase() })); })
      .catch(fail);

  const clearCorner = (corner: string) =>
    api.clearCorner(corner).then(applyPaperState).catch(fail);

  const resetCorners = () => api.resetPaper().then(applyPaperState).catch(fail);

  const apply = () =>
    api.applyPaper(margin)
      .then((s) => { applyPaperState(s); toast.success(t("paper.applied")); onAction(); })
      .catch(fail);

  const plotFrame = () =>
    api.testPattern("frame")
      .then((j) => api.send(j.filename, true))
      .then(() => { toast.success(t("paper.framePlotting")); onAction(); })
      .catch(fail);

  const moveTo = (x: number, y: number) => run(() => api.move(x, y));

  const driveToCorner = (corner: string, target: "paper" | "plot") =>
    run(() => api.moveToCorner(corner, target));

  const moveToCalibPos = () => {
    const corners = cal.paper_corners ?? {};
    const firstCorner = (["tl", "tr", "bl", "br"] as const).find((c) => corners[c]);
    let x: number, y: number;
    if (firstCorner) {
      [x, y] = corners[firstCorner] as [number, number];
    } else {
      x = cal.bed_width / 2;
      y = cal.bed_height / 2;
    }
    run(() => api.move(x, y)).then(() => setAtCalibPos(true));
  };

  // Corner drag handlers (no machine movement)
  const handleDragCorner = (corner: string, x: number, y: number) => {
    setCal((prev) =>
      prev
        ? {
            ...prev,
            paper_corners: { ...prev.paper_corners, [corner]: [x, y] as [number, number] },
          }
        : prev
    );
  };
  const handleDropCorner = (corner: string, x: number, y: number) => {
    api.setCornerAt(corner, x, y).then(applyPaperState).catch(fail);
  };

  const capturedCount = Object.keys(cal.paper_corners ?? {}).length;

  const saveObstacles = (next: Obstacle[]) => {
    setObstacles(next);
    api.setObstacles(next).then(applyPaperState).catch(fail);
  };

  const addObstacle = () => {
    const cx = cal.origin_x + cal.plot_width / 2;
    const cy = cal.origin_y + cal.plot_height / 2;
    const newObs: Obstacle = {
      id: `obs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      x: Math.round((cx - 15) * 10) / 10,
      y: Math.round((cy - 10) * 10) / 10,
      w: 30, h: 20,
    };
    saveObstacles([...obstacles, newObs]);
  };

  const updateObstacle = (id: string, patch: Partial<Obstacle>) => {
    const next = obstacles.map((o) => o.id === id ? { ...o, ...patch } : o);
    saveObstacles(next);
  };

  const deleteObstacle = (id: string) => {
    saveObstacles(obstacles.filter((o) => o.id !== id));
  };

  const steps = [
    { n: 1, title: t("paper.step1"), done: homed, locked: false },
    { n: 2, title: t("paper.step2"), done: heightSaved, locked: !homed && !heightSaved },
    { n: 3, title: t("paper.step3"), done: !!rect, locked: !homed },
    { n: 4, title: t("paper.step4Obstacles"), done: false, locked: !rect },
    { n: 5, title: t("paper.step5"), done: false, locked: !rect },
  ];

  return (
    <div className="grid paper-grid">
      {/* ── Left: Live View ─────────────────────────────────────── */}
      <section className="card">
        <h2>{t("paper.liveView")}</h2>
        <LiveView
          cal={cal}
          position={pos}
          rect={rect}
          preview={preview}
          onMoveTo={clickMove && homed && active !== 4 ? moveTo : undefined}
          onDragCorner={active === 3 ? handleDragCorner : undefined}
          onDropCorner={active === 3 ? handleDropCorner : undefined}
          obstacles={obstacles}
          editingObstacles={active === 4}
          onObstaclesChange={saveObstacles}
        />
        <div className="legend">
          <span><i className="sw paper" /> {t("paper.legPaper")}</span>
          <span><i className="sw plot" /> {t("paper.legPlot")}</span>
          <span><i className="sw corner" /> {t("paper.legCorner")}</span>
          <span><i className="sw head" /> {t("paper.legPen")}</span>
          {obstacles.length > 0 && <span><i className="sw obstacle" /> {t("paper.legObstacle")}</span>}
          {preview && <span><i className="sw draw" /> {t("paper.legPreview")}</span>}
        </div>
        <div className="pos-readout">
          {homed && pos ? (
            <>
              <span>X <strong>{pos.x.toFixed(1)}</strong></span>
              <span>Y <strong>{pos.y.toFixed(1)}</strong></span>
              <span>Z <strong>{pos.z.toFixed(2)}</strong></span>
            </>
          ) : (
            <span className="muted">{t("paper.posUnknown")}</span>
          )}
          <label className="switch-label">
            <span className="muted">{t("paper.clickMove")}</span>
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
          <h3>{t("paper.gcodePreview")}</h3>
          <div className="preview-row">
            <select value={previewJob} onChange={(e) => setPreviewJob(e.target.value)}>
              <option value="">{t("paper.chooseJob")}</option>
              {jobs.map((j) => (
                <option key={j.filename} value={j.filename}>{j.filename}</option>
              ))}
            </select>
            <button className="ghost" onClick={() => api.listJobs().then(setJobs).catch(() => {})}>⟳</button>
          </div>
          {preview?.truncated && <p className="muted">{t("paper.previewTruncated")}</p>}
        </div>
      </section>

      {/* ── Right: Wizard ────────────────────────────────────────── */}
      <section className="card">
        <h2>{t("paper.title")}</h2>
        {profileName && (
          <p className="muted">{t("paper.activeProfile", { name: profileName })}</p>
        )}
        {!online && (
          <div className="banner err" style={{ marginBottom: 14 }}>
            {t("paper.offline")}
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

                  {/* ── Step 1: Home & bed size ──────────────────── */}
                  {s.n === 1 && (
                    <>
                      <p className="muted">{t("paper.step1Hint")}</p>
                      <button className="primary big" disabled={!online} onClick={homeAll}>
                        {t("paper.homeXYZ")}
                      </button>
                      <details className="collapsible" style={{ marginTop: 14 }}>
                        <summary className="muted">{t("paper.bedSize")}</summary>
                        <p className="muted" style={{ margin: "6px 0 8px" }}>
                          {t("paper.bedSizeHint")}
                        </p>
                        <div className="bed-size-row">
                          <label className="field">
                            <span>{t("paper.bedWidth")}</span>
                            <div className="input-unit">
                              <input
                                type="number" step="10" min="10"
                                value={cal.bed_width}
                                onChange={(e) =>
                                  saveBedDimension("bed_width", parseFloat(e.target.value) || cal.bed_width)
                                }
                              />
                              <em>mm</em>
                            </div>
                          </label>
                          <label className="field">
                            <span>{t("paper.bedHeight")}</span>
                            <div className="input-unit">
                              <input
                                type="number" step="10" min="10"
                                value={cal.bed_height}
                                onChange={(e) =>
                                  saveBedDimension("bed_height", parseFloat(e.target.value) || cal.bed_height)
                                }
                              />
                              <em>mm</em>
                            </div>
                          </label>
                        </div>
                      </details>
                    </>
                  )}

                  {/* ── Step 2: Pen height ───────────────────────── */}
                  {s.n === 2 && (
                    <>
                      {heightSaved && (
                        <div className="banner ok" style={{ marginTop: 0, marginBottom: 12 }}>
                          {t("paper.heightSet", {
                            down: cal.pen_down_z.toFixed(2),
                            up: cal.pen_up_z.toFixed(2),
                          })}
                        </div>
                      )}

                      {/* Move to calibration position */}
                      {!atCalibPos ? (
                        <div className="calib-pos-block">
                          <p className="muted">{t("paper.moveToCalibHint")}</p>
                          <button
                            className="primary big"
                            disabled={!online || !homed}
                            onClick={moveToCalibPos}
                          >
                            {t("paper.moveToCalib")}
                          </button>
                          {!homed && (
                            <div className="banner warn-inline" style={{ marginTop: 8 }}>
                              <span>{t("paper.needHome")}</span>
                              <button className="primary" disabled={!online} onClick={homeAll}>
                                {t("paper.homeXYZ")}
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="banner ok" style={{ marginTop: 0, marginBottom: 10 }}>
                          {t("paper.atCalibPos")}
                        </div>
                      )}

                      {/* Z jog — shown once at calibration position */}
                      {(atCalibPos || !homed) && (
                        <div className="z-panel">
                          <div className="z-readout">
                            <span className="muted">{t("paper.currentZ")}</span>
                            <strong>{homed && pos ? `${pos.z.toFixed(2)} mm` : t("paper.notHomed")}</strong>
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
                              {t("common.keyboard")}: <kbd>{t("common.pageUpKey")}</kbd><kbd>{t("common.pageDownKey")}</kbd> {t("paper.kbdZ")}
                            </p>
                          )}
                          <div className="save-row">
                            <button disabled={!online || !homed} onClick={() => savePenHeight("down")}>
                              {t("paper.saveAsDown")}
                            </button>
                            <button disabled={!online || !homed} onClick={() => savePenHeight("up")}>
                              {t("paper.saveAsUp")}
                            </button>
                          </div>
                          <div className="save-row" style={{ marginTop: 4 }}>
                            <button
                              disabled={!online || !homed || !heightSaved}
                              onClick={() => run(() => api.pen(true))}
                            >
                              {t("paper.testLower")}
                            </button>
                            <button
                              disabled={!online || !homed || !heightSaved}
                              onClick={() => run(() => api.pen(false))}
                            >
                              {t("paper.testRaise")}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Manual numeric inputs, collapsed */}
                      <details className="collapsible" style={{ marginTop: 12 }}>
                        <summary className="muted">{t("paper.manualValues")}</summary>
                        <div className="height-fields" style={{ marginTop: 8 }}>
                          <label className="field">
                            <span>{t("calibrate.penDownZ")}</span>
                            <div className="input-unit">
                              <input
                                type="number" step="0.05" value={cal.pen_down_z}
                                onChange={(e) =>
                                  setPenHeightValue("down", parseFloat(e.target.value) || 0)
                                }
                              />
                              <em>mm</em>
                            </div>
                          </label>
                          <label className="field">
                            <span>{t("calibrate.penUpZ")}</span>
                            <div className="input-unit">
                              <input
                                type="number" step="0.05" value={cal.pen_up_z}
                                onChange={(e) =>
                                  setPenHeightValue("up", parseFloat(e.target.value) || 0)
                                }
                              />
                              <em>mm</em>
                            </div>
                          </label>
                        </div>
                      </details>

                      <button
                        className="primary"
                        style={{ marginTop: 14 }}
                        disabled={!heightSaved}
                        onClick={() => setActive(3)}
                      >
                        {t("paper.toCorners")}
                      </button>
                    </>
                  )}

                  {/* ── Step 3: Paper corners ────────────────────── */}
                  {s.n === 3 && (
                    <>
                      {/* Corner chips */}
                      <div className="corner-chips">
                        {CORNERS.map((c) => {
                          const cap = cal.paper_corners?.[c.id];
                          return (
                            <span
                              key={c.id}
                              className={`corner-chip ${cap ? "set" : ""}`}
                            >
                              {t(c.labelKey)}
                              {cap
                                ? ` ${cap[0].toFixed(0)},${cap[1].toFixed(0)}`
                                : " —"}
                              {cap && (
                                <button
                                  className="ghost tiny"
                                  onClick={() => clearCorner(c.id)}
                                  title={t("paper.resetCorners")}
                                >✕</button>
                              )}
                            </span>
                          );
                        })}
                      </div>

                      <p className="muted" style={{ margin: "8px 0" }}>
                        {t("paper.dragCornerHint")}
                      </p>

                      {/* Manual jog + capture — collapsed */}
                      <details className="collapsible">
                        <summary className="muted">{t("paper.manualCapture")}</summary>
                        <div style={{ marginTop: 8 }}>
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
                              <button disabled={!online} onClick={() => run(() => api.pen(true))}>{t("paper.penDownShort")}</button>
                              <button disabled={!online} onClick={() => run(() => api.pen(false))}>{t("paper.penUpShort")}</button>
                            </div>
                          </div>
                          <p className="muted kbd-hint">
                            {t("common.keyboard")}: <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> {t("control.kbdMove")}
                          </p>
                          <div className="corner-grid">
                            {CORNERS.map((c) => {
                              const captured = cal.paper_corners?.[c.id];
                              return (
                                <div key={c.id} className={`corner ${captured ? "set" : ""}`}>
                                  <button disabled={!online || !homed} onClick={() => capture(c.id)}>
                                    {t(c.labelKey)}
                                  </button>
                                  {captured ? (
                                    <span className="coords">
                                      {captured[0].toFixed(1)} / {captured[1].toFixed(1)}
                                      <button
                                        className="ghost tiny"
                                        disabled={!online}
                                        title={t("paper.driveCorner")}
                                        onClick={() => driveToCorner(c.id, "paper")}
                                      >➜</button>
                                    </span>
                                  ) : (
                                    <span className="coords muted">—</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </details>

                      <div className="save-row" style={{ marginTop: 12 }}>
                        {capturedCount > 0 && (
                          <button className="ghost" onClick={resetCorners}>{t("paper.resetCorners")}</button>
                        )}
                        <button className="primary" disabled={!rect} onClick={() => setActive(4)}>
                          {t("common.next")} →
                        </button>
                      </div>
                    </>
                  )}

                  {/* ── Step 4: Obstacles ────────────────────────── */}
                  {s.n === 4 && (
                    <>
                      <p className="muted">{t("paper.step4ObstaclesHint")}</p>
                      <button className="primary" onClick={addObstacle} style={{ marginBottom: 10 }}>
                        + {t("paper.addObstacle")}
                      </button>
                      {obstacles.length === 0 && (
                        <p className="muted" style={{ fontSize: "0.85em" }}>
                          {t("paper.noObstacles")}
                        </p>
                      )}
                      {obstacles.length > 0 && (
                        <div className="obstacle-list">
                          {obstacles.map((obs, i) => (
                            <div key={obs.id} className="obstacle-item">
                              <span className="obstacle-idx">{i + 1}</span>
                              <label className="field obs-field">
                                <span>X</span>
                                <div className="input-unit">
                                  <input
                                    type="number" step="1"
                                    value={obs.x}
                                    onChange={(e) => updateObstacle(obs.id, { x: parseFloat(e.target.value) || 0 })}
                                  />
                                  <em>mm</em>
                                </div>
                              </label>
                              <label className="field obs-field">
                                <span>Y</span>
                                <div className="input-unit">
                                  <input
                                    type="number" step="1"
                                    value={obs.y}
                                    onChange={(e) => updateObstacle(obs.id, { y: parseFloat(e.target.value) || 0 })}
                                  />
                                  <em>mm</em>
                                </div>
                              </label>
                              <label className="field obs-field">
                                <span>{t("paper.obsWidth")}</span>
                                <div className="input-unit">
                                  <input
                                    type="number" step="1" min="1"
                                    value={obs.w}
                                    onChange={(e) => updateObstacle(obs.id, { w: Math.max(1, parseFloat(e.target.value) || 1) })}
                                  />
                                  <em>mm</em>
                                </div>
                              </label>
                              <label className="field obs-field">
                                <span>{t("paper.obsHeight")}</span>
                                <div className="input-unit">
                                  <input
                                    type="number" step="1" min="1"
                                    value={obs.h}
                                    onChange={(e) => updateObstacle(obs.id, { h: Math.max(1, parseFloat(e.target.value) || 1) })}
                                  />
                                  <em>mm</em>
                                </div>
                              </label>
                              <button
                                className="ghost tiny"
                                onClick={() => deleteObstacle(obs.id)}
                                title={t("paper.deleteObstacle")}
                              >✕</button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="save-row" style={{ marginTop: 14 }}>
                        <button className="primary" onClick={() => setActive(5)}>
                          {t("common.next")} →
                        </button>
                      </div>
                    </>
                  )}

                  {/* ── Step 5: Apply ────────────────────────────── */}
                  {s.n === 5 && (
                    <>
                      <p className="muted">
                        {rect
                          ? t("paper.capturedPaper", {
                              w: rect[2].toFixed(1),
                              h: rect[3].toFixed(1),
                              x: rect[0].toFixed(1),
                              y: rect[1].toFixed(1),
                            })
                          : t("paper.noPaper")}{" "}
                        {t("paper.pdfFit")}
                      </p>
                      <div className="apply-row">
                        <label className="field">
                          <span>{t("paper.margin")}</span>
                          <div className="input-unit">
                            <input
                              type="number" step="1" min="0" value={margin}
                              onChange={(e) => setMargin(parseFloat(e.target.value) || 0)}
                            />
                            <em>mm</em>
                          </div>
                        </label>
                        <button className="primary" disabled={!rect} onClick={apply}>
                          {t("common.apply")}
                        </button>
                        <button
                          disabled={!online || !rect}
                          onClick={plotFrame}
                          title={t("paper.testFrameTip")}
                        >
                          {t("paper.testFrame")}
                        </button>
                        <a className="btn-link" href="/api/calibration/export" download>
                          {t("common.exportXml")}
                        </a>
                      </div>
                      <div className="field-group" style={{ marginTop: 14 }}>
                        <h3>{t("paper.driveToPlotCorners")}</h3>
                        <p className="muted" style={{ margin: "0 0 8px" }}>
                          {t("paper.driveNote")}
                        </p>
                        <div className="save-row">
                          {CORNERS.map((c) => (
                            <button
                              key={c.id}
                              disabled={!online || !homed}
                              onClick={() => driveToCorner(c.id, "plot")}
                            >
                              {t(c.labelKey)}
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
      </section>
    </div>
  );
}
