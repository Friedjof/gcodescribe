// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Control from "./Control";
import PlotActionsMenu from "../paint/components/PlotActionsMenu";

const mocks = vi.hoisted(() => ({
  jog: vi.fn(), pen: vi.fn(), home: vi.fn(), jobCommand: vi.fn(),
  listBackends: vi.fn(), error: vi.fn(),
}));
vi.mock("../../api", () => ({ api: mocks }));
vi.mock("../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../../components/Toasts", () => ({ useToasts: () => ({ error: mocks.error }) }));

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.listBackends.mockResolvedValue([]);
  mocks.jog.mockResolvedValue({});
  mocks.pen.mockResolvedValue({});
  mocks.jobCommand.mockResolvedValue({});
});
afterEach(cleanup);

describe("manual motion during a print", () => {
  it.each(["Printing", "Starting", "Pausing", "Resuming", "Finishing"])(
    "blocks buttons and keyboard for %s", async (state) => {
      render(<Control status={{ configured: true, online: true, job: { state } }} onAction={vi.fn()} />);
      expect(screen.getByRole("button", { name: "control.penUp" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "control.homeAll" })).toBeDisabled();
      await userEvent.click(screen.getByRole("button", { name: "control.penUp" }));
      fireEvent.keyDown(window, { key: "PageUp" });
      fireEvent.keyDown(window, { key: "ArrowRight" });
      expect(mocks.jog).not.toHaveBeenCalled();
      expect(mocks.pen).not.toHaveBeenCalled();
      expect(mocks.home).not.toHaveBeenCalled();
    }
  );

  it("blocks manual motion while restoring a paused job", () => {
    render(<Control status={{ configured: true, online: true, motion_locked: true, job: { state: "Paused" } }}
      onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "control.penUp" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "PageUp" });
    expect(mocks.jog).not.toHaveBeenCalled();
  });

  it("allows manual motion in a settled pause", () => {
    render(<Control status={{ configured: true, online: true, job: { state: "Paused" } }} onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "control.penUp" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "control.penUp" }));
    expect(mocks.pen).toHaveBeenCalledWith(false);
  });

  it.each(["Starting", "Pausing", "Resuming", "Finishing", "Cancelling"])(
    "blocks switching backends while %s", async state => {
      mocks.listBackends.mockResolvedValue([
        { id: "serial", configured: true, online: true, active: true },
        { id: "octoprint", configured: true, online: true, active: false },
      ]);
      render(<Control status={{ configured: true, online: true, job: { state } }} onAction={vi.fn()} />);
      expect(await screen.findByRole("button", { name: "printer.activate" })).toBeDisabled();
    },
  );

  it("keeps cancelling available during a print", () => {
    render(<Control status={{ configured: true, online: true, job: { state: "Printing" } }} onAction={vi.fn()} />);
    const cancel = screen.getByRole("button", { name: /control.cancel/ });
    expect(cancel).not.toBeDisabled();
    fireEvent.click(cancel);
    expect(mocks.jobCommand).toHaveBeenCalledWith("cancel");
  });

  it("blocks starting another plot from the editor during a print", async () => {
    const start = vi.fn();
    render(<PlotActionsMenu busy={false} sending={false} printerBusy={true} printerOnline={true}
      pageBlocked={false} hasSelection={true} hasObjects={true}
      onDirectPlot={start} onPlotSelection={start} onOpenColoring={vi.fn()} />);
    const button = screen.getByRole("button", { name: "paint.directPlot" });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(start).not.toHaveBeenCalled();
  });
});
