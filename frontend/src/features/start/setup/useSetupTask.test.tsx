// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSetupTask } from "./useSetupTask";
afterEach(cleanup);
it("serializes explicit commands and ignores late errors after a project change", async () => {
  let reject!: (reason: Error) => void;
  const flight = new Promise<void>((_, no) => {
    reject = no;
  });
  const view = renderHook(({ scope, active }) => useSetupTask(scope, active), {
    initialProps: { scope: "one", active: true },
  });
  let command!: Promise<void>;
  act(() => {
    command = view.result.current.run(async () => flight);
  });
  expect(view.result.current.busy).toBe(true);
  const second = vi.fn();
  await act(async () => view.result.current.run(second));
  expect(second).not.toHaveBeenCalled();
  view.rerender({ scope: "two", active: true });
  await act(async () => {
    reject(new Error("Old project error"));
    await command;
  });
  expect(view.result.current.error).toBeNull();
  expect(view.result.current.busy).toBe(false);
});
it("invalidates the current session while the guide is hidden", async () => {
  let finish!: () => void,
    stillCurrent = true;
  const flight = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const view = renderHook(({ active }) => useSetupTask("one", active), {
    initialProps: { active: true },
  });
  let command!: Promise<void>;
  act(() => {
    command = view.result.current.run(async (current) => {
      await flight;
      stillCurrent = current();
    });
  });
  view.rerender({ active: false });
  view.rerender({ active: true });
  await act(async () => {
    finish();
    await command;
  });
  expect(stillCurrent).toBe(false);
});
