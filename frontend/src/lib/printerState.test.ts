import { describe, expect, it } from "vitest";
import type { PrinterStatus } from "../api/types/printer";
import { hasActiveJob, isManualMotionLocked, isPrinterBusy, printerProgress } from "./printerState";

describe("shared serial and OctoPrint state policies", () => {
  it.each(["Printing", "Printing from SD", "Starting", "Pausing", "Resuming", "Finishing", "Cancelling"])(
    "blocks motion and configuration while %s", state => {
      const status: PrinterStatus = { configured: true, online: true, job: { state } };
      expect(hasActiveJob(status)).toBe(true);
      expect(isManualMotionLocked(status)).toBe(true);
      expect(isPrinterBusy(status)).toBe(true);
    },
  );

  it("permits jogging in a settled pause but blocks calibration and new jobs", () => {
    const paused: PrinterStatus = { configured: true, online: true, job: { state: "Paused" } };
    expect(hasActiveJob(paused)).toBe(true);
    expect(isManualMotionLocked(paused)).toBe(false);
    expect(isPrinterBusy(paused)).toBe(true);
    expect(isManualMotionLocked({ ...paused, motion_locked: true })).toBe(true);
  });

  it.each([null, { configured: false }, { configured: true, online: false },
    { configured: true, online: true, job: null },
    { configured: true, job: { state: "Operational" } }] satisfies Array<PrinterStatus | null>)(
    "handles missing jobs and disconnected snapshots: %j", status => {
      expect(hasActiveJob(status)).toBe(false);
      expect(isManualMotionLocked(status)).toBe(false);
      expect(isPrinterBusy(status)).toBe(false);
      expect(printerProgress(status)).toBe(null);
    },
  );

  it("keeps an explicit movement lock even without a job payload", () => {
    const status: PrinterStatus = { configured: true, motion_locked: true };
    expect(isManualMotionLocked(status)).toBe(true);
    expect(isPrinterBusy(status)).toBe(true);
  });

  it.each([[NaN, null], [Infinity, null], [null, null], [-1, 0], [123, 100], [31.4, 31.4]])(
    "normalizes progress %s to %s", (completion, expected) => {
      expect(printerProgress({ configured: true, job: { progress: { completion } } })).toBe(expected);
    },
  );
});
