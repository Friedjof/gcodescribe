// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PaintContextPanel from "./PaintContextPanel";
import type { ObjectOps } from "../hooks/useObjectOps";
import type { SceneObject } from "../../../api";
import { DEFAULT_VECTOR_STYLE } from "../lib/styling";

vi.mock("../../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);
const lines = [[[0, 0], [10, 0], [20, 0]]];
const native: SceneObject = { id: "xopp", type: "image", cachedPolylines: lines,
  data: { basePolylines: lines, baseSegmentPressures: [[0.2, 0.8]], pressureEnabled: false } };

function setup(object: SceneObject, depth = 0) {
  const onChange = vi.fn();
  const ops = { history: { undo: 0, redo: 0 }, clipboardCount: 0, setSelectedPressureEnabled: onChange } as unknown as ObjectOps;
  render(<PaintContextPanel tool="select" activeToolLabel="select" ops={ops} hasSelection selectedObjects={[object]}
    selectedStyle={DEFAULT_VECTOR_STYLE} pressureMaxDepth={depth}
    selectedText={null} defaultText="Text"
    eraserBrush="point" onEraserBrushChange={vi.fn()} eraserRadius={1} fillStyle={DEFAULT_VECTOR_STYLE.fill}
    onFillStyleChange={vi.fn()} />);
  return onChange;
}
it("shows why pressure cannot be enabled while the profile depth is zero", () => {
  setup(native);
  expect((screen.getByRole("checkbox", { name: "paint.pressure.enable" }) as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText("paint.pressure.configure")).toBeTruthy();
});
it("offers the optional pressure switch once depth is configured", () => {
  const onChange = setup(native, 0.3);
  const input = screen.getByRole("checkbox", { name: "paint.pressure.enable" }) as HTMLInputElement;
  expect(input.checked).toBe(false);
  expect(input.disabled).toBe(false);
  fireEvent.click(input);
  expect(onChange).toHaveBeenCalledWith(true);
});
it("still allows turning pressure off after the profile depth was reset", () => {
  const onChange = setup({ ...native, data: { ...native.data, pressureEnabled: true } });
  const input = screen.getByRole("checkbox", { name: "paint.pressure.enable" }) as HTMLInputElement;
  expect(input.disabled).toBe(false);
  fireEvent.click(input);
  expect(onChange).toHaveBeenCalledWith(false);
});
it("explains unsupported styles and hides pressure options for ordinary vectors", () => {
  setup({ ...native, data: { ...native.data, style: { ...DEFAULT_VECTOR_STYLE,
    stroke: { ...DEFAULT_VECTOR_STYLE.stroke, mode: "dashed" } } } }, 0.3);
  expect((screen.getByRole("checkbox", { name: "paint.pressure.enable" }) as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText("paint.pressure.solidOnly")).toBeTruthy();
  cleanup();
  setup({ ...native, data: { basePolylines: lines } });
  expect(screen.queryByRole("checkbox", { name: "paint.pressure.enable" })).toBeNull();
});
