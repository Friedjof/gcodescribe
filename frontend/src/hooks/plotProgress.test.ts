import { expect, it } from "vitest";
import { newPlotTracker, plotNotices } from "./plotProgress";

const status = (pct: number, state = "Printing", id?: string) => ({ online: true, backend: "serial",
  job: { id, state, progress: { completion: pct }, job: { file: { name: "drawing.gcode" } } } });

it("only emits the latest crossed milestone and never follows it with old milestones", () => {
  const tracker = newPlotTracker();
  expect(plotNotices(tracker, status(72))).toEqual([{ filename: "drawing.gcode", pct: 50 }]);
  expect(plotNotices(tracker, status(72))).toEqual([]);
  expect(plotNotices(tracker, status(92))).toEqual([{ filename: "drawing.gcode", pct: 90 }]);
});
it("does not call a disappeared, cancelled, failed or disconnected 99% job complete", () => {
  for (const outcome of [undefined, "cancelled", "failed"]) {
    const tracker = newPlotTracker();
    plotNotices(tracker, status(99, "Printing", "one"));
    expect(plotNotices(tracker, { online: true, backend: "serial", job: null,
      last_job: outcome ? { id: "one", filename: "drawing.gcode", outcome } : null })).toEqual([]);
    expect(plotNotices(tracker, null)).toEqual([]);
  }
});
it("uses explicit completion even if polling never observed the final 100%", () => {
  const tracker = newPlotTracker();
  plotNotices(tracker, status(30, "Printing", "one"));
  const done = { online: true, backend: "serial", job: null,
    last_job: { id: "one", filename: "drawing.gcode", outcome: "completed" } };
  expect(plotNotices(tracker, done)).toEqual([{ filename: "drawing.gcode", pct: 100 }]);
  expect(plotNotices(tracker, done)).toEqual([]);
});
it("does not duplicate progress-100 and terminal-result notifications", () => {
  const tracker = newPlotTracker();
  plotNotices(tracker, status(99, "Printing", "one"));
  expect(plotNotices(tracker, status(100, "Printing", "one"))).toHaveLength(1);
  expect(plotNotices(tracker, { online: true, backend: "serial", job: null,
    last_job: { id: "one", filename: "drawing.gcode", outcome: "completed" } })).toEqual([]);
});
it("does not announce historical completion when opening an idle client", () => {
  const tracker = newPlotTracker();
  const idle = { ...status(100, "Operational"), last_job: { id: "old", filename: "drawing.gcode", outcome: "completed" } };
  expect(plotNotices(tracker, idle)).toEqual([]);
  expect(plotNotices(tracker, idle)).toEqual([]);
});
it("can notify a fast job after observing an idle connected printer", () => {
  const tracker = newPlotTracker();
  plotNotices(tracker, { online: true });
  expect(plotNotices(tracker, { online: true, backend: "serial",
    last_job: { id: "new", filename: "quick.gcode", outcome: "completed" } })).toEqual([{ filename: "quick.gcode", pct: 100 }]);
});
it("retains progress across pause/resume and tracks repeated jobs with the same filename", () => {
  const tracker = newPlotTracker();
  plotNotices(tracker, status(60));
  expect(plotNotices(tracker, status(60, "Paused"))).toEqual([]);
  expect(plotNotices(tracker, status(60))).toEqual([]);
  plotNotices(tracker, status(100, "Operational"));
  expect(plotNotices(tracker, status(0))).toEqual([]);
  expect(plotNotices(tracker, status(25))).toEqual([{ filename: "drawing.gcode", pct: 25 }]);
});
