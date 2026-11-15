import { useEffect, useState } from "react";
import { api, type Calibration, type Obstacle, type PrinterStatus } from "../../../api";
import { errorMessage, isAbortError } from "../../../api/errors";
import { isPrinterBusy } from "../../../lib/printerState";
import { useArrowKeys } from "../../../hooks";
import { useI18n } from "../../../i18n";
import { useToasts } from "../../../components/Toasts";
import { useProjectCalibration } from "../../../state/ProjectCalibrationContext";
import { useSpecialPositions } from "../useSpecialPositions";
import { SPECIAL_POSITIONS } from "../specialPositions";
import { PAPER_FORMATS, paperCornerAngles, plotArea, plotAreaBase } from "../paperLayout";
import { calibrationSteps, type CalibrationStep } from "./steps";
import { useCalibrationReadings } from "./useCalibrationReadings";
import { useCalibrationCommands } from "./useCalibrationCommands";

export interface CalibrationControllerProps { status: PrinterStatus | null; onAction: () => void; visible?: boolean }

export function useCalibrationController({ status, onAction, visible = true }: CalibrationControllerProps) {
  const { t } = useI18n();
  const toast = useToasts();
  const { index, profile, paper: paperState, loading, error, refresh, profileChanged } = useProjectCalibration();
  const project = index?.project ?? null;
  const projectId = project?.id;
  const profileId = project?.profileId ?? null;
  const profileName = profile?.name ?? null;
  const [drag, setDrag] = useState<{ projectId?: string; base: Calibration; calibration: Calibration } | null>(null);
  const cal = drag?.base === paperState?.calibration && drag?.projectId === projectId
    ? drag?.calibration ?? null : paperState?.calibration ?? null;
  const rect = paperState?.rect ?? null;
  const [active, setActive] = useState<CalibrationStep | null>("home");
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

  const scope = JSON.stringify([projectId, profileId, status?.backend]);
  const fail = (error: unknown) => { if (!isAbortError(error)) toast.error(errorMessage(error)); };
  const { pos, setPos, refreshPosition, jobs, refreshJobs, previewJob, setPreviewJob, preview } =
    useCalibrationReadings({ visible, scope, onError: fail });
  const online = !!status?.online;
  const motionLocked = loading || isPrinterBusy(status);
  const homed = !!pos?.homed;
  const heightSaved = !!cal?.pen_calibrated;
  const ready = !!cal && !!projectId && !!profileId && !loading && !error;
  const commands = useCalibrationCommands({ scope, visible, ready,
    motionAllowed: online && !motionLocked && !pressureBusy, homed,
    fingerprint: profile?.fingerprint, onError: fail, onAction });
  const busy = commands.busy;
  const canEdit = visible && ready && !busy && !pressureBusy;
  const notifyCalibrationChanged = () => profileChanged(profileId ?? undefined);

  useEffect(() => {
    if (!paperState) return;
    setMargin(paperState.calibration.paper_margin ?? 5);
    setObstacles(paperState.calibration.obstacles ?? []);
  }, [paperState]);
  // These drafts contain coordinates and must not survive a view/context change.
  useEffect(() => {
    setPressureOpen(false);
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
    active: visible && positionsOpen, cal, pos, profileId, projectId,
    canMove: canEdit && online && !motionLocked,
    onPosition: setPos,
    onCalibration: notifyCalibrationChanged,
    execute: (action, homesFirst) => commands.run(() => action(), { motion: true, needsHome: !homesFirst }),
  });
  const canMove = canEdit && online && !motionLocked && !positions.busy;

  useEffect(() => {
    if (!visible && active === "positions") setActive(null);
    if (!visible) setPressureOpen(false);
  }, [visible, active]);

  const runMotion = (request: () => Promise<unknown>, needsHome = true) =>
    commands.run(async session => {
      await request();
      if (session.isCurrent()) await refreshPosition(true);
    }, { motion: true, needsHome });
  const jogXY = (x: number, y: number) => runMotion(() => api.jog(x * xyStep, y * xyStep, 0, { projectId }));
  const jogZ = (dz: number) => runMotion(() => api.jog(0, 0, dz * zStep, { projectId }));

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

  const homeAll = () => commands.run(async session => {
    await api.home(undefined, projectId);
    if (!session.isCurrent()) return false;
    await refreshPosition(true);
    if (session.isCurrent()) setActive("pen");
  }, { motion: true });

  const savePenHeight = (which: "up" | "down") => commands.run(async session => {
    const updated = await api.penFromPosition(which, projectId);
    notifyCalibrationChanged();
    if (!session.isCurrent()) return false;
    toast.success(t(which === "down" ? "paper.penDownSaved" : "paper.penUpSaved",
      { z: (which === "down" ? updated.pen_down_z : updated.pen_up_z).toFixed(2) }));
  }, { motion: true, needsHome: true });

  const setPenHeightValue = (which: "up" | "down", z: number) => commands.run(async () => {
    const updates = which === "down" ? { pen_down_z: z, pen_calibrated: true } : { pen_up_z: z };
    await api.saveCalibration(updates, projectId);
    notifyCalibrationChanged();
  });
  const saveBedDimension = (field: "bed_width" | "bed_height", value: number) => {
    if (!Number.isFinite(value) || value < 10) return Promise.resolve(false);
    return commands.run(async () => {
      await api.saveCalibration({ [field]: value }, projectId);
      notifyCalibrationChanged();
    });
  };
  const capture = (corner: string) => commands.run(async session => {
    await api.setCorner(corner, projectId);
    notifyCalibrationChanged();
    if (!session.isCurrent()) return false;
    toast.success(t("paper.cornerSaved", { corner: corner.toUpperCase() }));
  }, { motion: true, needsHome: true });
  const clearCorner = (corner: string) => commands.run(async () => {
    await api.clearCorner(corner, projectId);
    notifyCalibrationChanged();
  });
  const resetCorners = () => commands.run(async () => {
    await api.resetPaper(projectId);
    notifyCalibrationChanged();
  });
  const apply = () => commands.run(async session => {
    if (!marginValid) return false;
    await api.applyPaper(margin, projectId);
    notifyCalibrationChanged();
    if (!session.isCurrent()) return false;
    toast.success(t("paper.applied"));
  });
  const adoptPaperArea = (advance = false) => commands.run(async session => {
    if (!marginValid || !rect) return false;
    await api.applyPaper(margin, projectId, true);
    notifyCalibrationChanged();
    if (!session.isCurrent()) return false;
    toast.success(t("paper.applied"));
    if (advance) setActive("apply");
  });
  const plotFrame = () => commands.run(async session => {
    if (!heightSaved) return false;
    const job = await api.testPattern("frame", projectId);
    // Generating a file is not permission to start it in another view/project,
    // after calibration changes, or after the printer became unavailable.
    if (!session.canMove() || !session.sameCalibration()) return false;
    await api.send(job.filename, true);
    if (session.isCurrent()) toast.success(t("paper.framePlotting"));
  }, { motion: true, needsHome: true });
  const moveTo = (x: number, y: number) => runMotion(() => api.move(x, y, projectId));
  const driveToCorner = (corner: string, target: "paper" | "plot") =>
    runMotion(() => api.moveToCorner(corner, target, projectId));

  // Corner drag handlers (no machine movement)
  const handleDragCorner = (corner: string, x: number, y: number) => {
    if (!canEdit || !cal || !paperState) return;
    setDrag({ projectId, base: paperState.calibration, calibration: {
      ...cal, paper_corners: { ...cal.paper_corners, [corner]: [x, y] },
    } });
  };
  const handleDropCorner = (corner: string, x: number, y: number) => {
    return commands.run(async session => {
      try {
        await api.setCornerAt(corner, x, y, projectId);
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
      await api.setObstacles(next, projectId);
      notifyCalibrationChanged();
    } catch (error) {
      if (session.isCurrent()) setObstacles(paperState?.calibration.obstacles ?? []);
      throw error;
    }
  });

  const deleteObstacle = (id: string) => {
    saveObstacles(obstacles.filter((o) => o.id !== id));
  };

  const positionsSignature = cal && SPECIAL_POSITIONS.every(({ kind, x, y }) =>
    cal.defined_positions?.includes(kind) && Number.isFinite(cal[x]) && Number.isFinite(cal[y]))
    ? JSON.stringify(SPECIAL_POSITIONS.map(({ x, y }) => [cal[x], cal[y]])) : null;
  const positionsDone = !!profileId && positionsSignature !== null && completedPositions[profileId] === positionsSignature;
  const finishPositions = () => {
    if (profileId && positionsSignature !== null) {
      setCompletedPositions((current) => ({ ...current, [profileId]: positionsSignature }));
    }
    setActive("corners");
  };

  const testPen = (down: boolean) => runMotion(() => api.pen(down, projectId));
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
    cal, rect, error, retry, project, profileId, profileName, projectId, active, setActive,
    online, homed, heightSaved, canMove, canEdit, busy, steps, positions, positionsOpen, finishPositions,
    pressureOpen, pressureBusy, setPressureOpen, setPressureBusy, motionLocked, pos, setPos,
    homeAll, xyStep, setXyStep, zStep, setZStep, clickMove, setClickMove, margin, setMargin,
    formatId, setFormatId, formatLandscape, setFormatLandscape, jobs, previewJob,
    setPreviewJob, preview, obstacles, obsCaptureActive, obsCaptureCorner1,
    startObstacleCapture, cancelObstacleCapture, captureObstacleCorner, saveObstacles,
    deleteObstacle, jogXY, jogZ, kbd, testPen, savePenHeight, setPenHeightValue,
    saveBedDimension, capture, clearCorner, resetCorners, apply, adoptPaperArea, plotFrame,
    moveTo, driveToCorner, handleDragCorner, handleDropCorner, capturedCount, currentFormat,
    currentPlot, currentBase, marginValid, cornerAngles, fail, refreshJobs, visible
  };
}

export type CalibrationController = ReturnType<typeof useCalibrationController>;
