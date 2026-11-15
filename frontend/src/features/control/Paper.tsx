import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../../api/errors";
import type { PrinterStatus } from "../../api/types/printer";
import { isPrinterBusy } from "../../lib/printerState";
import {
  api,
  type Calibration,
  type GcodePreview,
  type Job,
  type Obstacle,
  type PaperState,
  type PaintProject,
  type Position,
} from "../../api";
import LiveView from "./LiveView";
import CommittedNumberField from "../../components/CommittedNumberField";
import SpecialPositions from "./SpecialPositions";
import CalibrationPressureDialog from "./CalibrationPressureDialog";
import { useSpecialPositions } from "./useSpecialPositions";
import { SPECIAL_POSITIONS } from "./specialPositions";
import { PAPER_FORMATS, paperCornerAngles, plotArea, plotAreaBase } from "./paperLayout";
import Segmented from "../../components/Segmented";
import { useArrowKeys } from "../../hooks/index";
import { useI18n } from "../../i18n";
import { useToasts } from "../../components/Toasts";

const CORNERS: { id: string; labelKey: string }[] = [
  { id: "tl", labelKey: "paper.cornerTL" },
  { id: "tr", labelKey: "paper.cornerTR" },
  { id: "bl", labelKey: "paper.cornerBL" },
  { id: "br", labelKey: "paper.cornerBR" },
];

type PaperStep = "home" | "pen" | "positions" | "corners" | "obstacles" | "apply";

const XY_STEPS = [0.1, 1, 10, 50];
const Z_STEPS = [0.05, 0.1, 0.5, 1, 5];

