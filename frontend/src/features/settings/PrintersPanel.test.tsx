// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PrintersPanel from "./PrintersPanel";

const mocks = vi.hoisted(() => ({ printerConnections: vi.fn(), listSerialPorts: vi.fn(), savePrinterConnection: vi.fn(), deletePrinterConnection: vi.fn() }));
vi.mock("../../api", () => ({ api: mocks }));
vi.mock("../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
const left = { id: "left", name: "Plotter links", transport: "serial", serial_port: "/dev/left", serial_baud: 115200, octoprint_api_key_configured: false };
const right = { id: "right", name: "Plotter rechts", transport: "octoprint", octoprint_url: "http://right.local", octoprint_verify_ssl: true, octoprint_api_key_configured: true };
const status = { configured: true, online: true, backend: "serial" as const, printer_id: "left" };
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.printerConnections.mockResolvedValue([left, right]);
  mocks.listSerialPorts.mockResolvedValue([{ device: "/dev/ttyUSB1", byId: "/dev/serial/by-id/right", description: "Right USB" }]);
  mocks.savePrinterConnection.mockResolvedValue({ id: "new" });
  mocks.deletePrinterConnection.mockResolvedValue({ ok: true });
});
it("creates a named USB printer with a persistent port path", async () => {
  const changed = vi.fn();
  render(<PrintersPanel status={status} onChanged={changed} />);
  await screen.findByText("Plotter links");
  fireEvent.click(screen.getByRole("button", { name: "printers.add" }));
  fireEvent.change(screen.getByLabelText("printers.name"), { target: { value: "Dritter Plotter" } });
  fireEvent.change(screen.getByLabelText("printers.port"), { target: { value: "/dev/serial/by-id/right" } });
  fireEvent.click(screen.getByRole("button", { name: "common.save" }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(mocks.savePrinterConnection).toHaveBeenCalledWith(expect.objectContaining({ name: "Dritter Plotter", serial_port: "/dev/serial/by-id/right", transport: "serial" }), undefined);
});
it("edits an OctoPrint name while retaining the saved secret and omitting response-only fields", async () => {
  render(<PrintersPanel status={status} onChanged={vi.fn()} />);
  const row = (await screen.findByText("Plotter rechts")).closest("li")!;
  fireEvent.click(within(row).getByRole("button", { name: "common.edit" }));
  fireEvent.change(screen.getByLabelText("printers.name"), { target: { value: "Rechts umbenannt" } });
  expect(screen.getByLabelText("printers.apiKey")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "common.save" }));
  await waitFor(() => expect(mocks.savePrinterConnection).toHaveBeenCalledOnce());
  const [data, id] = mocks.savePrinterConnection.mock.calls[0];
  expect(id).toBe("right");
  expect(data.name).toBe("Rechts umbenannt");
  expect(data.octoprint_api_key).toBe("");
  expect(data).not.toHaveProperty("id");
  expect(data).not.toHaveProperty("octoprint_api_key_configured");
});
it("protects the active printer during a plot and allows editing another printer", async () => {
  render(<PrintersPanel status={{ ...status, job: { state: "Printing" } }} onChanged={vi.fn()} />);
  const row = (await screen.findByText("Plotter links")).closest("li")!;
  expect(within(row).getByRole("button", { name: "common.edit" })).toBeDisabled();
  expect(within(row).getByRole("button", { name: "common.delete" })).toBeDisabled();
  const other = screen.getByText("Plotter rechts").closest("li")!;
  expect(within(other).getByRole("button", { name: "common.edit" })).toBeEnabled();
});
it("reports server validation failures without discarding the entered connection", async () => {
  mocks.savePrinterConnection.mockRejectedValue(new Error("Anschluss bereits vergeben"));
  render(<PrintersPanel status={status} onChanged={vi.fn()} />);
  await screen.findByText("Plotter links");
  fireEvent.click(screen.getByRole("button", { name: "printers.add" }));
  fireEvent.change(screen.getByLabelText("printers.name"), { target: { value: "Dritter" } });
  fireEvent.change(screen.getByLabelText("printers.port"), { target: { value: "/dev/left" } });
  fireEvent.click(screen.getByRole("button", { name: "common.save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Anschluss bereits vergeben");
  expect(screen.getByLabelText("printers.name")).toHaveValue("Dritter");
});
