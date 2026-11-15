// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import type { Calibration } from "../../api";
import LiveView from "./LiveView";
import { PAPER_FORMATS } from "./paperLayout";

vi.mock("../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const cal: Calibration = {
  bed_width: 210, bed_height: 210, z_max: 205,
  plot_width: 200, plot_height: 200, origin_x: 5, origin_y: 5,
  pen_up_z: 5, pen_down_z: 0, pen_calibrated: true,
  travel_feed: 100, draw_feed: 50, z_feed: 26.7, z_max_feedrate: 60,
  fit_to_area: true, flip_y: true, trust_axis_home: false,
  park_after_plot: true, park_x: 105, park_y: 210, park_lift_z: 5,
  calibration_x: 105, calibration_y: 105,
  paper_corners: {}, paper_margin: 0, obstacles: [], merge_tolerance: 0.5,
};

function mockBedCoords(svg: SVGSVGElement) {
  Object.defineProperty(svg, "createSVGPoint", { value: () => ({
    x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; },
  }) });
  Object.defineProperty(svg, "getScreenCTM", { value: () => ({ inverse: () => ({}) }) });
}

it.each(["background", "P", "C"])("passes clicks on %s to the parent motion handler", (target) => {
  const onMoveTo = vi.fn();
  const { container } = render(<LiveView cal={cal} position={null} rect={null} preview={null} onMoveTo={onMoveTo} />);
  const svg = container.querySelector("svg")!;
  mockBedCoords(svg);
  const point = Array.from(svg.querySelectorAll("text")).find((node) => node.textContent === target);
  if (point) expect(point.parentElement).toHaveAttribute("pointer-events", "none");
  fireEvent.click(point ?? svg, { clientX: 40, clientY: 180 });
  expect(onMoveTo).toHaveBeenCalledExactlyOnceWith(40, 30);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("shows saved positions and an unsaved target as circles with a centered X", () => {
  render(<LiveView cal={cal} position={null} rect={null} preview={null}
    selectedPosition="calibration" target={{ kind: "calibration", x: 40, y: 30 }} />);
  const saved = screen.getByRole("img", { name: "C" });
  expect(saved.querySelector("path")).toHaveAttribute("d", "M103 103L107 107M103 107L107 103");
  expect(saved.querySelectorAll("circle")).toHaveLength(2);
  const target = screen.getByRole("img", { name: "C · paper.positions.target" });
  expect(target.querySelector("circle")).toHaveAttribute("cx", "40");
  expect(target.querySelector("circle")).toHaveAttribute("cy", "180");
  expect(target.querySelector("circle")).toHaveAttribute("fill", "none");
  expect(target.querySelector("circle")).toHaveAttribute("stroke-dasharray");
});

it("rejects clicks outside the bed or inside an obstacle", () => {
  const onMoveTo = vi.fn();
  const { container } = render(<LiveView cal={cal} position={null} rect={null} preview={null}
    obstacles={[{ id: "clamp", x: 20, y: 20, w: 30, h: 30 }]} onMoveTo={onMoveTo} />);
  const svg = container.querySelector("svg")!;
  mockBedCoords(svg);
  fireEvent.click(svg, { clientX: 300, clientY: 180 });
  fireEvent.click(svg, { clientX: 40, clientY: 180 });
  expect(onMoveTo).not.toHaveBeenCalled();
});

it("keeps dragging paper corners separate from machine movement", () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  const onMoveTo = vi.fn(), onDragCorner = vi.fn(), onDropCorner = vi.fn();
  const { container } = render(<LiveView cal={{ ...cal, paper_corners: { bl: [10, 20] } }}
    position={null} rect={null} preview={null} onMoveTo={onMoveTo}
    onDragCorner={onDragCorner} onDropCorner={onDropCorner} />);
  const svg = container.querySelector("svg")!;
  mockBedCoords(svg);
  const hit = svg.querySelector('circle[fill="transparent"]')!;
  Object.defineProperty(hit, "setPointerCapture", { value: vi.fn() });
  fireEvent.pointerDown(hit);
  fireEvent.pointerMove(svg, { clientX: 40, clientY: 180 });
  fireEvent.pointerUp(svg, { clientX: 40, clientY: 180 });
  fireEvent.click(svg, { clientX: 40, clientY: 180 });
  expect(onDragCorner).toHaveBeenCalledWith("bl", 40, 30);
  expect(onDropCorner).toHaveBeenCalledWith("bl", 40, 30);
  expect(onMoveTo).not.toHaveBeenCalled();
});

it("draws a passive gray size comparison and a quiet drawing contour without resize handles", () => {
  const { container } = render(<LiveView cal={{ ...cal, paper_margin: 5,
    plot_area_base: { x: 20, y: 10, w: 150, h: 190 }, origin_x: 25, origin_y: 15,
    plot_width: 140, plot_height: 180 }} position={null} rect={null} preview={null}
    formatPreview={{ format: PAPER_FORMATS.find((format) => format.id === "A6")!, landscape: false }} />);
  const format = screen.getByRole("img", { name: "A6 105 × 148 mm" });
  expect(format).toHaveAttribute("pointer-events", "none");
  expect(format.querySelector("rect")).toHaveAttribute("width", "105");
  expect(format.querySelector("rect")).toHaveAttribute("height", "148");
  expect(format.querySelector("rect")).toHaveAttribute("stroke", "#aab0bb");
  const drawing = screen.getByRole("img", { name: "paper.drawingArea" });
  expect(drawing).toHaveAttribute("pointer-events", "none");
  expect(drawing.querySelector("rect")).toHaveAttribute("x", "25");
  expect(drawing.querySelector("rect")).toHaveAttribute("width", "140");
  expect(drawing.querySelector("rect")).toHaveAttribute("stroke", "var(--muted)");
  expect(container.querySelector(".plot-edge-handle")).toBeNull();
  expect(screen.queryByLabelText("paper.plotEdge.left")).not.toBeInTheDocument();
});
