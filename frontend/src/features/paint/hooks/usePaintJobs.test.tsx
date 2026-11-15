// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api, type Page, type ProfileRef } from "../../../api";
import { rememberPage } from "../../../api/pageEdits";
import type { ObjectOps } from "./useObjectOps";
import { usePaintJobs } from "./usePaintJobs";
vi.mock("../../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../../../components/Toasts", () => ({ useToasts: () => ({ success: vi.fn() }) }));
let serial = 0;
const page = () => rememberPage({ id: `job-${serial++}`, name: "page", projectId: "project", objects: [{ id: "a", type: "pen" }], grid: { step: 10, snap: false } } as Page);
const profile = { id: "profile", fingerprint: "version" } as ProfileRef;
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { resolve, promise }; };
function setup(strict = false) {
  const markPlotted = vi.fn();
  const initialPage = page();
  const hook = renderHook(({ current, visible, currentProfile }) => usePaintJobs({
    page: current, profile: currentProfile, projectId: "project", visible, printerBusy: false,
    ops: { processing: false, markPlotted } as unknown as ObjectOps,
    selectedIds: ["a"], setSelectedIds: vi.fn(), refresh: vi.fn(), fail: vi.fn(),
  }), { initialProps: { current: initialPage, visible: true, currentProfile: profile }, wrapper: strict ? StrictMode : undefined });
  return { ...hook, markPlotted, initialPage };
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it.each(["page", "hidden", "profile"])("does not send a prepared job after %s changes", async (change) => {
  const generation = deferred<Awaited<ReturnType<typeof api.pageGcode>>>();
  vi.spyOn(api, "pageGcode").mockReturnValue(generation.promise);
  const send = vi.spyOn(api, "send").mockResolvedValue({} as Awaited<ReturnType<typeof api.send>>);
  const hook = setup();
  act(() => hook.result.current.directPlot());
  await act(async () => {});
  hook.rerender({ current: change === "page" ? page() : hook.initialPage, visible: change !== "hidden", currentProfile: change === "profile" ? { ...profile, fingerprint: "new-version" } : profile });
  await act(async () => generation.resolve({ filename: "job.gcode" } as Awaited<ReturnType<typeof api.pageGcode>>));
  expect(send).not.toHaveBeenCalled();
});
it("serializes double clicks through generation and sending", async () => {
  const generation = deferred<Awaited<ReturnType<typeof api.pageGcode>>>();
  const generate = vi.spyOn(api, "pageGcode").mockReturnValue(generation.promise);
  const send = vi.spyOn(api, "send").mockResolvedValue({} as Awaited<ReturnType<typeof api.send>>);
  const hook = setup();
  act(() => { hook.result.current.directPlot(); hook.result.current.directPlot(); });
  await act(async () => {});
  expect(generate).toHaveBeenCalledOnce();
  await act(async () => generation.resolve({ filename: "job.gcode" } as Awaited<ReturnType<typeof api.pageGcode>>));
  expect(send).toHaveBeenCalledOnce();
  expect(hook.result.current.sending).toBe(false);
});
it("ignores a preview after the page changes", async () => {
  const preview = deferred<Awaited<ReturnType<typeof api.pagePreview3D>>>();
  vi.spyOn(api, "pagePreview3D").mockReturnValue(preview.promise);
  const hook = setup();
  act(() => { void hook.result.current.openFullscreen(); });
  hook.rerender({ current: page(), visible: true, currentProfile: profile });
  await act(async () => preview.resolve({} as Awaited<ReturnType<typeof api.pagePreview3D>>));
  expect(hook.result.current.fullscreen).toBeNull();
});
it("finishes an accepted selection on its captured document after navigation", async () => {
  vi.spyOn(api, "pageGcode").mockResolvedValue({ filename: "job.gcode" } as Awaited<ReturnType<typeof api.pageGcode>>);
  const sending = deferred<Awaited<ReturnType<typeof api.send>>>();
  vi.spyOn(api, "send").mockReturnValue(sending.promise);
  const hook = setup();
  act(() => hook.result.current.plotSelection());
  await act(async () => {});
  hook.rerender({ current: page(), visible: true, currentProfile: profile });
  await act(async () => sending.resolve({} as Awaited<ReturnType<typeof api.send>>));
  expect(hook.markPlotted).toHaveBeenCalledWith(["a"]);
});

it("allows a legitimate first click after StrictMode repeats effect setup", async () => {
  vi.spyOn(api, "pageGcode").mockResolvedValue({ filename: "job.gcode" } as Awaited<ReturnType<typeof api.pageGcode>>);
  const send = vi.spyOn(api, "send").mockResolvedValue({} as Awaited<ReturnType<typeof api.send>>);
  const hook = setup(true);
  act(() => hook.result.current.directPlot());
  await act(async () => {});
  expect(send).toHaveBeenCalledOnce();
});
it("does not send a prepared job after unmounting", async () => {
  const generation = deferred<Awaited<ReturnType<typeof api.pageGcode>>>();
  vi.spyOn(api, "pageGcode").mockReturnValue(generation.promise);
  const send = vi.spyOn(api, "send").mockResolvedValue({} as Awaited<ReturnType<typeof api.send>>);
  const hook = setup();
  act(() => hook.result.current.directPlot());
  await act(async () => {});
  hook.unmount();
  await act(async () => generation.resolve({ filename: "job.gcode" } as Awaited<ReturnType<typeof api.pageGcode>>));
  expect(send).not.toHaveBeenCalled();
});
