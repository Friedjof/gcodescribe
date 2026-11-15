// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QuickStopPlot, { canStopPlot } from "./QuickStopPlot";

const mocks = vi.hoisted(() => ({ jobCommand: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("../api", () => ({ api: { jobCommand: mocks.jobCommand } }));
vi.mock("../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("./Toasts", () => ({ useToasts: () => ({ success: mocks.success, error: mocks.error }) }));

beforeEach(() => Object.values(mocks).forEach((mock) => mock.mockReset()));
afterEach(cleanup);

describe("quick plot stop", () => {
  it.each(["Printing", "Starting", "Pausing", "Paused", "Resuming", "Finishing", "Cancelling"])(
    "is available while the job is %s", (state) => {
      expect(canStopPlot({ job: { state } })).toBe(true);
    }
  );

  it("is hidden for an idle or missing job", () => {
    expect(canStopPlot({ job: { state: "Operational" } })).toBe(false);
    expect(canStopPlot({ job: null })).toBe(false);
  });

  it("does not send a second request while cancellation is already underway", () => {
    render(<QuickStopPlot status={{ job: { state: "Cancelling" } }} onAction={vi.fn()} />);
    const button = screen.getByRole("button", { name: "plot.quickStopping" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(mocks.jobCommand).not.toHaveBeenCalled();
  });

  it("sends one cancel command immediately and refreshes the status", async () => {
    let resolveCommand!: (value: unknown) => void;
    mocks.jobCommand.mockReturnValue(new Promise((resolve) => { resolveCommand = resolve; }));
    const onAction = vi.fn();
    render(<QuickStopPlot status={{ job: { state: "Printing" } }} onAction={onAction} />);

    fireEvent.click(screen.getByRole("button", { name: "plot.quickStop" }));
    expect(mocks.jobCommand).toHaveBeenCalledExactlyOnceWith("cancel");
    expect(screen.getByRole("button", { name: "plot.quickStopping" })).toBeDisabled();

    resolveCommand({ ok: true });
    await waitFor(() => expect(onAction).toHaveBeenCalledOnce());
    expect(mocks.success).toHaveBeenCalledWith("plot.quickStopped");
    expect(screen.getByRole("button", { name: "plot.quickStopping" })).toBeDisabled();
  });

  it("allows another attempt when cancellation fails", async () => {
    mocks.jobCommand.mockRejectedValueOnce(new Error("Printer unavailable"));
    const onAction = vi.fn();
    render(<QuickStopPlot status={{ job: { state: "Paused" } }} onAction={onAction} />);

    fireEvent.click(screen.getByRole("button", { name: "plot.quickStop" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "plot.quickStop" })).toBeEnabled());
    expect(mocks.error).toHaveBeenCalledWith("Printer unavailable");
    expect(onAction).toHaveBeenCalledOnce();
  });
});
