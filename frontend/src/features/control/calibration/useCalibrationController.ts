import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Calibration, type Obstacle, type PrinterStatus } from "../../../api";
import { errorMessage, isAbortError } from "../../../api/errors";
import { isPrinterBusy } from "../../../lib/printerState";
import { useArrowKeys } from "../../../hooks";
import { useI18n } from "../../../i18n";
import { useToasts } from "../../../components/Toasts";
import { useCalibrationSource } from "./useCalibrationSource";
import { targetBody, type CalibrationTarget } from "../../../api/calibrationTarget";
import { useSpecialPositions } from "../useSpecialPositions";
import { PAPER_FORMATS, paperCornerAngles, plotArea, plotAreaBase } from "../paperLayout";
import { calibrationSteps, type CalibrationStep } from "./steps";
import { useCalibrationReadings } from "./useCalibrationReadings";
import { useCalibrationCommands } from "./useCalibrationCommands";

export interface CalibrationControllerProps { status: PrinterStatus | null; onAction: () => void; visible?: boolean; profileId?: string }

export function useCalibrationController({ status, onAction, visible = true, profileId: selectedProfileId }: CalibrationControllerProps) {
  const { t } = useI18n();
  const toast = useToasts();
  const { index, profile, paper: paperState, loading, error, refresh, profileChanged, readOnly } = useCalibrationSource(selectedProfileId, visible);
  const project = index?.project ?? null;
  const projectId = project?.id;
  const profileId = selectedProfileId ?? project?.profileId ?? null;
  const target = useMemo<CalibrationTarget | undefined>(() => selectedProfileId ? { profileId: selectedProfileId } : projectId, [selectedProfileId, projectId]);
  const profileName = profile?.name ?? null;
  const [drag, setDrag] = useState<{ projectId?: string; base: Calibration; calibration: Calibration } | null>(null);
  const cal = drag?.base === paperState?.calibration && drag?.projectId === projectId
    ? drag?.calibration ?? null : paperState?.calibration ?? null;
  const rect = paperState?.rect ?? null;
  const [active, setActive] = useState<CalibrationStep | null>("home");
  const jogScope = useRef<HTMLDivElement>(null);
  const [selectedCorner, setSelectedCorner] = useState("bl");
  const [xyStep, setXyStep] = useState(10);
  const [zStep, setZStep] = useState(0.1);
  const [clickMove, setClickMove] = useState(false);
  const [margin, setMargin] = useState(5);
  const [formatId, setFormatId] = useState<(typeof PAPER_FORMATS)[number]["id"] | null>(null);
  const [formatLandscape, setFormatLandscape] = useState(false);
  const [completedPositions, setCompletedPositions] = useState<Record<string, string>>({});
  const [pressureOpen, setPressureOpen] = useState(false);
  const [pressureBusy, setPressureBusy] = useState(false);
  // Obstacle (no-go zone) editing
  const [obstacles, setObstacles] = useState<Obstacle[]>([]);
  const [obsCaptureActive, setObsCaptureActive] = useState(false);
  const [obsCaptureCorner1, setObsCaptureCorner1] = useState<[number, number] | null>(null);

  const scope = JSON.stringify([projectId, profileId, status?.printer_id ?? status?.backend]);
  const fail = (error: unknown) => { if (!isAbortError(error)) toast.error(errorMessage(error)); };
  const online = !!status?.online;
  const { pos, setPos, refreshPosition, jobs, refreshJobs, previewJob, setPreviewJob, preview } =
    useCalibrationReadings({ visible, scope, connected: online, onError: fail });
  const motionLocked = loading || isPrinterBusy(status);
  const homed = !!pos?.homed;
  const heightSaved = !!cal?.pen_calibrated;
  const atPenPosition = !!cal && homed && !!pos
    && Math.abs(pos.x - cal.calibration_x) < 0.05 && Math.abs(pos.y - cal.calibration_y) < 0.05;
  const ready = !!cal && (!!projectId || !!selectedProfileId) && !!profileId && !loading && !error && !readOnly;
  const commands = useCalibrationCommands({ scope, visible, ready,
    motionAllowed: online && !motionLocked && !pressureBusy, homed,
    fingerprint: profile?.fingerprint, onError: fail, onAction });
  const busy = commands.busy;
  const canEdit = visible && ready && !busy && !pressureBusy && !profile?.archived;
  const notifyCalibrationChanged = () => profileChanged(profileId ?? undefined);

  useEffect(() => {
    if (!paperState) return;
    setMargin(paperState.calibration.paper_margin ?? 5);
    setObstacles(paperState.calibration.obstacles ?? []);
  }, [paperState]);
  // These drafts contain coordinates and must not survive a view/context change.
  useEffect(() => {
    setPressureOpen(false);
    setSelectedCorner("bl");
    setDrag(null);
    setObsCaptureActive(false);
    setObsCaptureCorner1(null);
  }, [scope, visible]);
  useEffect(() => {
    if (active !== "obstacles") {
      setObsCaptureActive(false); setObsCaptureCorner1(null);
    }
  }, [active]);

  const positionsOpen = active === "positions";
  const positions = useSpecialPositions({
    active: visible && positionsOpen, cal, pos, profileId, projectId, target,
    canMove: canEdit && online && !motionLocked,
    onPosition: setPos,
    onCalibration: notifyCalibrationChanged,
    execute: (action, homesFirst) => commands.run(() => action(), { motion: true, needsHome: !homesFirst }),
  });
  const canMove = canEdit && online && !motionLocked && !positions.busy;
  const raisedFor = useRef<string | null>(null);
  const liftScope = JSON.stringify([scope, active]);
  useEffect(() => {
    if (!visible || pressureOpen) { raisedFor.current = null; return; }
    if (!ready || !online || !homed || motionLocked || busy || pressureBusy
        || raisedFor.current === liftScope) return;
    raisedFor.current = liftScope;
    void commands.run(async session => {
      const result = await api.raisePen(target);
      if (session.isCurrent()) setPos(result.position);
    }, { motion: true, needsHome: true, notify: false });
  }, [visible, liftScope, ready, online, homed, motionLocked, busy, pressureBusy, pressureOpen]);

  useEffect(() => {
    if (!visible && active === "positions") setActive(null);
    if (!visible) setPressureOpen(false);
  }, [visible, active]);

  const runMotion = (request: () => Promise<unknown>, needsHome = true) =>
    commands.run(async session => {
      await request();
      if (session.isCurrent()) await refreshPosition(true);
    }, { motion: true, needsHome });
  const jogXY = (x: number, y: number) => runMotion(() => api.jog(x * xyStep, y * xyStep, 0,
    { ...targetBody(target), pen_up_first: true }));
  const jogZ = (dz: number) => runMotion(() => api.jog(0, 0, dz * zStep, targetBody(target)));

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
    visible && ready && online && !motionLocked && homed && (active === "pen" || xyControls),
    { scope: jogScope, motionEnabled: canMove && (active !== "pen" || atPenPosition) }
  );
  const kbd = (dir: string) => (pressed === dir ? " kbd-active" : "");

  const rehome = () => commands.run(async session => {
    await api.home(undefined, target);
    if (!session.isCurrent()) return false;
    await refreshPosition(true);
  }, { motion: true });
  const homeAll = async () => { if (await rehome()) setActive("positions"); };

  const savePenHeight = (which: "up" | "down") => commands.run(async session => {
    const updated = await api.penFromPosition(which, target);
    notifyCalibrationChanged();
    if (!session.isCurrent()) return false;
    toast.success(t(which === "down" ? "paper.penDownSaved" : "paper.penUpSaved",
      { z: (which === "down" ? updated.pen_down_z : updated.pen_up_z).toFixed(2) }));
  }, { motion: true, needsHome: true });

  const setPenHeightValue = (which: "up" | "down", z: number) => commands.run(async () => {
    const updates = which === "down" ? { pen_down_z: z, pen_calibrated: true } : { pen_up_z: z };
    await api.saveCalibration(updates, target);
    notifyCalibrationChanged();
  });
  const saveBedDimension = (field: "bed_width" | "bed_height", value: number) => {
    if (!Number.isFinite(value) || value < 10) return Promise.resolve(false);
    return commands.run(async () => {
      await api.saveCalibration({ [field]: value }, target);
      notifyCalibrationChanged();
    });
  };
  const capture = (corner: string, options?: { mode: "manual" | "diagonal"; diagonal: "bl-tr" | "tl-br" }) => commands.run(async session => {
    await api.setCorner(corner, target, options);
    notifyCalibrationChanged();
    if (!session.isCurrent()) return false;
    toast.success(t("paper.cornerSaved", { corner: corner.toUpperCase() }));
  }, { motion: true, needsHome: true });
  const clearCorner = (corner: string) => commands.run(async () => {
    await api.clearCorner(corner, target);
    notifyCalibrationChanged();
  });
  const resetCorners = () => commands.run(async () => {
    await api.resetPaper(target);
    notifyCalibrationChanged();
  });
  const apply = () => commands.run(async session => {
    if (!marginValid) return false;
    await api.applyPaper(margin, target);
    notifyCalibrationChanged();
    if (!session.isCurrent()) return false;
    toast.success(t("paper.applied"));
  });
  const adoptPaperArea = (advance = false) => commands.run(async session => {
    if (!marginValid || !rect) return false;
    await api.applyPaper(margin, target, true);
    notifyCalibrationChanged();
    if (!session.isCurrent()) return false;
    toast.success(t("paper.applied"));
    if (advance) setActive("apply");
  });
  const plotTest = (name: "frame" | "corners") => commands.run(async session => {
    if (!heightSaved) return false;
    const job = await api.testPattern(name, target);
    // Generating a file is not permission to start it in another view/project,
    // after calibration changes, or after the printer became unavailable.
    if (!session.canMove() || !session.sameCalibration()) return false;
    await api.send(job.filename, true);
    if (session.isCurrent()) toast.success(t(name === "frame" ? "paper.framePlotting" : "paper.cornerTestPlotting"));
  }, { motion: true, needsHome: true });
  const plotFrame = () => plotTest("frame");
  const plotCornerTest = () => plotTest("corners");
  const moveTo = (x: number, y: number) => runMotion(() => api.move(x, y, target));
  const driveToCorner = (corner: string, area: "paper" | "plot") =>
    runMotion(() => api.moveToCorner(corner, area, target));

  // Corner drag handlers (no machine movement)
  const handleDragCorner = (corner: string, x: number, y: number) => {
    if (!canEdit || !cal || !paperState) return;
    const corners = { ...cal.paper_corners, [corner]: [x, y] as [number, number] };
    if (cal.paper_diagonal) {
      const [a, b] = cal.paper_diagonal.split("-").map(key => corners[key]);
      if (a && b) {
        if (cal.paper_diagonal === "bl-tr") { corners.tl = [a[0], b[1]]; corners.br = [b[0], a[1]]; }
        else { corners.bl = [a[0], b[1]]; corners.tr = [b[0], a[1]]; }
      }
    }
    setDrag({ projectId, base: paperState.calibration, calibration: { ...cal, paper_corners: corners } });
  };
  const handleDropCorner = (corner: string, x: number, y: number) => {
    return commands.run(async session => {
      try {
        await api.setCornerAt(corner, x, y, target);
        notifyCalibrationChanged();
        if (session.isCurrent()) setDrag(null);
      } catch (error) { if (session.isCurrent()) setDrag(null); throw error; }
    });
  };

  const capturedCount = Object.keys(cal?.paper_corners ?? {}).length;
  const currentFormat = PAPER_FORMATS.find((format) => format.id === formatId);
  const currentPlot = cal ? plotArea(cal) : { x: 0, y: 0, w: 0, h: 0 };
  const currentBase = cal ? plotAreaBase(cal) : { x: 0, y: 0, w: 0, h: 0 };
  const marginValid = Number.isFinite(margin) && margin >= 0
    && currentBase.w - 2 * margin >= 5 && currentBase.h - 2 * margin >= 5;
  const cornerAngles = paperCornerAngles(cal?.paper_corners ?? {});

  const saveObstacles = (next: Obstacle[]) => commands.run(async session => {
    setObstacles(next);
    try {
      await api.setObstacles(next, target);
      notifyCalibrationChanged();
    } catch (error) {
      if (session.isCurrent()) setObstacles(paperState?.calibration.obstacles ?? []);
      throw error;
    }
  });

  const deleteObstacle = (id: string) => {
    saveObstacles(obstacles.filter((o) => o.id !== id));
  };

  const positionsSignature = cal && Number.isFinite(cal.calibration_x) && Number.isFinite(cal.calibration_y)
    ? JSON.stringify([cal.calibration_x, cal.calibration_y]) : null;
  const positionsDone = !!profileId && positionsSignature !== null && completedPositions[profileId] === positionsSignature;
  const finishPositions = () => { void preparePen(); };

  const preparePen = () => commands.run(async session => {
    if (!cal) return false;
    // Continuing explicitly accepts the displayed default if no point was captured.
    if (!cal.defined_positions?.includes("calibration")) {
      await api.saveCalibration({ calibration_x: cal.calibration_x, calibration_y: cal.calibration_y }, target);
      notifyCalibrationChanged();
      if (!session.canMove()) return false;
    }
    const result = await api.moveToPosition("calibration", undefined, target, true);
    if (!session.isCurrent()) return false;
    setPos(result.position);
    if (profileId && positionsSignature) setCompletedPositions(current => ({ ...current, [profileId]: positionsSignature }));
    setActive("pen");
  }, { motion: true, needsHome: true });
  const testDot = () => runMotion(() => api.testDot(target));
  const testPen = (down: boolean) => runMotion(() => api.pen(down, target));
  const startObstacleCapture = () => { if (canEdit) { setObsCaptureCorner1(null); setObsCaptureActive(true); } };
  const cancelObstacleCapture = () => { setObsCaptureCorner1(null); setObsCaptureActive(false); };
  const captureObstacleCorner = () => {
    if (!canMove || !pos?.homed) return;
    if (!obsCaptureCorner1) { setObsCaptureCorner1([pos.x, pos.y]); return; }
    const [x1, y1] = obsCaptureCorner1;
    const w = Math.abs(pos.x - x1), h = Math.abs(pos.y - y1);
    if (w < 1 || h < 1) { toast.error(t("paper.obsMinSize")); return; }
    void saveObstacles([...obstacles, {
      id: `obs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      x: Math.round(Math.min(x1, pos.x) * 10) / 10,
      y: Math.round(Math.min(y1, pos.y) * 10) / 10,
      w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10,
    }]).then(saved => { if (saved) cancelObstacleCapture(); });
  };
  const retry = () => { void refresh(true).catch(fail); };
  const steps = calibrationSteps({ homed, heightSaved, hasPaper: !!rect, positionsDone });
  return {
    cal, rect, error, retry, readOnly, target, project, profileId, profileName, projectId, active, setActive,
    online, homed, heightSaved, atPenPosition, canMove, canEdit, busy, steps, positions, positionsOpen, finishPositions,
    pressureOpen, pressureBusy, setPressureOpen, setPressureBusy, motionLocked, pos, setPos,
    homeAll, rehome, preparePen, testDot, jogScope, selectedCorner, setSelectedCorner, xyStep, setXyStep, zStep, setZStep, clickMove, setClickMove, margin, setMargin,
    formatId, setFormatId, formatLandscape, setFormatLandscape, jobs, previewJob,
    setPreviewJob, preview, obstacles, obsCaptureActive, obsCaptureCorner1,
    startObstacleCapture, cancelObstacleCapture, captureObstacleCorner, saveObstacles,
    deleteObstacle, jogXY, jogZ, kbd, testPen, savePenHeight, setPenHeightValue,
    saveBedDimension, capture, clearCorner, resetCorners, apply, adoptPaperArea, plotFrame, plotCornerTest,
    moveTo, driveToCorner, handleDragCorner, handleDropCorner, capturedCount, currentFormat,
    currentPlot, currentBase, marginValid, cornerAngles, fail, refreshJobs, visible
  };
}

export type CalibrationController = ReturnType<typeof useCalibrationController>;
