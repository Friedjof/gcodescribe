// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PrinterSelector from "./PrinterSelector";

const mocks = vi.hoisted(() => ({ listBackends: vi.fn(), setBackend: vi.fn(), error: vi.fn() }));
vi.mock("../api", () => ({ api: mocks }));
vi.mock("../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("./Toasts", () => ({ useToasts: () => ({ error: mocks.error }) }));
const status = { configured: true, online: true, backend: "serial" as const, printer_id: "left" };
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.listBackends.mockResolvedValue([
    { id: "left", name: "Plotter links", transport: "serial", online: true, configured: true, active: true },
    { id: "right", name: "Plotter rechts", transport: "serial", online: false, available: true, configured: true, active: false },
    { id: "offline", name: "Plotter offline", transport: "octoprint", online: false, configured: true, active: false },
  ]);
  mocks.setBackend.mockResolvedValue({ ok: true, active: "right" });
});

it("shows names, connection state and the selected printer in the dropdown", async () => {
  render(<PrinterSelector status={status} onAction={vi.fn()} onManage={vi.fn()} onSwitching={vi.fn()} />);
  expect(await screen.findByRole("option", { name: /Plotter links/ })).toHaveTextContent("printers.online · printers.selected");
  expect(screen.getByRole("option", { name: /Plotter rechts/ })).toHaveTextContent("printers.detected");
  expect(screen.getByRole("option", { name: /Plotter offline/ })).toHaveTextContent("printers.offline");
  expect(screen.getByRole("combobox")).toHaveValue("left");
});

it("switches between two printers of the same transport and refreshes status", async () => {
  const refresh = vi.fn(), switching = vi.fn();
  render(<PrinterSelector status={status} onAction={refresh} onManage={vi.fn()} onSwitching={switching} />);
  await screen.findByRole("option", { name: /Plotter rechts/ });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "right" } });
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(mocks.setBackend).toHaveBeenCalledExactlyOnceWith("right");
  expect(switching.mock.calls).toEqual([[true], [false]]);
});

it("blocks switching during paused plots but keeps management accessible", async () => {
  const manage = vi.fn();
  render(<PrinterSelector status={{ ...status, job: { state: "Paused" } }} onAction={vi.fn()} onManage={manage} onSwitching={vi.fn()} />);
  await screen.findByRole("option", { name: /Plotter rechts/ });
  expect(screen.getByRole("combobox")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "printers.manage" }));
  expect(manage).toHaveBeenCalledOnce();
  expect(mocks.setBackend).not.toHaveBeenCalled();
});

it("shows a failed switch and leaves the selected printer unchanged", async () => {
  mocks.setBackend.mockRejectedValue(new Error("Printer busy"));
  const refresh = vi.fn();
  render(<PrinterSelector status={status} onAction={refresh} onManage={vi.fn()} onSwitching={vi.fn()} />);
  await screen.findByRole("option", { name: /Plotter rechts/ });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "right" } });
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Printer busy"));
  expect(screen.getByRole("combobox")).toHaveValue("left");
  expect(refresh).toHaveBeenCalledOnce();
});