export default function Paper({
  status,
  onAction,
  visible = true,
}: {
  status: PrinterStatus | null;
  onAction: () => void;
  visible?: boolean;
}) {
  const { t } = useI18n();
  const toast = useToasts();
  const [cal, setCal] = useState<Calibration | null>(null);
  const [rect, setRect] = useState<[number, number, number, number] | null>(null);
  const [pos, setPos] = useState<Position | null>(null);
  const [active, setActive] = useState<PaperStep | null>("home");
  const [xyStep, setXyStep] = useState(10);
  const [zStep, setZStep] = useState(0.1);
  const [clickMove, setClickMove] = useState(false);
  const [margin, setMargin] = useState(5);
  const [formatId, setFormatId] = useState<(typeof PAPER_FORMATS)[number]["id"] | null>(null);
  const [formatLandscape, setFormatLandscape] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [previewJob, setPreviewJob] = useState("");
  const [preview, setPreview] = useState<GcodePreview | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [project, setProject] = useState<PaintProject | null>(null);
  const [profileFingerprint, setProfileFingerprint] = useState<string | null>(null);
  const projectId = project?.id;
  const [completedPositions, setCompletedPositions] = useState<Record<string, string>>({});
  const [pressureOpen, setPressureOpen] = useState(false);
  const [pressureBusy, setPressureBusy] = useState(false);
  // Obstacle (no-go zone) editing
  const [obstacles, setObstacles] = useState<Obstacle[]>([]);
  const [obsCaptureActive, setObsCaptureActive] = useState(false);
  const [obsCaptureCorner1, setObsCaptureCorner1] = useState<[number, number] | null>(null);

  const online = status?.online;
  const motionLocked = isPrinterBusy(status);
  const homed = !!pos?.homed;
  const heightSaved = !!cal?.pen_calibrated;

  const notifyCalibrationChanged = () => {
    window.dispatchEvent(new CustomEvent("gcs:calibration-changed"));
    if (!profileId) return;
    api.getProfile(profileId).then((profile) => {
      setProfileName(profile.name);
      setProfileFingerprint(profile.fingerprint);
    }).catch(() => {});
  };

  const applyPaperState = (s: PaperState) => {
    setCal(s.calibration);
    setRect(s.rect);
    setMargin(s.calibration.paper_margin ?? 0);
    setObstacles(s.calibration.obstacles ?? []);
    notifyCalibrationChanged();
  };

  const refreshPosition = useCallback(
    () => api.position().then(setPos).catch(() => setPos(null)),
    []
  );

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setCal(null);
    setPressureOpen(false);
    api.listPages().then(async (index) => {
      if (!index.project) throw new Error("Kein aktives Projekt vorhanden.");
      const selected = index.project;
      const [profile, state] = await Promise.all([api.getProfile(selected.profileId), api.paper(selected.id)]);
      if (cancelled) return;
      setProject(selected);
      setProfileId(profile.id);
      setProfileName(profile.name);
      setProfileFingerprint(profile.fingerprint);
      setCal(state.calibration);
      setRect(state.rect);
      setObstacles(state.calibration.obstacles ?? []);
      setMargin(state.calibration.paper_margin ?? 5);
    }).catch((error) => { if (!cancelled) toast.error(errorMessage(error)); });
    api.listJobs().then(setJobs).catch(() => {});
    return () => { cancelled = true; };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    refreshPosition();
    const id = setInterval(refreshPosition, 2000);
    return () => clearInterval(id);
  }, [visible, refreshPosition]);

  useEffect(() => {
    if (!previewJob) { setPreview(null); return; }
    api.jobPreview(previewJob).then(setPreview).catch((e) => toast.error(errorMessage(e)));
  }, [previewJob]);

  const fail = (e: unknown) => toast.error(errorMessage(e));
  const run = (fn: () => Promise<unknown>) => fn().then(refreshPosition).catch(fail);

  const positionsOpen = active === "positions";
  const positions = useSpecialPositions({
    active: visible && positionsOpen, cal, pos, profileId, projectId,
    canMove: !!online && !motionLocked && !pressureBusy,
    onPosition: setPos,
    onCalibration: (updated) => { setCal(updated); notifyCalibrationChanged(); },
    onAction,
  });
  const canMove = online && !motionLocked && !positions.busy && !pressureBusy;

  useEffect(() => {
    if (!visible && active === "positions") setActive(null);
    if (!visible) setPressureOpen(false);
  }, [visible, active]);

  // Follow the project's calibration even when the global printer profile differs.
  useEffect(() => {
    if (!visible || !projectId || !profileId) return;
    let cancelled = false;
    const id = setInterval(() => {
      api.listPages().then(async (index) => {
        if (cancelled || !index.project) return;
        const selected = index.project;
        if (selected.id === projectId && selected.profileId === profileId
            && index.activeProfile?.fingerprint === profileFingerprint) return;
        const [profile, state] = await Promise.all([api.getProfile(selected.profileId), api.paper(selected.id)]);
        if (cancelled) return;
        setProject(selected);
        setProfileId(profile.id);
        setProfileName(profile.name);
        setProfileFingerprint(profile.fingerprint);
        setCal(state.calibration);
        setRect(state.rect);
        setMargin(state.calibration.paper_margin ?? 5);
        setObstacles(state.calibration.obstacles ?? []);
        setPressureOpen(false);
      }).catch(() => {});
    }, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [visible, projectId, profileId, profileFingerprint]);

  const jogXY = (x: number, y: number) => run(() => api.jog(x * xyStep, y * xyStep, 0, { projectId }));
  const jogZ = (dz: number) => run(() => api.jog(0, 0, dz * zStep, { projectId }));

  const xyControls = active === "corners" || active === "obstacles";
  const pressed = useArrowKeys(
    {
      left: xyControls ? () => jogXY(-1, 0) : undefined,
      right: xyControls ? () => jogXY(1, 0) : undefined,
      up: xyControls ? () => jogXY(0, 1) : active === "pen" ? () => jogZ(1) : undefined,
      down: xyControls ? () => jogXY(0, -1) : active === "pen" ? () => jogZ(-1) : undefined,
      raise: homed ? () => jogZ(1) : undefined,
      lower: homed ? () => jogZ(-1) : undefined,
    },
    visible && canMove && (active === "pen" || xyControls)
  );
  const kbd = (dir: string) => (pressed === dir ? " kbd-active" : "");

  if (!cal) return <div className="card">{t("common.loading")}</div>;

  const homeAll = () =>
    api.home(undefined, projectId)
      .then(() => { refreshPosition(); setActive("pen"); })
      .catch(fail);

  const savePenHeight = (which: "up" | "down") =>
    api.penFromPosition(which, projectId)
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
    api.saveCalibration(updates, projectId).then((c) => { setCal(c); notifyCalibrationChanged(); }).catch(fail);
  };

  const saveBedDimension = (field: "bed_width" | "bed_height", val: number) => {
    if (val < 10) return;
    api.saveCalibration({ [field]: val }, projectId).then((c) => { setCal(c); notifyCalibrationChanged(); }).catch(fail);
  };

  const capture = (corner: string) =>
    api.setCorner(corner, projectId)
      .then((s) => { applyPaperState(s); toast.success(t("paper.cornerSaved", { corner: corner.toUpperCase() })); })
      .catch(fail);

  const clearCorner = (corner: string) =>
    api.clearCorner(corner, projectId).then(applyPaperState).catch(fail);

  const resetCorners = () => api.resetPaper(projectId).then(applyPaperState).catch(fail);

  const apply = () =>
    api.applyPaper(margin, projectId)
      .then((s) => { applyPaperState(s); toast.success(t("paper.applied")); onAction(); })
      .catch(fail);

  const adoptPaperArea = () =>
    api.applyPaper(margin, projectId, true)
      .then((s) => { applyPaperState(s); toast.success(t("paper.applied")); onAction(); });

  const plotFrame = () =>
    api.testPattern("frame", projectId)
      .then((j) => api.send(j.filename, true))
      .then(() => { toast.success(t("paper.framePlotting")); onAction(); })
      .catch(fail);

  const moveTo = (x: number, y: number) => run(() => api.move(x, y, projectId));

  const driveToCorner = (corner: string, target: "paper" | "plot") =>
    run(() => api.moveToCorner(corner, target, projectId));

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
    api.setCornerAt(corner, x, y, projectId).then(applyPaperState).catch(fail);
  };

  const capturedCount = Object.keys(cal.paper_corners ?? {}).length;
  const currentFormat = PAPER_FORMATS.find((format) => format.id === formatId);
  const currentPlot = plotArea(cal);
  const currentBase = plotAreaBase(cal);
  const marginValid = Number.isFinite(margin) && margin >= 0
    && currentBase.w - 2 * margin >= 5 && currentBase.h - 2 * margin >= 5;
  const cornerAngles = paperCornerAngles(cal.paper_corners ?? {});

  const saveObstacles = (next: Obstacle[]) => {
    setObstacles(next);
    api.setObstacles(next, projectId).then(applyPaperState).catch(fail);
  };

  const deleteObstacle = (id: string) => {
    saveObstacles(obstacles.filter((o) => o.id !== id));
  };

  const positionsSignature = SPECIAL_POSITIONS.every(({ kind, x, y }) =>
    cal.defined_positions?.includes(kind) && Number.isFinite(cal[x]) && Number.isFinite(cal[y]))
    ? JSON.stringify(SPECIAL_POSITIONS.map(({ x, y }) => [cal[x], cal[y]])) : null;
  const positionsDone = !!profileId && positionsSignature !== null && completedPositions[profileId] === positionsSignature;
  const finishPositions = () => {
    if (profileId && positionsSignature !== null) {
      setCompletedPositions((current) => ({ ...current, [profileId]: positionsSignature }));
    }
    setActive("corners");
  };

  const steps: { id: PaperStep; title: string; done: boolean; locked: boolean; optional?: boolean }[] = [
    { id: "home", title: t("paper.step1"), done: homed, locked: false },
    { id: "pen", title: t("paper.step2"), done: heightSaved, locked: !homed && !heightSaved },
    { id: "corners", title: t("paper.step3"), done: !!rect, locked: false },
    { id: "apply", title: t("paper.step5"), done: false, locked: false },
    { id: "positions", title: t("paper.positions.title"), done: positionsDone, locked: false, optional: true },
    { id: "obstacles", title: t("paper.step4Obstacles"), done: false, locked: !rect, optional: true },
  ];

  return (
    <div className="grid paper-grid">
      {visible && pressureOpen && <CalibrationPressureDialog canMove={!!online && !motionLocked && !positions.busy}
        projectId={projectId} profileId={profileId ?? undefined}
        onClose={() => setPressureOpen(false)} onBusyChange={setPressureBusy}
        onCalibration={(updated) => { setCal(updated); notifyCalibrationChanged(); }} onPosition={setPos} onAction={onAction} />}
      {/* ── Left: Wizard ────────────────────────────────────────── */}
      <section className="card paper-wizard-panel">
        <h2>{t("paper.title")}</h2>
        <p className="calibration-intro">{t("paper.guideIntro")}</p>
        {profileName && (
          <p className="calibration-context">{t("paper.context", { project: project?.name ?? "", profile: profileName })}</p>
        )}
        {!online && (
          <div className="banner err" style={{ marginBottom: 14 }}>
            {t("paper.offline")}
          </div>
        )}

        <div className="wizard">
          {steps.map((s, index) => (
            <div key={s.id} className={`wstep ${s.locked ? "locked" : ""} ${active === s.id ? "open" : ""}`}>
              <button
                className="wstep-head"
                disabled={s.locked || positions.busy}
                aria-expanded={active === s.id}
                onClick={() => setActive(active === s.id ? null : s.id)}
              >
                <span className={`badge ${s.done ? "done" : ""}`}>
                  {s.done ? "✓" : s.locked ? "🔒" : s.optional ? "+" : index + 1}
                </span>
                <span className="wstep-title">{s.title}</span>
                {s.optional && <span className="calibration-optional">{t("paper.optional")}</span>}
              </button>

              {active === s.id && !s.locked && (
                <div className="wstep-body">

                  {/* ── Step 1: Home & bed size ──────────────────── */}
                  {s.id === "home" && (
                    <>
                      <p className="muted">{t("paper.step1Hint")}</p>
                      {homed && <>
                        <p className="calibration-check">✓ {t("paper.homed")}</p>
                        <button className="primary big" onClick={() => setActive("pen")}>{t("paper.continueSetup")}</button>
                      </>}
                      <button className={homed ? "ghost" : "primary big"} disabled={!canMove} onClick={homeAll}>
                        {t("paper.homeXYZ")}
                      </button>
                      <details className="collapsible" style={{ marginTop: 14 }}>
                        <summary className="muted">{t("paper.bedSize")}</summary>
                        <p className="muted" style={{ margin: "6px 0 8px" }}>
                          {t("paper.bedSizeHint")}
                        </p>
                        <div className="bed-size-row">
                          <CommittedNumberField label={t("paper.bedWidth")} value={cal.bed_width} min={10} step={1}
                            onChange={(value) => saveBedDimension("bed_width", value)} />
                          <CommittedNumberField label={t("paper.bedHeight")} value={cal.bed_height} min={10} step={1}
                            onChange={(value) => saveBedDimension("bed_height", value)} />
                        </div>
                      </details>
                    </>
                  )}

                  {/* ── Step 2: Pen height ───────────────────────── */}
                  {s.id === "pen" && (
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
                        <div className="banner warn-inline" style={{ marginBottom: 10 }}>
                          <span>{t("paper.needHome")}</span>
                          <button className="primary" disabled={!canMove} onClick={homeAll}>
                            {t("paper.homeXYZ")}
                          </button>
                        </div>
                      )}

                      <p className="muted">{t("paper.step2Hint")}</p>
                      <details className="collapsible" open={!heightSaved}>
                        <summary>{t("paper.penInstructions")}</summary>
                        <ol className="calibration-instructions">
                          <li>{t("paper.penContactInstruction")}</li>
                          <li>{t("paper.penLiftInstruction")}</li>
                        </ol>
                      </details>
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
                          <button
                            className={"big" + kbd("raise") + kbd("up")}
                            disabled={!canMove || !homed}
                            onClick={() => jogZ(1)}
                          >
                            Z + {zStep}
                          </button>
                          <button
                            className={"big" + kbd("lower") + kbd("down")}
                            disabled={!canMove || !homed}
                            onClick={() => jogZ(-1)}
                          >
                            Z − {zStep}
                          </button>
                        </div>
                        {homed && (
                          <p className="muted kbd-hint">
                            {t("common.keyboard")}: <kbd>↑</kbd><kbd>↓</kbd> / <kbd>{t("common.pageUpKey")}</kbd><kbd>{t("common.pageDownKey")}</kbd> {t("paper.kbdZ")}
                          </p>
                        )}
                        <div className="save-row">
                          <button disabled={!canMove || !homed} onClick={() => savePenHeight("down")}>
                            {t("paper.saveAsDown")}
                          </button>
                          <button disabled={!canMove || !homed} onClick={() => savePenHeight("up")}>
                            {t("paper.saveAsUp")}
                          </button>
                        </div>
                        <div className="save-row" style={{ marginTop: 4 }}>
                          <button
                            disabled={!canMove || !homed || !heightSaved}
                            onClick={() => run(() => api.pen(true, projectId))}
                          >
                            {t("paper.testLower")}
                          </button>
                          <button
                            disabled={!canMove || !homed || !heightSaved}
                            onClick={() => run(() => api.pen(false, projectId))}
                          >
                            {t("paper.testRaise")}
                          </button>
                        </div>
                      </div>

                      {/* Manual numeric inputs, collapsed */}
                      <details className="collapsible" style={{ marginTop: 12 }}>
                        <summary className="muted">{t("paper.manualValues")}</summary>
                        <div className="height-fields" style={{ marginTop: 8 }}>
                          <CommittedNumberField label={t("calibrate.penDownZ")} value={cal.pen_down_z} min={0} max={cal.z_max} step={0.05}
                            onChange={(value) => setPenHeightValue("down", value)} />
                          <CommittedNumberField label={t("calibrate.penUpZ")} value={cal.pen_up_z} min={0} max={cal.z_max} step={0.05}
                            onChange={(value) => setPenHeightValue("up", value)} />
                        </div>
                      </details>

                      <button
                        className="primary"
                        style={{ marginTop: 14 }}
                        disabled={!heightSaved}
                        onClick={() => setActive("corners")}
                      >
                        {t("paper.toCorners")}
                      </button>
                      <p className="muted">{t("paper.positionDefaultsHint")}</p>
                      <button className="ghost" onClick={() => setActive("positions")}>{t("paper.positions.next")}</button>
                    </>
                  )}

                  {s.id === "positions" && (
                    <SpecialPositions cal={cal} pos={pos} controls={positions}
                      onNext={finishPositions} onOpenPressure={() => setPressureOpen(true)} />
                  )}

                  {/* ── Step 4: Paper corners ────────────────────── */}
                  {s.id === "corners" && (
                    <>
                      <p className="muted">{t("paper.step3Hint")}</p>
                      <p className="calibration-group-hint">{t("paper.cornerMethods")}</p>
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
                              <button disabled={!canMove} onClick={() => jogXY(0, 1)} className={"up" + kbd("up")}>↑</button>
                              <button disabled={!canMove} onClick={() => jogXY(-1, 0)} className={"left" + kbd("left")}>←</button>
                              <span className="pad-center" />
                              <button disabled={!canMove} onClick={() => jogXY(1, 0)} className={"right" + kbd("right")}>→</button>
                              <button disabled={!canMove} onClick={() => jogXY(0, -1)} className={"down" + kbd("down")}>↓</button>
                            </div>
                            <div className="z">
                              <button disabled={!canMove} onClick={() => run(() => api.pen(true, projectId))}>{t("paper.penDownShort")}</button>
                              <button disabled={!canMove} onClick={() => run(() => api.pen(false, projectId))}>{t("paper.penUpShort")}</button>
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
                                  <button disabled={!canMove || !homed} onClick={() => capture(c.id)}>
                                    {t(c.labelKey)}
                                  </button>
                                  {captured ? (
                                    <span className="coords">
                                      {captured[0].toFixed(1)} / {captured[1].toFixed(1)}
                                      <button
                                        className="ghost tiny"
                                        disabled={!canMove}
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
                        <button className="primary" disabled={!rect} onClick={() => {
                          adoptPaperArea().then(() => setActive("apply")).catch(fail);
                        }}>
                          {t("paper.usePaperArea")}
                        </button>
                        <button onClick={() => setActive("apply")}>{t("paper.useCurrentArea")}</button>
                      </div>
                    </>
                  )}

                  {/* ── Step 5: Obstacles ────────────────────────── */}
                  {s.id === "obstacles" && (
                    <>
                      <p className="muted">{t("paper.step4ObstaclesHint")}</p>

                      {!obsCaptureActive ? (
                        <>
                          <button
                            className="primary"
                            onClick={() => { setObsCaptureCorner1(null); setObsCaptureActive(true); }}
                            style={{ marginBottom: 10 }}
                          >
                            + {t("paper.obsStartCapture")}
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
                                  <span className="obs-coords muted">
                                    X{obs.x.toFixed(0)} Y{obs.y.toFixed(0)} · {obs.w.toFixed(0)}×{obs.h.toFixed(0)} mm
                                  </span>
                                  <button
                                    className="ghost tiny danger"
                                    onClick={() => deleteObstacle(obs.id)}
                                    title={t("paper.deleteObstacle")}
                                  >🗑</button>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="obs-capture-panel">
                          <p className="muted">
                            {t(obsCaptureCorner1 ? "paper.obsHintCorner2" : "paper.obsHintCorner1")}
                          </p>
                          <Segmented
                            value={xyStep}
                            onChange={setXyStep}
                            options={XY_STEPS.map((st) => ({ value: st, label: st }))}
                            suffix={<em className="muted">mm</em>}
                          />
                          <div className="jog compact">
                            <div className="xy">
                              <button disabled={!canMove} onClick={() => jogXY(0, 1)} className={"up" + kbd("up")}>↑</button>
                              <button disabled={!canMove} onClick={() => jogXY(-1, 0)} className={"left" + kbd("left")}>←</button>
                              <span className="pad-center" />
                              <button disabled={!canMove} onClick={() => jogXY(1, 0)} className={"right" + kbd("right")}>→</button>
                              <button disabled={!canMove} onClick={() => jogXY(0, -1)} className={"down" + kbd("down")}>↓</button>
                            </div>
                          </div>
                          <p className="muted kbd-hint">
                            {t("common.keyboard")}: <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> {t("control.kbdMove")}
                          </p>
                          {obsCaptureCorner1 && (
                            <div className="banner ok" style={{ marginTop: 8, marginBottom: 8 }}>
                              {t("paper.obsCorner1Set", {
                                x: obsCaptureCorner1[0].toFixed(1),
                                y: obsCaptureCorner1[1].toFixed(1),
                              })}
                            </div>
                          )}
                          <div className="save-row" style={{ marginTop: 12 }}>
                            {!obsCaptureCorner1 ? (
                              <button
                                className="primary"
                                disabled={!homed || !pos}
                                onClick={() => setObsCaptureCorner1([pos!.x, pos!.y])}
                              >
                                {t("paper.obsSetCorner1")}
                              </button>
                            ) : (
                              <button
                                className="primary"
                                disabled={!homed || !pos}
                                onClick={() => {
                                  const x1 = obsCaptureCorner1[0], y1 = obsCaptureCorner1[1];
                                  const x2 = pos!.x, y2 = pos!.y;
                                  const ow = Math.abs(x2 - x1), oh = Math.abs(y2 - y1);
                                  if (ow < 1 || oh < 1) { toast.error(t("paper.obsMinSize")); return; }
                                  saveObstacles([...obstacles, {
                                    id: `obs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                                    x: Math.round(Math.min(x1, x2) * 10) / 10,
                                    y: Math.round(Math.min(y1, y2) * 10) / 10,
                                    w: Math.round(ow * 10) / 10,
                                    h: Math.round(oh * 10) / 10,
                                  }]);
                                  setObsCaptureCorner1(null);
                                  setObsCaptureActive(false);
                                }}
                              >
                                {t("paper.obsSetCorner2")}
                              </button>
                            )}
                            <button
                              className="ghost"
                              onClick={() => { setObsCaptureCorner1(null); setObsCaptureActive(false); }}
                            >
                              {t("paper.obsCancelCapture")}
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="save-row" style={{ marginTop: 14 }}>
                        <button className="primary" onClick={() => setActive("apply")}>
                          {t("common.next")} →
                        </button>
                      </div>
                    </>
                  )}

                  {/* ── Step 6: Apply ────────────────────────────── */}
                  {s.id === "apply" && (
                    <>
                      <p className="muted">{t("paper.reviewHint")}</p>
                      <p className="muted">{t("paper.marginHint")}</p>
                      {(!homed || !heightSaved) && <p className="calibration-group-hint">{t("paper.frameNeedsSetup")}</p>}
                      <div className="apply-row">
                        <label className="field">
                          <span>{t("paper.margin")}</span>
                          <div className="input-unit">
                            <input
                              type="number" aria-label={t("paper.margin")} step="1" min="0" max={(Math.min(currentBase.w, currentBase.h) - 5) / 2} value={margin}
                              onChange={(e) => setMargin(parseFloat(e.target.value) || 0)}
                            />
                            <em>mm</em>
                          </div>
                        </label>
                        <button className="primary" disabled={!marginValid} onClick={apply}>
                          {t("paper.applyMargin")}
                        </button>
                        <button
                          disabled={!canMove || !homed || !heightSaved}
                          onClick={plotFrame}
                          title={t("paper.testFrameTip")}
                        >
                          {t("paper.testFrame")}
                        </button>
                        <a className="btn-link" href={`/api/calibration/export${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`} download>
                          {t("common.exportXml")}
                        </a>
                      </div>
                      <button type="button" className="ghost" disabled={!rect} onClick={() => { adoptPaperArea().catch(fail); }}
                        style={{ marginTop: 10 }}>{t("paper.fromCorners")}</button>
                      <div className="field-group" style={{ marginTop: 14 }}>
                        <h3>{t("paper.driveToPlotCorners")}</h3>
                        <p className="muted" style={{ margin: "0 0 8px" }}>
                          {t("paper.driveNote")}
                        </p>
                        <div className="save-row">
                          {CORNERS.map((c) => (
                            <button
                              key={c.id}
                              disabled={!canMove || !homed}
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
      {/* ── Right: Live View ─────────────────────────────────────── */}
      <section className="card paper-live-panel">
        <h2>{t("paper.liveView")}</h2>
        <p className="calibration-group-hint">{positionsOpen ? t("paper.positionMapHint") : clickMove ? t("paper.clickMoveEnabled") : t("paper.clickMoveDisabled")}</p>
        <div className="paper-format-controls" title={t("paper.formatPassive")}>
          <label className="field">{t("paper.formatCompare")}
            <select aria-label={t("paper.formatCompare")} value={formatId ?? ""}
              onChange={(event) => setFormatId(event.target.value as typeof formatId || null)}>
              <option value="">{t("paper.formatOff")}</option>
              {PAPER_FORMATS.map((format) => <option key={format.id} value={format.id}>{format.id}</option>)}
            </select>
          </label>
          {currentFormat && <button type="button" className="ghost paper-format-orientation"
              aria-pressed={formatLandscape} onClick={() => setFormatLandscape((value) => !value)}>
              {formatLandscape ? t("paper.landscape") : t("paper.portrait")} ↻
            </button>}
        </div>
        <LiveView
          cal={cal}
          position={pos}
          rect={rect}
          preview={preview}
          onMoveTo={positionsOpen
            ? positions.ready && !positions.busy ? (x, y) => positions.move({ x, y }) : undefined
            : visible && clickMove && homed && canMove ? moveTo : undefined}
          selectedPosition={positionsOpen ? positions.kind : null}
          target={positions.target}
          onDragCorner={active === "corners" ? handleDragCorner : undefined}
          onDropCorner={active === "corners" ? handleDropCorner : undefined}
          formatPreview={currentFormat ? { format: currentFormat, landscape: formatLandscape } : undefined}
          obstacles={obstacles}
          editingObstacles={active === "obstacles"}
          onObstaclesChange={saveObstacles}
        />
        <div className="paper-area-readout">
          <span>{t("paper.drawingArea")} {currentPlot.w.toFixed(1)} × {currentPlot.h.toFixed(1)} mm</span>
        </div>
        <div className="paper-angle-readout" aria-label={t("paper.cornerAngles")}>
          <strong>{t("paper.cornerAngles")}</strong>
          {cornerAngles ? CORNERS.map(({ id, labelKey }) => {
            const angle = cornerAngles[id];
            const right = Math.abs(angle - 90) <= 1;
            return <span key={id} className={right ? "right" : "skewed"}
              title={t(labelKey)}>{t(labelKey).split(" ")[0]} {angle.toFixed(1)}° {right ? "✓" : "!"}</span>;
          }) : <span className="muted">{t("paper.angleNeedCorners")}</span>}
        </div>
        <div className="legend">
          <span><i className="sw paper" /> {t("paper.legPaper")}</span>
          <span><i className="sw" style={{ background: "var(--muted)" }} /> {t("paper.legPlot")}</span>
          <span><i className="sw corner" /> {t("paper.legCorner")}</span>
          <span><i className="sw head" /> {t("paper.legPen")}</span>
          <span><i className="sw park" /> {t("paper.legPark")}</span>
          <span>
            <i className="sw calibration" /> C · {t("calibrate.groupCalibrationPosition")}
          </span>
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
          <label className={`switch-label ${positionsOpen ? "disabled" : ""}`}>
            <span className="muted">{t("paper.clickMove")}</span>
            <button
              className={`switch ${clickMove && !positionsOpen ? "on" : ""}`}
              disabled={!homed || positionsOpen || positions.busy}
              aria-label={t("paper.clickMove")}
              onClick={() => setClickMove(!clickMove)}
              aria-pressed={clickMove && !positionsOpen}
            >
              <i />
            </button>
          </label>
        </div>

        <div className="paper-preview">
          <label htmlFor="paper-preview-job">{t("paper.gcodePreview")}</label>
          <div className="preview-row">
            <select id="paper-preview-job" value={previewJob} onChange={(e) => setPreviewJob(e.target.value)}>
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

    </div>
  );
}
