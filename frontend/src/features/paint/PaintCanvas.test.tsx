// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Calibration, Page } from "../../api";
import { objectWorldBounds, toMultiPath, type Pt, type Transform } from "./lib/geometry";
import PaintCanvas from "./PaintCanvas";
vi.mock("../../i18n", () => ({ useI18n: () => ({ lang: "en", t: (key: string) => key }) }));
const lines: [number, number][][] = [[[-10, -5], [10, -5], [10, 5], [-10, 5], [-10, -5]]];
const page = (id = "page"): Page => ({ id, name: id, grid: { step: 10, snap: false }, created: 0, modified: 0,
  objects: [{ id: "object", type: "rect", transform: { x: 40, y: 30, rotation: 0, scale: 1 }, cachedPolylines: lines }] });
function setup(current = page()) {
  const props = { visible: true, cal: { plot_width: 100, plot_height: 80 } as Calibration, page: current,
    tool: "select" as const, selectedIds: ["object"], onSelect: vi.fn(), onAdd: vi.fn(),
    onUpdate: vi.fn(), onUpdateMany: vi.fn(), onEditStart: vi.fn(), onContextMenuSelection: vi.fn(),
    onImageDrop: vi.fn(), onTextAdd: vi.fn(), onErase: vi.fn(), viewRotation: 0 as const, onViewRotationChange: vi.fn() };
  const view = render(<PaintCanvas {...props} />);
  const svg = view.container.querySelector(".paint-canvas > svg")!;
  const moveHit = () => view.container.querySelector("g > g > rect[fill='transparent']")!;
  const move = (x: number, y: number, modifiers = {}) => {
    fireEvent.pointerMove(svg, { clientX: x, clientY: y, pointerId: 1, buttons: 1, ...modifiers });
    act(() => { vi.advanceTimersByTime(2); });
  };
  return { ...view, props, svg, moveHit, move };
}
beforeEach(() => {
  vi.useFakeTimers();
  class Pointer extends MouseEvent {
    pointerId: number; pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; this.pointerType = init.pointerType ?? "mouse"; }
  }
  vi.stubGlobal("PointerEvent", Pointer);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 1));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, toJSON: () => ({}) });
  Object.defineProperties(SVGSVGElement.prototype, {
    createSVGPoint: { configurable: true, value: function () { return { x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }; } },
    getScreenCTM: { configurable: true, value: () => ({ inverse: () => ({}) }) },
    setPointerCapture: { configurable: true, value: vi.fn() },
    releasePointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: () => true },
  });
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("shows live move feedback and commits one undo transaction on release", () => {
  const view = setup();
  fireEvent.pointerDown(view.moveHit(), { clientX: 40, clientY: 30, button: 0, pointerId: 1 });
  expect(view.props.onEditStart).not.toHaveBeenCalled();
  view.move(47, 37, { altKey: true });
  expect(view.container.querySelector(".canvas-readout")?.textContent).toContain("X 37 · Y 32 mm");
  expect(view.props.onUpdateMany).not.toHaveBeenCalled();
  fireEvent.pointerUp(view.svg, { pointerId: 1 });
  expect(view.props.onEditStart).toHaveBeenCalledOnce();
  expect(view.props.onUpdateMany).toHaveBeenCalledOnce();
  expect(view.props.onUpdateMany.mock.calls[0][0].get("object")).toMatchObject({ x: 47, y: 37 });
  expect(view.container.querySelector(".canvas-readout")).toBeNull();
});
it("cancels preview and undo history with Escape", () => {
  const view = setup();
  fireEvent.pointerDown(view.moveHit(), { clientX: 40, clientY: 30, button: 0, pointerId: 1 });
  view.move(55, 45);
  fireEvent.keyDown(window, { key: "Escape" });
  fireEvent.pointerUp(view.svg, { pointerId: 1 });
  expect(view.props.onEditStart).not.toHaveBeenCalled();
  expect(view.props.onUpdateMany).not.toHaveBeenCalled();
  expect(view.container.querySelector(".canvas-readout")).toBeNull();
});
it.each(["page", "hidden", "cancel"])("discards queued transforms after %s", change => {
  const view = setup();
  fireEvent.pointerDown(view.moveHit(), { clientX: 40, clientY: 30, button: 0, pointerId: 1 });
  view.move(55, 45);
  if (change === "cancel") fireEvent.pointerCancel(view.svg, { pointerId: 1 });
  else view.rerender(<PaintCanvas {...view.props} page={change === "page" ? page("other") : view.props.page} visible={change !== "hidden"} />);
  fireEvent.pointerUp(view.svg, { pointerId: 1 });
  expect(view.props.onUpdateMany).not.toHaveBeenCalled();
  expect(view.props.onEditStart).not.toHaveBeenCalled();
});
it("Alt bypasses both grid and alignment snapping", () => {
  const current = page(); current.grid.snap = true;
  const view = setup(current);
  fireEvent.pointerDown(view.moveHit(), { clientX: 40, clientY: 30, button: 0, pointerId: 1 });
  view.move(47.3, 37.2, { altKey: true });
  fireEvent.pointerUp(view.svg, { pointerId: 1 });
  expect(view.props.onUpdateMany.mock.calls[0][0].get("object")).toMatchObject({ x: 47.3, y: 37.2 });
});
it("shows resized dimensions and constrains the result to the plot area", () => {
  const view = setup();
  const grips = view.getAllByLabelText("paint.canvas.resizeHandle");
  const grip = grips[grips.length - 1];
  fireEvent.pointerDown(grip, { clientX: 50, clientY: 35, button: 0, pointerId: 1 });
  view.move(140, 120);
  expect(view.container.querySelector(".canvas-readout")?.textContent).toContain("paint.canvas.plotLimit");
  fireEvent.pointerUp(view.svg, { pointerId: 1 });
  const transform = view.props.onUpdateMany.mock.calls[0][0].get("object") as Transform;
  const bounds = objectWorldBounds(lines, transform);
  expect(bounds[0]).toBeGreaterThanOrEqual(0); expect(bounds[1]).toBeGreaterThanOrEqual(0);
  expect(bounds[2]).toBeLessThanOrEqual(100); expect(bounds[3]).toBeLessThanOrEqual(80);
});
it("uses Shift for 15-degree rotation and renders its angle feedback", () => {
  const view = setup();
  fireEvent.pointerDown(view.getByLabelText("paint.canvas.rotateHandle"), { clientX: 40, clientY: 10, button: 0, pointerId: 1 });
  view.move(60, 10, { shiftKey: true });
  expect(view.container.querySelector(".canvas-readout")?.textContent).toContain("45°");
  expect(view.container.querySelector(".canvas-readout")?.textContent).toContain("paint.canvas.angleSnapped");
  fireEvent.pointerUp(view.svg, { pointerId: 1 });
  expect(view.props.onUpdateMany.mock.calls[0][0].get("object").rotation).toBeCloseTo(Math.PI / 4);
});
it("does not create an undo entry for a simple selection click", () => {
  const view = setup();
  fireEvent.pointerDown(view.moveHit(), { clientX: 40, clientY: 30, button: 0, pointerId: 1 });
  fireEvent.pointerUp(view.svg, { pointerId: 1 });
  expect(view.props.onEditStart).not.toHaveBeenCalled();
});
it("keeps handle targets in screen pixels through zoom and window resize", () => {
  const view = setup();
  const targetWidth = () => Number(view.getByLabelText("paint.canvas.rotateHandle").querySelector("rect")!.getAttribute("width"));
  const viewWidth = () => Number(view.svg.getAttribute("viewBox")!.split(" ")[2]);
  const before = targetWidth() / viewWidth();
  fireEvent.wheel(view.svg, { deltaY: -250, clientX: 40, clientY: 30 });
  expect(targetWidth() / viewWidth()).toBeCloseTo(before);
  vi.mocked(view.svg.getBoundingClientRect).mockReturnValue({ x: 0, y: 0, width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300, toJSON: () => ({}) });
  fireEvent.resize(window);
  expect(targetWidth() / viewWidth() * 400).toBeCloseTo(before * 800);
});
it.each(["many strokes", "detailed curves"])("retains every path during continuous wheel zoom and panning with %s", kind => {
  const geometry: Pt[][] = kind === "many strokes"
    ? Array.from({ length: 2400 }, (_, row) => [[10, row / 40], [90, row / 40]])
    : Array.from({ length: 120 }, (_, row) => Array.from({ length: 500 }, (_, i) => [i / 6, row / 2 + Math.sin(i / 8) / 8]));
  const current = page(); current.objects[0].cachedPolylines = geometry;
  const source = JSON.stringify(current);
  const complete = toMultiPath(geometry);
  const view = setup(current);
  const ink = () => view.svg.querySelector('path[stroke="var(--ink)"]')?.getAttribute("d");
  expect(ink()).toBe(complete);
  for (const deltaY of [-120, -120, -120, 120, 120]) {
    fireEvent.wheel(view.svg, { deltaY, clientX: 400, clientY: 300 });
    act(() => { vi.advanceTimersByTime(30); });
    expect(ink()).toBe(complete);
  }
  act(() => { vi.advanceTimersByTime(150); });
  expect(ink()).toBe(complete);
  fireEvent.pointerDown(view.svg, { clientX: 400, clientY: 300, button: 2, buttons: 2, pointerId: 1 });
  view.move(430, 320);
  expect(ink()).toBe(complete);
  fireEvent.pointerUp(view.svg, { pointerId: 1 });
  expect(JSON.stringify(current)).toBe(source);
  expect(view.props.onUpdateMany).not.toHaveBeenCalled();
  expect(view.props.onEditStart).not.toHaveBeenCalled();
});
it("does not steal Space from focused toolbar buttons", () => {
  const view = setup();
  const button = view.container.querySelector("button")!;
  expect(fireEvent.keyDown(button, { key: " ", code: "Space" })).toBe(true);
  expect(view.svg.getAttribute("style")).not.toContain("grab;");
});
it("does not jump or create undo history when a resize target is grabbed off-center", () => {
  const view = setup();
  const grips = view.getAllByLabelText("paint.canvas.resizeHandle");
  fireEvent.pointerDown(grips[grips.length - 1], { clientX: 51, clientY: 36, button: 0, pointerId: 1 });
  view.move(51, 36);
  fireEvent.pointerUp(view.svg, { pointerId: 1 });
  expect(view.props.onEditStart).not.toHaveBeenCalled();
  expect(view.props.onUpdateMany).not.toHaveBeenCalled();
});
it("does not record an undo entry after moving back to the start", () => {
  const view = setup();
  fireEvent.pointerDown(view.moveHit(), { clientX: 40, clientY: 30, button: 0, pointerId: 1 });
  view.move(55, 45, { altKey: true });
  view.move(40, 30, { altKey: true });
  fireEvent.pointerUp(view.svg, { pointerId: 1 });
  expect(view.props.onEditStart).not.toHaveBeenCalled();
});
it("preserves a group's spacing and sizes when scaling at the plot boundary", () => {
  const current = page();
  current.objects.push({ ...current.objects[0], id: "other", transform: { x: 75, y: 45, scale: 1, rotation: 0 } });
  const view = setup(current);
  view.rerender(<PaintCanvas {...view.props} selectedIds={["object", "other"]} />);
  fireEvent.pointerDown(view.getByLabelText("paint.canvas.resizeGroup"), { clientX: 85, clientY: 50, button: 0, pointerId: 1 });
  view.move(220, 160);
  expect(view.container.querySelector(".canvas-readout")?.textContent).toContain("paint.canvas.plotLimit");
  fireEvent.pointerUp(view.svg, { pointerId: 1 });
  const result = view.props.onUpdateMany.mock.calls[0][0] as Map<string, Transform>;
  const first = result.get("object")!, second = result.get("other")!;
  expect(second.x - first.x).toBeCloseTo(35 * first.scale);
  expect(second.y - first.y).toBeCloseTo(15 * first.scale);
  expect(second.scale).toBeCloseTo(first.scale);
  for (const transform of result.values()) {
    const [x0, y0, x1, y1] = objectWorldBounds(lines, transform);
    expect(x0).toBeGreaterThanOrEqual(-1e-8); expect(y0).toBeGreaterThanOrEqual(-1e-8);
    expect(x1).toBeLessThanOrEqual(100 + 1e-8); expect(y1).toBeLessThanOrEqual(80 + 1e-8);
  }
});
it("keeps the live readout upright when the canvas view is rotated", () => {
  const view = setup();
  view.rerender(<PaintCanvas {...view.props} viewRotation={90} />);
  fireEvent.pointerDown(view.moveHit(), { clientX: 60, clientY: 30, button: 0, pointerId: 1 });
  view.move(65, 35, { altKey: true });
  const readout = view.container.querySelector(".canvas-readout")!;
  expect(readout.parentElement).toBe(view.svg);
  expect(readout.getAttribute("transform")).toBeNull();
  expect(readout.textContent).toContain("mm");
});
it("shows dimensions while drawing a new shape and allows cancelling it", () => {
  const view = setup();
  view.rerender(<PaintCanvas {...view.props} tool="rect" />);
  fireEvent.pointerDown(view.svg, { clientX: 20, clientY: 20, button: 0, pointerId: 1 });
  view.move(50, 40);
  expect(view.container.querySelector(".canvas-readout")?.textContent).toContain("30 × 20 mm");
  fireEvent.keyDown(window, { key: "Escape" });
  fireEvent.pointerUp(view.svg, { pointerId: 1 });
  expect(view.props.onAdd).not.toHaveBeenCalled();
});
it("rotates a constrained group without moving or shrinking its objects independently", () => {
  const current = page();
  current.objects[0].transform = { x: 15, y: 10, rotation: 0, scale: 1 };
  current.objects.push({ ...current.objects[0], id: "other", transform: { x: 80, y: 70, scale: 1, rotation: 0 } });
  const view = setup(current);
  view.rerender(<PaintCanvas {...view.props} selectedIds={["object", "other"]} />);
  fireEvent.pointerDown(view.getByLabelText("paint.canvas.rotateGroup"), { clientX: 47.5, clientY: -5, button: 0, pointerId: 1 });
  view.move(92.5, -5, { shiftKey: true });
  expect(view.container.querySelector(".canvas-readout")?.textContent).toContain("paint.canvas.plotLimit");
  fireEvent.pointerUp(view.svg, { pointerId: 1 });
  const result = view.props.onUpdateMany.mock.calls[0][0] as Map<string, Transform>;
  const first = result.get("object")!, second = result.get("other")!;
  const factor = first.scaleX ?? first.scale;
  expect(second.scaleX ?? second.scale).toBeCloseTo(factor);
  expect(first.rotation).toBeCloseTo(Math.PI / 4);
  expect(second.x - first.x).toBeCloseTo((65 - 60) / Math.sqrt(2) * factor);
  expect(second.y - first.y).toBeCloseTo((65 + 60) / Math.sqrt(2) * factor);
});

it("cancels a pending object edit when a dock resize changes pointer mapping", () => {
  const view = setup();
  fireEvent.pointerDown(view.moveHit(), { clientX: 40, clientY: 30, button: 0, pointerId: 1 });
  view.move(55, 45);
  vi.mocked(view.svg.getBoundingClientRect).mockReturnValue({ x: 0, y: 0, width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300, toJSON: () => ({}) });
  fireEvent.resize(window); fireEvent.pointerUp(view.svg, { pointerId: 1 });
  expect(view.props.onUpdateMany).not.toHaveBeenCalled();
  expect(view.props.onEditStart).not.toHaveBeenCalled();
});
it("lets the user hide rulers and grid independently of snapping", () => {
  const view = setup();
  view.rerender(<PaintCanvas {...view.props} gridVisible={false} showRulers={false} padding={0} />);
  expect(view.container.querySelector(".canvas-rulers")).toBeNull();
  expect(view.container.querySelector('rect[fill="url(#pc-grid-major)"]')).toBeNull();
  expect(view.container.querySelector('rect[fill="var(--paper)"]')).not.toBeNull();
});
