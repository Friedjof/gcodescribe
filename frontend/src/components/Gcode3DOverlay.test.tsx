// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import Gcode3DOverlay from "./Gcode3DOverlay";

vi.mock("../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("./Gcode3D", () => ({ default: ({ showBed }: { showBed: boolean }) =>
  <div data-testid="path-view" data-show-bed={showBed} /> }));

it("shows the real bed size in the large view and lets it be hidden", () => {
  const data = { draws: [[[20, 30, 1], [40, 50, 1]]], travels: [],
    bounds: [20, 30, 1, 40, 50, 1] as [number, number, number, number, number, number],
    bed: [220, 180] as [number, number], truncated: false };
  render(<Gcode3DOverlay data={data} onClose={vi.fn()} />);
  const toggle = screen.getByRole("checkbox", { name: "g3d.bed · 220 × 180 mm" });
  expect((toggle as HTMLInputElement).checked).toBe(true);
  expect(screen.getByTestId("path-view").getAttribute("data-show-bed")).toBe("true");
  fireEvent.click(toggle);
  expect((toggle as HTMLInputElement).checked).toBe(false);
  expect(screen.getByTestId("path-view").getAttribute("data-show-bed")).toBe("false");
});
