import type { PrinterStatus } from "../api/types/printer";

type Snapshot = PrinterStatus | null | undefined;
const MOTION_STATES = ["printing", "starting", "pausing", "resuming", "finishing", "cancelling"];

// OctoPrint supplies labels such as "Printing from SD", serial uses "Printing".
export const printerJobState = (status: Snapshot): string =>
  typeof status?.job?.state === "string" ? status.job.state.toLowerCase() : "";

export const isPrinting = (status: Snapshot): boolean => printerJobState(status).includes("printing");
export const isPaused = (status: Snapshot): boolean => printerJobState(status).includes("paused");

export const hasActiveJob = (status: Snapshot): boolean => {
  const state = printerJobState(status);
  return isPaused(status) || MOTION_STATES.some(active => state.includes(active));
};

/** A settled pause allows manual jogging; parking/restoring still locks it. */
export const isManualMotionLocked = (status: Snapshot): boolean =>
  !!status?.motion_locked || MOTION_STATES.some(active => printerJobState(status).includes(active));

/** Calibration, new jobs and backend/profile switches must also wait on pause. */
export const isPrinterBusy = (status: Snapshot): boolean =>
  !!status?.motion_locked || hasActiveJob(status);

export const printerProgress = (status: Snapshot): number | null => {
  const value = status?.job?.progress?.completion;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value)) : null;
};
