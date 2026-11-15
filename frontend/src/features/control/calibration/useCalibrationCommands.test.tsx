// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useCalibrationCommands } from "./useCalibrationCommands";

afterEach(cleanup);
const input = () => ({ scope: "project/profile/serial", visible: true, ready: true,
  motionAllowed: true, homed: true, fingerprint: "original", onError: vi.fn(), onAction: vi.fn() });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

it("sends one command at a time and drops duplicate clicks instead of queuing movements", async () => {
  const initial = input();
  const { result } = renderHook(useCalibrationCommands, { initialProps: initial });
  const pending = deferred();
  const first = vi.fn(async () => { await pending.promise; });
  const second = vi.fn();
  let command!: Promise<boolean>;
  act(() => { command = result.current.run(first, { motion: true }); });
  expect(result.current.busy).toBe(true);
  await act(async () => { expect(await result.current.run(second, { motion: true })).toBe(false); });
  expect(first).toHaveBeenCalledOnce();
  expect(second).not.toHaveBeenCalled();
  await act(async () => { pending.resolve(); await command; });
  expect(result.current.busy).toBe(false);
  expect(initial.onAction).toHaveBeenCalledOnce();
});

it.each(["scope", "visible"] as const)("invalidates a pending continuation on %s changes", async key => {
  const initial = input();
  const { result, rerender } = renderHook(useCalibrationCommands, { initialProps: initial });
  const pending = deferred();
  const continuation = vi.fn();
  let command!: Promise<boolean>;
  act(() => { command = result.current.run(async session => {
    await pending.promise;
    if (session.isCurrent()) continuation();
  }); });
  rerender(key === "scope" ? { ...initial, scope: "other/profile/serial" } : { ...initial, visible: false });
  await act(async () => { pending.resolve(); expect(await command).toBe(false); });
  expect(continuation).not.toHaveBeenCalled();
  expect(initial.onAction).not.toHaveBeenCalled();
});

it("rejects old command callbacks when they refer to another project", async () => {
  const initial = input();
  const { result, rerender } = renderHook(useCalibrationCommands, { initialProps: initial });
  const run = result.current.run;
  rerender({ ...initial, scope: "other/profile/serial" });
  const action = vi.fn();
  await act(async () => { expect(await run(action)).toBe(false); });
  expect(action).not.toHaveBeenCalled();
});

it("rechecks readiness, homing and calibration before a second movement stage", async () => {
  const initial = input();
  const { result, rerender } = renderHook(useCalibrationCommands, { initialProps: initial });
  const pending = deferred();
  const send = vi.fn();
  let command!: Promise<boolean>;
  act(() => { command = result.current.run(async session => {
    await pending.promise;
    if (session.canMove() && session.sameCalibration()) send();
  }, { motion: true, needsHome: true }); });
  rerender({ ...initial, fingerprint: "updated", homed: false, motionAllowed: false });
  await act(async () => { pending.resolve(); await command; });
  expect(send).not.toHaveBeenCalled();
});

it("does not retry failed commands and becomes available after the failure", async () => {
  const initial = input();
  const { result } = renderHook(useCalibrationCommands, { initialProps: initial });
  const action = vi.fn().mockRejectedValue(new Error("Disconnected"));
  await act(async () => { expect(await result.current.run(action)).toBe(false); });
  expect(action).toHaveBeenCalledOnce();
  expect(initial.onError).toHaveBeenCalledOnce();
  expect(result.current.busy).toBe(false);
});

it("keeps offline layout edits available while refusing motion and unhomed capture", async () => {
  const initial = { ...input(), motionAllowed: false, homed: false };
  const { result } = renderHook(useCalibrationCommands, { initialProps: initial });
  const edit = vi.fn().mockResolvedValue(undefined), motion = vi.fn();
  await act(async () => {
    expect(await result.current.run(motion, { motion: true })).toBe(false);
    expect(await result.current.run(motion, { needsHome: true })).toBe(false);
    expect(await result.current.run(edit)).toBe(true);
  });
  expect(motion).not.toHaveBeenCalled();
  expect(edit).toHaveBeenCalledOnce();
});
