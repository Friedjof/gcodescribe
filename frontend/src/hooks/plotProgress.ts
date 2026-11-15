import type { PrinterStatus } from "../api/types/printer";
import { isPrinting, printerJobState, printerProgress } from "../lib/printerState";
export interface PlotNotice { filename: string; pct: number }
export interface PlotTracker {
  initialized: boolean;
  jobKey: string | null;
  notified: Set<number>;
  lastProgress: number | null;
  wasPrinting: boolean;
  lastResultId: string | null;
  completedKey: string | null;
}
export const newPlotTracker = (): PlotTracker => ({
  initialized: false, jobKey: null, notified: new Set(), lastProgress: null,
  wasPrinting: false, lastResultId: null, completedKey: null,
});

/** Advance only from observed progress or an explicit terminal result. */
export function plotNotices(tracker: PlotTracker, status: PrinterStatus | null): PlotNotice[] {
  if (status?.online !== true) return [];
  const notices: PlotNotice[] = [];
  const first = !tracker.initialized;
  const result = status.last_job;
  if (first) { tracker.initialized = true; tracker.lastResultId = result?.id ?? null; }
  const job = status.job;
  const filename = job?.job?.file?.name;
  const key = filename ? `${status.backend ?? "printer"}:${job?.id ?? filename}` : null;
  const state = printerJobState(status);
  const printing = isPrinting(status);
  const progress = printerProgress(status);

  if (key && (key !== tracker.jobKey || (printing && !tracker.wasPrinting
      && (tracker.notified.has(100) || (progress != null && progress < (tracker.lastProgress ?? 0)))))) {
    tracker.jobKey = key;
    tracker.notified = new Set();
    tracker.lastProgress = null;
  }
  // Opening an idle client should not announce an old completed job.
  if (first && !printing && progress === 100) [25, 50, 90, 100].forEach(pct => tracker.notified.add(pct));
  const finished = progress === 100 && !status.error && !/cancel|error|offline|paused/.test(state);
  if (filename && key && progress != null && (printing || finished)) {
    const crossed = [25, 50, 90, 100].filter(pct => pct <= progress && !tracker.notified.has(pct));
    crossed.forEach(pct => tracker.notified.add(pct));
    const pct = crossed[crossed.length - 1];
    if (pct != null) {
      notices.push({ filename, pct });
      if (pct === 100) tracker.completedKey = key;
    }
    tracker.lastProgress = progress;
  }
  if (result?.id && result.id !== tracker.lastResultId) {
    tracker.lastResultId = result.id;
    const resultKey = `${status.backend ?? "printer"}:${result.id}`;
    if (result.outcome === "completed" && result.filename && tracker.completedKey !== resultKey) {
      notices.push({ filename: result.filename, pct: 100 });
      tracker.completedKey = resultKey;
    }
  }
  tracker.wasPrinting = printing;
  return notices;
}
