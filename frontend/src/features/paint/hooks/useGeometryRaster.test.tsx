// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Pt } from "../lib/geometry";
import { useGeometryRaster } from "./useGeometryRaster";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const mocks = vi.hoisted(() => ({ task: vi.fn() }));
vi.mock("../lib/geometryTasks", () => ({ geometryTask: mocks.task }));
let decodes: ReturnType<typeof deferred<void>>[];
beforeEach(() => {
  decodes = [];
  vi.stubGlobal("OffscreenCanvas", class {});
  vi.stubGlobal("Image", class {
    src = ""; decoding = "";
    decode() { const job = deferred<void>(); decodes.push(job); return job.promise; }
  });
  let serial = 0;
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn(() => `blob:ink-${++serial}`);
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); mocks.task.mockReset(); });
const geometry = (): Pt[][] => Array.from({ length: 1001 }, (_, i) => [[0, i], [100, i]]);

it("retains the previous decoded image until its replacement is ready", async () => {
  const lines = geometry(), first = deferred<ArrayBuffer>(), next = deferred<ArrayBuffer>();
  mocks.task.mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise);
  const { result, rerender, unmount } = renderHook(({ stroke }) => useGeometryRaster(lines, stroke, true), { initialProps: { stroke: .3 } });
  await act(async () => first.resolve(new ArrayBuffer(8)));
  expect(result.current.image).toBeNull();
  await act(async () => decodes[0].resolve());
  expect(result.current.image?.url).toBe("blob:ink-1");
  rerender({ stroke: .1 });
  await act(async () => next.resolve(new ArrayBuffer(8)));
  expect(result.current.image?.url).toBe("blob:ink-1");
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  await act(async () => decodes[1].resolve());
  expect(result.current.image?.url).toBe("blob:ink-2");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:ink-1");
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:ink-2");
});

it("releases abandoned decoding work and ignores its late result", async () => {
  const task = deferred<ArrayBuffer>(); mocks.task.mockReturnValue(task.promise);
  const lines = geometry();
  const { result, rerender, unmount } = renderHook(({ active }) => useGeometryRaster(lines, .2, active), { initialProps: { active: true } });
  await act(async () => task.resolve(new ArrayBuffer(8)));
  rerender({ active: false });
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:ink-1");
  await act(async () => decodes[0].resolve());
  expect(result.current.image).toBeNull();
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
});

it("keeps vector fallback available when a PNG cannot be decoded", async () => {
  mocks.task.mockResolvedValue(new ArrayBuffer(8));
  const lines = geometry();
  const { result } = renderHook(() => useGeometryRaster(lines, .2, true));
  await act(async () => {});
  await act(async () => decodes[0].reject(new Error("Invalid PNG")));
  expect(result.current.image).toBeNull();
  expect(result.current.failed).toBe(true);
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:ink-1");
});
