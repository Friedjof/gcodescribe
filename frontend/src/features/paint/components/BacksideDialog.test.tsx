// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Calibration, Page, PageMeta } from "../../../api";
import BacksideDialog from "./BacksideDialog";
const mocks = vi.hoisted(() => ({ getPage: vi.fn() }));
vi.mock("../../../api", () => ({ api: mocks }));
vi.mock("../../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../PageThumbnail", () => ({ default: () => <span /> }));
vi.mock("./canvas/ObjectsLayer", () => ({ default: () => <g data-drawing="true"/> }));
const target = { id: "back", projectId: "project", name: "Back", objects: [], grid: { step: 10, snap: false }, created: 0, modified: 1 } as Page;
const front = { ...target, id: "front", name: "Front", objects: [{ id: "f", type: "line", plotted: true, cachedPolylines: [[[10, 20], [40, 70]]] }] } as Page;
const cal = { plot_width: 200, plot_height: 280, origin_x: 5, origin_y: 5, paper_corners: {}, flip_y: true } as Calibration;
const pages = [front, target].map(page => ({ ...page, objectCount: page.objects.length, plottedCount: 0 })) as PageMeta[];
beforeEach(() => { mocks.getPage.mockReset().mockResolvedValue(front); });
afterEach(cleanup);
it("shows how to turn the sheet, previews the mirrored front and commits view settings only", async () => {
  const apply = vi.fn(), close = vi.fn(), before = JSON.stringify([front, target]);
  render(<BacksideDialog page={target} pages={pages} cal={cal} settings={null} onApply={apply} onClose={close}/>);
  expect(screen.getByRole("button", { name: "backside.apply" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Front" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "backside.apply" })).toBeEnabled());
  expect(screen.getByText("backside.turnSideways")).toBeInTheDocument();
  expect(document.querySelector('[data-backside-reference="front"] g[transform]'))
    .toHaveAttribute("transform", "matrix(-1 0 0 1 200 0)");
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "short" } });
  expect(screen.getByText("backside.turnUpwards")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("slider", { name: "backside.opacity" }), { target: { value: "25" } });
  fireEvent.click(screen.getByRole("button", { name: "backside.apply" }));
  expect(apply).toHaveBeenCalledExactlyOnceWith({ sourceId: "front", edge: "short", opacity: .25, enabled: true });
  expect(close).toHaveBeenCalledOnce();
  expect(JSON.stringify([front, target])).toBe(before);
  expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
});
it("does not change the reference when cancelled and lets a saved reference be removed", () => {
  const apply = vi.fn(), close = vi.fn();
  render(<BacksideDialog page={target} pages={pages} cal={cal}
    settings={{ sourceId: "front", edge: "long", opacity: .15, enabled: true }} onApply={apply} onClose={close}/>);
  fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "backside.remove" }));
  expect(apply).toHaveBeenCalledExactlyOnceWith(null);
});
