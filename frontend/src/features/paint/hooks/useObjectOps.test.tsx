// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useObjectOps } from "./useObjectOps";
import { cachedPage, queueObjects, rememberPage } from "../../../api/pageEdits";
import { api, type Calibration, type Page, type SceneObject } from "../../../api";
import { DEFAULT_VECTOR_STYLE } from "../lib/styling";
const geometry = vi.hoisted(() => vi.fn());
vi.mock("../lib/geometryTasks", () => ({ geometryTask: geometry }));
vi.mock("../../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
const lines = [[[0, 0], [20, 0], [20, 20], [0, 0]]];
const original: SceneObject = { id: "image", type: "image", transform: { x: 0, y: 0, scale: 1, rotation: 0 }, cachedPolylines: lines, data: { basePolylines: lines } };
let serial = 0;
const makePage = () => rememberPage({ id: `ops-${serial++}`, name: "Test", objects: [original], revision: 0, grid: { step: 10, snap: false } } as Page);
beforeEach(() => { vi.useFakeTimers(); geometry.mockReset(); });
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
function setup(page: Page, sizeLinked = true, cal: Calibration | null = null) {
  const setPage = vi.fn(), fail = vi.fn();
  return { setPage, fail, ...renderHook(({ page }) => useObjectOps(page, cal, ["image"], setPage, vi.fn(), queueObjects, fail, vi.fn(), "Text", sizeLinked), { initialProps: { page } }) };
}
it("uses the complete Xournal++ page for size and keeps its aspect ratio", () => {
  const base = makePage();
  const page = { ...base, objects: [{ ...original, data: { ...original.data, sourcePage: { width: 210, height: 148 } } }] };
  const hook = setup(page, false);
  expect(hook.result.current.objectLocalSize(page.objects[0])).toMatchObject({ width: 210, height: 148 });
  act(() => hook.result.current.setSelectedObjectSize("width", 105));
  expect(hook.setPage.mock.calls[0][0].objects[0].transform).toMatchObject({ scaleX: 0.5, scaleY: 0.5 });
});
it("trims an imported page frame, persists it, and restores it with undo", () => {
  const base = makePage();
  const page = { ...base, objects: [{ ...original, data: { ...original.data, sourcePage: { width: 210, height: 148 } } }] };
  const hook = setup(page);
  act(() => hook.result.current.trimSelectedImage(["left", "right", "top", "bottom"]));
  const trimmed = hook.setPage.mock.calls[0][0] as Page;
  expect(trimmed.objects[0].data?.sourcePage?.trim).toEqual([0, 0, 20, 20]);
  expect(trimmed.objects[0].cachedPolylines).toBe(page.objects[0].cachedPolylines);
  expect(cachedPage(page.id)?.objects[0].data?.sourcePage?.trim).toEqual([0, 0, 20, 20]);
  hook.rerender({ page: trimmed });
  act(() => hook.result.current.undo());
  expect(hook.setPage.mock.calls[1][0].objects[0].data?.sourcePage).toEqual({ width: 210, height: 148 });
});
it("a delayed insertion appends to the latest objects, not the captured page", () => {
  const page = makePage(); const hook = setup(page);
  const oldHandler = hook.result.current.addObject;
  const next = { ...page, objects: [...page.objects, { ...original, id: "drawn-later" }] };
  queueObjects(page.id, next.objects); hook.rerender({ page: next });
  act(() => oldHandler({ ...original, id: "import" }));
  expect(hook.setPage.mock.calls[0][0].objects.map((o: SceneObject) => o.id)).toEqual(["image", "drawn-later", "import"]);
});
it("worker styling preserves movement and new objects made during processing", async () => {
  const page = makePage(); const hook = setup(page);
  let resolve!: (value: number[][][]) => void;
  geometry.mockImplementation(() => new Promise((r) => { resolve = r; }));
  let task: unknown;
  act(() => { task = hook.result.current.updateSelectedStyle({ fill: { ...DEFAULT_VECTOR_STYLE.fill, enabled: true } }); });
  expect(hook.result.current.pendingStyle?.fill.enabled).toBe(true);
  const moved = { ...original, transform: { ...original.transform!, x: 42 } };
  const next = { ...page, objects: [moved, { ...original, id: "new" }] };
  queueObjects(page.id, next.objects); hook.rerender({ page: next });
  await act(async () => { resolve(lines); await task; });
  const result = hook.setPage.mock.calls[0][0];
  expect(result.objects[0].transform.x).toBe(42);
  expect(result.objects[1].id).toBe("new");
  expect(hook.fail).not.toHaveBeenCalled();
});
it("a background style result stays on its original page across several page switches", async () => {
  const page = makePage(); const hook = setup(page);
  let resolve!: (value: number[][][]) => void;
  geometry.mockImplementation(() => new Promise((r) => { resolve = r; }));
  let task: unknown;
  act(() => { task = hook.result.current.updateSelectedStyle({ fill: { ...DEFAULT_VECTOR_STYLE.fill, enabled: true } }); });
  for (let i = 0; i < 5; i++) hook.rerender({ page: makePage() });
  await act(async () => { resolve(lines); await task; });
  expect(hook.setPage).not.toHaveBeenCalled();
  expect(cachedPage(page.id)!.objects[0].data.style.fill.enabled).toBe(true);
  expect(hook.fail).not.toHaveBeenCalled();
});
it("enables saved pressure reversibly and preserves pressure through undo", async () => {
  const base = makePage();
  const page = { ...base, objects: [{ ...original, data: { ...original.data, baseSegmentPressures: [[0, 0.5, 1]], pressureEnabled: false } }] };
  const hook = setup(page, true, { pen_pressure_max_depth: 0.4 } as Calibration);
  await act(async () => hook.result.current.setSelectedPressureEnabled(true));
  const enabled = hook.setPage.mock.calls[0][0] as Page;
  expect(enabled.objects[0].data).toMatchObject({ pressureEnabled: true, cachedSegmentPressures: [[0, 0.5, 1]] });
  expect(enabled.objects[0].cachedPolylines).toBe(original.cachedPolylines);
  hook.rerender({ page: enabled });
  act(() => hook.result.current.undo());
  expect(hook.setPage.mock.calls[1][0].objects[0].data.pressureEnabled).toBe(false);
});
it("loads pressure for an existing native Xournal object without changing its geometry", async () => {
  const originalLocal = [[[-95, -54], [-85, -54], [-85, -34], [-95, -54]]];
  const page = { ...makePage(), objects: [{ ...original, cachedPolylines: originalLocal,
    data: { basePolylines: originalLocal, galleryId: "old-xopp", galleryPage: 1, strokeOrder: "source", sourcePage: { width: 210, height: 148 } } }] };
  const fetch = vi.spyOn(api, "galleryStrokes").mockResolvedValue({ width: 210, height: 148,
    polylines: [[[10, 20], [20, 20], [20, 40], [10, 20]]], segmentPressures: [[0.2, 0.5, 0.9]] });
  const hook = setup(page, true, { pen_pressure_max_depth: 0.4 } as Calibration);
  await act(async () => hook.result.current.setSelectedPressureEnabled(true));
  expect(fetch).toHaveBeenCalledWith("old-xopp", 1);
  expect(hook.setPage.mock.calls[0][0].objects[0].data).toMatchObject({ pressureEnabled: true, baseSegmentPressures: [[0.2, 0.5, 0.9]] });
  expect(hook.fail).not.toHaveBeenCalled();
});
it("does not enable pressure without configured depth or usable data", async () => {
  const page = makePage();
  const hook = setup(page, true, { pen_pressure_max_depth: 0 } as Calibration);
  await act(async () => hook.result.current.setSelectedPressureEnabled(true));
  expect(hook.fail.mock.calls[0][0].message).toBe("paint.pressure.configure");
  expect(hook.setPage).not.toHaveBeenCalled();
});
it("keeps pressure aligned when the eraser clips transformed handwriting", async () => {
  const page = { ...makePage(), objects: [{ ...original, cachedPolylines: [[[0, 0], [10, 0], [20, 0]]],
    transform: { x: 10, y: 20, rotation: 0, scale: 2 },
    data: { basePolylines: [[[0, 0], [10, 0], [20, 0]]], baseSegmentPressures: [[0.2, 0.8]], pressureEnabled: true } }] };
  geometry.mockResolvedValue([[[15, 20], [25, 20]], [[35, 20], [45, 20]]]);
  const hook = setup(page);
  await act(async () => hook.result.current.eraseAcrossObjects([[30, 10], [30, 30]], "free", 1));
  expect(hook.setPage.mock.calls[0][0].objects[0].data.baseSegmentPressures).toEqual([[0.2], [0.8]]);
  expect(hook.setPage.mock.calls[0][0].objects[0].transform).toMatchObject({ scale: 1, rotation: 0 });
});
