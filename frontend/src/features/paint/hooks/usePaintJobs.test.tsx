// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api, type Page, type ProfileRef, type PrinterStatus } from "../../../api";
import { rememberPage } from "../../../api/pageEdits";
import type { ObjectOps } from "./useObjectOps";
import { usePaintJobs } from "./usePaintJobs";
vi.mock("../../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../../../components/Toasts", () => ({ useToasts: () => ({ success: vi.fn() }) }));
let serial = 0;
const page = () => rememberPage({ id: `job-${serial++}`, name: "page", projectId: "project", objects: [{ id: "a", type: "pen" }], grid: { step: 10, snap: false } } as Page);
const profile = { id: "profile", fingerprint: "version" } as ProfileRef;
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { resolve, promise }; };
type SetupProps = { current: Page; visible: boolean; currentProfile: ProfileRef; currentStatus?: PrinterStatus; currentBusy?: boolean };
function setup(strict = false) {
  const markPlotted = vi.fn();
  const initialPage = page();
  const hook = renderHook(({ current, visible, currentProfile, currentStatus, currentBusy }: SetupProps) => usePaintJobs({
    page: current, profile: currentProfile, projectId: "project", visible, printerBusy: currentBusy ?? false,
    status: currentStatus ?? { configured: true, online: true, backend: "serial" },
    ops: { processing: false, markPlotted } as unknown as ObjectOps,
    selectedIds: ["a"], setSelectedIds: vi.fn(), refresh: vi.fn(), fail: vi.fn(),
  }), { initialProps: { current: initialPage, visible: true, currentProfile: profile } as SetupProps, wrapper: strict ? StrictMode : undefined });
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

it("allows offline G-code export but never starts an offline printer", async () => {
  const generate=vi.spyOn(api,"pageGcode").mockResolvedValue({filename:"offline.gcode"} as Awaited<ReturnType<typeof api.pageGcode>>);
  const send=vi.spyOn(api,"send").mockResolvedValue({} as Awaited<ReturnType<typeof api.send>>);
  const hook=setup();hook.rerender({current:hook.initialPage,visible:true,currentProfile:profile,currentStatus:{configured:false,online:false}});
  act(()=>hook.result.current.directPlot());await act(async()=>{});
  expect(generate).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
  act(()=>hook.result.current.createGcode());await act(async()=>{});
  expect(generate).toHaveBeenCalledOnce();expect(send).not.toHaveBeenCalled();
});
it.each(["offline","backend","busy"])("rechecks printer readiness after generation: %s", async change => {
  const generation=deferred<Awaited<ReturnType<typeof api.pageGcode>>>();
  vi.spyOn(api,"pageGcode").mockReturnValue(generation.promise);const send=vi.spyOn(api,"send").mockResolvedValue({} as Awaited<ReturnType<typeof api.send>>);
  const hook=setup();act(()=>hook.result.current.directPlot());await act(async()=>{});
  hook.rerender({current:hook.initialPage,visible:true,currentProfile:profile,currentBusy:change==="busy",currentStatus:{configured:true,online:change!=="offline",backend:change==="backend"?"octoprint":"serial"}});
  await act(async()=>generation.resolve({filename:"ready.gcode"} as Awaited<ReturnType<typeof api.pageGcode>>));
  expect(send).not.toHaveBeenCalled();expect(hook.result.current.plotError).toBe("paint.printerUnavailable");
});

it("requires confirmation, suppresses double submissions and does not show insertion instructions after failure",async()=>{
 const move=vi.spyOn(api,"homeAndMoveToPosition").mockRejectedValueOnce(new Error("Movement rejected"));
 const h=setup();
 act(()=>h.result.current.moveToCalibration());
 expect(h.result.current.insertion).toBe("confirm");expect(move).not.toHaveBeenCalled();
 await act(async()=>{await h.result.current.confirmInsertionMove();});
 expect(h.result.current.insertion).toBe("confirm");expect(h.result.current.insertionError).toBe("Movement rejected");
 const moving=deferred<Awaited<ReturnType<typeof api.homeAndMoveToPosition>>>();move.mockReturnValue(moving.promise);
 act(()=>{void h.result.current.confirmInsertionMove();void h.result.current.confirmInsertionMove();});
 expect(move).toHaveBeenCalledTimes(2);expect(h.result.current.insertion).toBe("moving");
 await act(async()=>moving.resolve({} as Awaited<ReturnType<typeof api.homeAndMoveToPosition>>));
 expect(h.result.current.insertion).toBe("insert");
 expect(move).toHaveBeenLastCalledWith("calibration","project",false,true);
});
it("retires pen insertion after switching printers during the move",async()=>{
 const moving=deferred<Awaited<ReturnType<typeof api.homeAndMoveToPosition>>>();vi.spyOn(api,"homeAndMoveToPosition").mockReturnValue(moving.promise);
 const h=setup();act(()=>h.result.current.moveToCalibration());act(()=>{void h.result.current.confirmInsertionMove();});
 h.rerender({current:h.initialPage,visible:true,currentProfile:profile,currentStatus:{online:true,configured:true,printer_id:"another"}});
 await act(async()=>moving.resolve({} as Awaited<ReturnType<typeof api.homeAndMoveToPosition>>));
 expect(h.result.current.insertion).toBeNull();
});
