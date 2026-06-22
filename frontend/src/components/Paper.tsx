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
  visible?: boolean; // false while the tab is kept mounted but hidden
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
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);

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
    // Corner captures and "apply paper" write into the active profile, so
    // show which one that is.
    api.activeProfile().then((p) => setProfileName(p.name)).catch(() => {});
  }, []);

  // Poll the head position only while this tab is actually on screen — the tab
  // is kept mounted across switches, so an always-on interval would keep hitting
  // the printer in the background. Refresh immediately when it becomes visible.
  useEffect(() => {
    if (!visible) return;
    refreshPosition();
    const id = setInterval(refreshPosition, 2000);
    return () => clearInterval(id);
  }, [visible, refreshPosition]);

  useEffect(() => {
    if (!previewJob) {
      setPreview(null);
      return;
    }
    api.jobPreview(previewJob).then(setPreview).catch((e) => setErr(String(e.message)));
  }, [previewJob]);

  useEffect(() => {
    if (msg) toast.success(msg);
  }, [msg, toast]);

  useEffect(() => {
    if (err) toast.error(err);
  }, [err, toast]);

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
    // Only while the tab is on screen — the component stays mounted when hidden,
    // and a stray arrow key must never jog the printer from another tab.
    visible && online && (active === 2 || active === 3)
  );
  const kbd = (dir: string) => (pressed === dir ? " kbd-active" : "");

  if (!cal) return <div className="card">{t("common.loading")}</div>;

  const homeAll = () =>
    api
      .home()
      .then(() => {
        refreshPosition();
        flash(t("paper.homed"));
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
            ? t("paper.penDownSaved", { z: c.pen_down_z.toFixed(2) })
            : t("paper.penUpSaved", { z: c.pen_up_z.toFixed(2) })
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
        flash(t("paper.cornerSaved", { corner: corner.toUpperCase() }));
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
        flash(t("paper.applied"));
        onAction();
      })
      .catch(fail);

  const plotFrame = () =>
    api
      .testPattern("frame")
      .then((j) => api.send(j.filename, true))
      .then(() => {
        flash(t("paper.framePlotting"));
        onAction();
      })
      .catch(fail);

  const moveTo = (x: number, y: number) => run(() => api.move(x, y));

  // The backend always lifts the pen to pen_up_z before the XY travel.
  const driveToCorner = (corner: string, target: "paper" | "plot") =>
    run(() => api.moveToCorner(corner, target));

  const capturedCount = Object.keys(cal.paper_corners ?? {}).length;

  const steps = [
    { n: 1, title: t("paper.step1"), done: homed, locked: false },
    // Openable once homed OR a height is already saved, so you can always come
    // back to test / re-adjust the pen height (movements still need homing).
    { n: 2, title: t("paper.step2"), done: heightSaved, locked: !homed && !heightSaved },
    { n: 3, title: t("paper.step3"), done: !!rect, locked: !homed },
    { n: 4, title: t("paper.step4"), done: false, locked: !rect },
  ];

  return (
    <div className="grid paper-grid">
      <section className="card">
        <h2>{t("paper.liveView")}</h2>
        <LiveView
          cal={cal}
          position={pos}
          rect={rect}
          preview={preview}
          onMoveTo={clickMove && homed ? moveTo : undefined}
        />
        <div className="legend">
          <span><i className="sw paper" /> {t("paper.legPaper")}</span>
          <span><i className="sw plot" /> {t("paper.legPlot")}</span>
          <span><i className="sw corner" /> {t("paper.legCorner")}</span>
          <span><i className="sw head" /> {t("paper.legPen")}</span>
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
            <button className="ghost" onClick={() => api.listJobs().then(setJobs).catch(() => {})}>
              ⟳
            </button>
          </div>
          {preview?.truncated && <p className="muted">{t("paper.previewTruncated")}</p>}
        </div>
      </section>

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
                  {s.n === 1 && (
                    <>
                      <p className="muted">{t("paper.step1Hint")}</p>
                      <button className="primary big" disabled={!online} onClick={homeAll}>
                        {t("paper.homeXYZ")}
                      </button>
                    </>
                  )}

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
                      {!homed && (
                        <div className="banner warn-inline">
                          <span>{t("paper.needHome")}</span>
                          <button
                            className="primary"
                            disabled={!online}
                            onClick={homeAll}
                          >
                            {t("paper.homeXYZ")}
                          </button>
                        </div>
                      )}
                      <p className="muted">{t("paper.step2Hint")}</p>
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
                      </div>

                      <div className="height-fields">
                        <label className="field">
                          <span>{t("calibrate.penDownZ")}</span>
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
                          <span>{t("calibrate.penUpZ")}</span>
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
                              ? t("paper.tipNeedDown")
                              : !homed
                              ? t("paper.tipNeedHome")
                              : t("paper.tipGoDown")
                          }
                          onClick={() => run(() => api.pen(true))}
                        >
                          {t("paper.testLower")}
                        </button>
                        <button
                          disabled={!online || !homed || !heightSaved}
                          title={
                            !heightSaved
                              ? t("paper.tipNeedDown")
                              : !homed
                              ? t("paper.tipNeedHome")
                              : t("paper.tipGoUp")
                          }
                          onClick={() => run(() => api.pen(false))}
                        >
                          {t("paper.testRaise")}
                        </button>
                      </div>

                      <button className="primary" onClick={() => setActive(3)}>
                        {t("paper.toCorners")}
                      </button>
                    </>
                  )}

                  {s.n === 3 && (
                    <>
                      <p className="muted">{t("paper.step3Hint")}</p>
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
                        {homed && <> · <kbd>{t("common.pageUpKey")}</kbd><kbd>{t("common.pageDownKey")}</kbd> Z</>}
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
                          <button className="ghost" onClick={resetCorners}>{t("paper.resetCorners")}</button>
                        )}
                        <button className="primary" disabled={!rect} onClick={() => setActive(4)}>
                          {t("common.next")} →
                        </button>
                      </div>
                    </>
                  )}

                  {s.n === 4 && (
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
