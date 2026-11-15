// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Calibration, Page, SceneObject } from "../../../api";
import { queueObjects, rememberPage } from "../../../api/pageEdits";
import { useObjectOps } from "../hooks/useObjectOps";
import PaintPrecisionBar from "./PaintPrecisionBar";
const rectangle: SceneObject = { id: "a", type: "rect", transform: { x: 50, y: 40, scale: 1, rotation: 0 },
  cachedPolylines: [[[-10, -5], [10, 5]]] };
const operations = () => ({ setSelectedObjectPosition: vi.fn().mockReturnValue(true),
  setSelectedObjectSize: vi.fn().mockReturnValue(true), setSelectedObjectRotation: vi.fn().mockReturnValue(true) });
vi.mock("../../../i18n", () => ({ useI18n: () => ({ lang: "en", t: (key: string) => key }) }));
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });
it("keeps measurements optional and remembers the expanded state", () => {
  render(<PaintPrecisionBar objects={[rectangle]} ops={operations()} sizeLinked onSizeLinkedToggle={vi.fn()} />);
  expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "paint.measure.title" }));
  expect(screen.getAllByRole("spinbutton")).toHaveLength(5);
  expect(localStorage.getItem("paint-precision-open")).toBe("1");
});
it("requires a single selection rather than showing the first object's values", () => {
  localStorage.setItem("paint-precision-open", "1");
  render(<PaintPrecisionBar objects={[rectangle, { ...rectangle, id: "b" }]} ops={operations()} sizeLinked onSizeLinkedToggle={vi.fn()} />);
  expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  expect(screen.getByText("paint.measure.selectOne")).toBeInTheDocument();
});
it("discards unfinished input when the selected object changes", () => {
  localStorage.setItem("paint-precision-open", "1");
  const ops = operations();
  const view = render(<PaintPrecisionBar objects={[rectangle]} ops={ops} sizeLinked onSizeLinkedToggle={vi.fn()} />);
  const oldInput = screen.getByRole("spinbutton", { name: "common.width" });
  fireEvent.focus(oldInput); fireEvent.change(oldInput, { target: { value: "70,5" } });
  view.rerender(<PaintPrecisionBar objects={[{ ...rectangle, id: "b" }]} ops={ops} sizeLinked onSizeLinkedToggle={vi.fn()} />);
  expect(screen.getByRole("spinbutton", { name: "common.width" })).not.toBe(oldInput);
  expect(screen.getByRole("spinbutton", { name: "common.width" })).toHaveValue("20");
  expect(ops.setSelectedObjectSize).not.toHaveBeenCalled();
});
it("locks proportions for an imported page", () => {
  localStorage.setItem("paint-precision-open", "1");
  render(<PaintPrecisionBar objects={[{ ...rectangle, data: { sourcePage: { width: 40, height: 20 } } }]} ops={operations()}
    sizeLinked={false} onSizeLinkedToggle={vi.fn()} />);
  expect(screen.getByRole("button", { name: "paint.keepAspect" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "paint.keepAspect" })).toHaveAttribute("aria-pressed", "true");
});
it("integrates completed input with exactly one undo step and restores the original size", () => {
  localStorage.setItem("paint-precision-open", "1");
  const base = rememberPage({ id: "precision-integration", name: "test", objects: [rectangle],
    grid: { step: 10, snap: false }, created: 0, modified: 0 } as Page);
  function Editor() {
    const [page, setPage] = useState<Page | null>(base);
    const ops = useObjectOps(page, { plot_width: 200, plot_height: 100 } as Calibration, ["a"], setPage,
      vi.fn(), queueObjects, vi.fn(), vi.fn(), "Text", true);
    return <><PaintPrecisionBar objects={page!.objects} ops={ops} sizeLinked onSizeLinkedToggle={vi.fn()} />
      <output data-testid="history">{ops.history.undo}</output><button onClick={ops.undo}>Undo</button></>;
  }
  render(<Editor />);
  const width = screen.getByRole("spinbutton", { name: "common.width" });
  fireEvent.focus(width);
  for (const value of ["1", "12", "120"]) fireEvent.change(width, { target: { value } });
  expect(screen.getByTestId("history")).toHaveTextContent("0");
  fireEvent.blur(width);
  expect(screen.getByTestId("history")).toHaveTextContent("1");
  expect(width).toHaveValue("120");
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(width).toHaveValue("20");
  expect(screen.getByTestId("history")).toHaveTextContent("0");
});
