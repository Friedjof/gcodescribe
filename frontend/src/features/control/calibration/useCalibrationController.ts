import { useCallback, useEffect, useState } from "react";
import { api, type Calibration, type GcodePreview, type Job, type Obstacle, type PaperState, type Position, type PrinterStatus } from "../../../api";
import { errorMessage } from "../../../api/errors";
import { isPrinterBusy } from "../../../lib/printerState";
import { useArrowKeys } from "../../../hooks";
import { useI18n } from "../../../i18n";
import { useToasts } from "../../../components/Toasts";
import { useProjectCalibration } from "../../../state/ProjectCalibrationContext";
import { useSpecialPositions } from "../useSpecialPositions";
import { SPECIAL_POSITIONS } from "../specialPositions";
import { PAPER_FORMATS, paperCornerAngles, plotArea, plotAreaBase } from "../paperLayout";
import { calibrationSteps, type CalibrationStep } from "./steps";

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
  const [pos, setPos] = useState<Position | null>(null);
  const [active, setActive] = useState<CalibrationStep | null>("home");
  const [xyStep, setXyStep] = useState(10);
  const [zStep, setZStep] = useState(0.1);
  const [clickMove, setClickMove] = useState(false);
  const [margin, setMargin] = useState(5);
  const [formatId, setFormatId] = useState<(typeof PAPER_FORMATS)[number]["id"] | null>(null);
  const [formatLandscape, setFormatLandscape] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [previewJob, setPreviewJob] = useState("");
  const [preview, setPreview] = useState<GcodePreview | null>(null);
  const [completedPositions, setCompletedPositions] = useState<Record<string, string>>({});
  const [pressureOpen, setPressureOpen] = useState(false);
  const [pressureBusy, setPressureBusy] = useState(false);
  // Obstacle (no-go zone) editing
  const [obstacles, setObstacles] = useState<Obstacle[]>([]);
  const [obsCaptureActive, setObsCaptureActive] = useState(false);
  const [obsCaptureCorner1, setObsCaptureCorner1] = useState<[number, number] | null>(null);

  const online = status?.online;
  const motionLocked = loading || isPrinterBusy(status);
  const homed = !!pos?.homed;
  const heightSaved = !!cal?.pen_calibrated;

  const notifyCalibrationChanged = () => profileChanged(profileId ?? undefined);
  const applyPaperState = (_state: PaperState) => notifyCalibrationChanged();

  useEffect(() => {
    if (!paperState) return;
    setMargin(paperState.calibration.paper_margin ?? 5);
    setObstacles(paperState.calibration.obstacles ?? []);
  }, [paperState]);
  useEffect(() => { setPressureOpen(false); }, [projectId, profileId]);

  const refreshPosition = useCallback(
    () => api.position().then(setPos).catch(() => setPos(null)),
    []
  );

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    api.listJobs().then(jobs => { if (!cancelled) setJobs(jobs); }).catch(() => {});
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
    onCalibration: notifyCalibrationChanged,
    onAction,
  });
  const canMove = online && !motionLocked && !positions.busy && !pressureBusy;

  useEffect(() => {
    if (!visible && active === "positions") setActive(null);
    if (!visible) setPressureOpen(false);
  }, [visible, active]);

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

  const homeAll = () =>
    api.home(undefined, projectId)
      .then(() => { refreshPosition(); setActive("pen"); })
      .catch(fail);

  const savePenHeight = (which: "up" | "down") =>
    api.penFromPosition(which, projectId)
      .then((c) => {
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
    api.saveCalibration(updates, projectId).then(() => { notifyCalibrationChanged(); }).catch(fail);
  };

  const saveBedDimension = (field: "bed_width" | "bed_height", val: number) => {
    if (val < 10) return;
    api.saveCalibration({ [field]: val }, projectId).then(() => { notifyCalibrationChanged(); }).catch(fail);
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
    if (!cal || !paperState) return;
    setDrag({ projectId, base: paperState.calibration, calibration: {
      ...cal, paper_corners: { ...cal.paper_corners, [corner]: [x, y] },
    } });
  };
  const handleDropCorner = (corner: string, x: number, y: number) => {
    api.setCornerAt(corner, x, y, projectId).then(applyPaperState).catch(fail);
  };

  const capturedCount = Object.keys(cal?.paper_corners ?? {}).length;
  const currentFormat = PAPER_FORMATS.find((format) => format.id === formatId);
  const currentPlot = cal ? plotArea(cal) : { x: 0, y: 0, w: 0, h: 0 };
  const currentBase = cal ? plotAreaBase(cal) : { x: 0, y: 0, w: 0, h: 0 };
  const marginValid = Number.isFinite(margin) && margin >= 0
    && currentBase.w - 2 * margin >= 5 && currentBase.h - 2 * margin >= 5;
  const cornerAngles = paperCornerAngles(cal?.paper_corners ?? {});

  const saveObstacles = (next: Obstacle[]) => {
    setObstacles(next);
    api.setObstacles(next, projectId).then(applyPaperState).catch(fail);
  };

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

  const refreshJobs = () => api.listJobs().then(setJobs).catch(() => {});
  const testPen = (down: boolean) => run(() => api.pen(down, projectId));
  const startObstacleCapture = () => { setObsCaptureCorner1(null); setObsCaptureActive(true); };
  const cancelObstacleCapture = () => { setObsCaptureCorner1(null); setObsCaptureActive(false); };
  const captureObstacleCorner = () => {
    if (!pos?.homed) return;
    if (!obsCaptureCorner1) { setObsCaptureCorner1([pos.x, pos.y]); return; }
    const [x1, y1] = obsCaptureCorner1;
    const w = Math.abs(pos.x - x1), h = Math.abs(pos.y - y1);
    if (w < 1 || h < 1) { toast.error(t("paper.obsMinSize")); return; }
    saveObstacles([...obstacles, {
      id: `obs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      x: Math.round(Math.min(x1, pos.x) * 10) / 10,
      y: Math.round(Math.min(y1, pos.y) * 10) / 10,
      w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10,
    }]);
    cancelObstacleCapture();
  };
  const retry = () => { void refresh(true).catch(fail); };
  const steps = calibrationSteps({ homed, heightSaved, hasPaper: !!rect, positionsDone });
  return {
    cal, rect, error, retry, project, profileId, profileName, projectId, active, setActive,
    online, homed, heightSaved, canMove, steps, positions, positionsOpen, finishPositions,
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
