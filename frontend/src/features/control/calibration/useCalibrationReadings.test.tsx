// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GcodePreview, Position } from "../../../api";
import { useCalibrationReadings } from "./useCalibrationReadings";

const mocks = vi.hoisted(() => ({ position: vi.fn(), listJobs: vi.fn(), jobPreview: vi.fn() }));
vi.mock("../../../api", () => ({ api: mocks }));
const head: Position = { x: 10, y: 20, z: 5, homed: true, homed_axes: ["x", "y", "z"] };
const drawing = (x: number): GcodePreview => ({ polylines: [[[x, 0], [x, 1]]], travels: [], bounds: null, truncated: false });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const props = () => ({ visible: true, scope: "project/profile/serial", onError: vi.fn() });
beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset());
  mocks.position.mockResolvedValue(head);
  mocks.listJobs.mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("loads offline resources without querying printer position or starting its polling timer", async () => {
  vi.useFakeTimers();
  const initial = { ...props(), connected: false };
  const { result } = renderHook(useCalibrationReadings, { initialProps: initial });
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(mocks.listJobs).toHaveBeenCalledOnce();
  expect(mocks.position).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  expect(result.current.pos).toBeNull();
});

it("discards a pending head position on disconnect and resumes fresh reads on reconnect", async () => {
  const pending = deferred<Position>();
  mocks.position.mockReturnValueOnce(pending.promise);
  const initial = { ...props(), connected: true };
  const { result, rerender } = renderHook(useCalibrationReadings, { initialProps: initial });
  await waitFor(() => expect(mocks.position).toHaveBeenCalledOnce());
  const signal = mocks.position.mock.calls[0][0];
  rerender({ ...initial, connected: false });
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(head));
  expect(result.current.pos).toBeNull();
  mocks.position.mockResolvedValue({ ...head, homed: false });
  rerender(initial);
  await waitFor(() => expect(result.current.pos?.homed).toBe(false));
});

it("keeps the newest preview even when the previous file resolves late", async () => {
  const a = deferred<GcodePreview>(), b = deferred<GcodePreview>();
  mocks.jobPreview.mockImplementation(name => name === "a" ? a.promise : b.promise);
  const { result } = renderHook(useCalibrationReadings, { initialProps: props() });
  act(() => result.current.setPreviewJob("a"));
  const oldSignal = mocks.jobPreview.mock.calls[0][1];
  act(() => result.current.setPreviewJob("b"));
  expect(oldSignal.aborted).toBe(true);
  await act(async () => b.resolve(drawing(20)));
  expect(result.current.preview).toEqual(drawing(20));
  await act(async () => a.resolve(drawing(10)));
  expect(result.current.preview).toEqual(drawing(20));
});

it("does not let an old poll overwrite a confirmed machine position", async () => {
  const pending = deferred<Position>();
  mocks.position.mockReturnValueOnce(pending.promise);
  const { result } = renderHook(useCalibrationReadings, { initialProps: props() });
  await waitFor(() => expect(mocks.position).toHaveBeenCalledOnce());
  const oldSignal = mocks.position.mock.calls[0][0];
  act(() => result.current.setPos({ ...head, x: 80 }));
  expect(oldSignal.aborted).toBe(true);
  await act(async () => pending.resolve(head));
  expect(result.current.pos?.x).toBe(80);
});

it("drops a position response from another project/backend", async () => {
  const pending = deferred<Position>();
  mocks.position.mockReturnValueOnce(pending.promise);
  const initial = props();
  const { result, rerender } = renderHook(useCalibrationReadings, { initialProps: initial });
  await waitFor(() => expect(mocks.position).toHaveBeenCalledOnce());
  mocks.position.mockResolvedValue({ ...head, x: 90 });
  rerender({ ...initial, scope: "other/profile/octoprint" });
  await waitFor(() => expect(result.current.pos?.x).toBe(90));
  await act(async () => pending.resolve(head));
  expect(result.current.pos?.x).toBe(90);
});

it("requires a fresh position after returning to the same view", async () => {
  const initial = props();
  const { result, rerender } = renderHook(useCalibrationReadings, { initialProps: initial });
  await waitFor(() => expect(result.current.pos?.homed).toBe(true));
  rerender({ ...initial, visible: false });
  const pending = deferred<Position>();
  mocks.position.mockReturnValueOnce(pending.promise);
  rerender(initial);
  expect(result.current.pos).toBeNull();
  await act(async () => pending.resolve({ ...head, homed: false, homed_axes: [] }));
  expect(result.current.pos?.homed).toBe(false);
});

it("coalesces slow polls and stops reads and timers when hidden or unmounted", async () => {
  vi.useFakeTimers();
  const pending = deferred<Position>();
  mocks.position.mockReturnValue(pending.promise);
  const initial = props();
  const { rerender, unmount } = renderHook(useCalibrationReadings, { initialProps: initial });
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(mocks.position).toHaveBeenCalledOnce();
  const signal = mocks.position.mock.calls[0][0];
  rerender({ ...initial, visible: false });
  expect(signal.aborted).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(mocks.position).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  unmount();
  await act(async () => pending.resolve(head));
  expect(initial.onError).not.toHaveBeenCalled();
});

it("clears a preview when selecting another project and ignores late preview errors", async () => {
  const initial = props();
  const { result, rerender } = renderHook(useCalibrationReadings, { initialProps: initial });
  let reject!: (error: unknown) => void;
  mocks.jobPreview.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  act(() => result.current.setPreviewJob("old-job"));
  rerender({ ...initial, scope: "other/profile/serial" });
  expect(result.current.previewJob).toBe("");
  expect(result.current.preview).toBeNull();
  await act(async () => reject(new Error("Old preview failed")));
  expect(initial.onError).not.toHaveBeenCalled();
});
