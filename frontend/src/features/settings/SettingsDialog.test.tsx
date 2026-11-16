// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EffectiveSettings } from "../../api";
import SettingsDialog from "./SettingsDialog";
const mocks = vi.hoisted(() => ({ getEffectiveSettings: vi.fn(), patchSettings: vi.fn(), resetSetting: vi.fn(), octoprintCheck: vi.fn() }));
vi.mock("../../api", () => ({ api: mocks }));
vi.mock("../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../paint/hooks/useTextFonts", () => ({ useTextFonts: () => ({ fonts: [], loading: false, error: null, reload: vi.fn(), setFonts: vi.fn() }), fontLabel: () => "font" }));
const settings = {
 printer: { octoprint_url: "http://printer.local", octoprint_api_key_configured: true, octoprint_verify_ssl: true, serial_enabled: false, serial_port: "", serial_baud: 115200, default_backend: "" },
 ai: { enabled: false, fake: false, api_key_configured: false, model: "gpt-image-1", api_mode: "images", size: "1024x1024", quality: "medium", max_input_mb: 10, timeout_seconds: 60 },
 storage: { data_dir: "/tmp/test" }, auth: { session_ttl: 3600, cookie_secure: false }, server: { host: "localhost", port: 8000, redis_url: "" }, mcp: { enabled: false, token_configured: false }, gallery: { upload_enabled: false, upload_secret_configured: false }, sources: { printer: {}, ai: {}, storage: {}, auth: {}, server: {}, mcp: {}, gallery: {} },
} as EffectiveSettings;
afterEach(cleanup);
beforeEach(() => { Object.values(mocks).forEach((mock) => mock.mockReset()); mocks.getEffectiveSettings.mockResolvedValue(settings); mocks.patchSettings.mockResolvedValue(settings); mocks.octoprintCheck.mockResolvedValue({ ok: true, version: "1" }); });
it("offers explicit connection types and retains changes across property groups", async () => {
 render(<SettingsDialog onClose={vi.fn()}/>);
 const backend = await screen.findByRole("combobox", { name: "settings.printer.default_backend" });
 expect(within(backend).getAllByRole("option").map((option) => (option as HTMLOptionElement).value)).toEqual(["", "serial", "octoprint"]);
 fireEvent.change(backend, { target: { value: "serial" } });
 fireEvent.click(screen.getByRole("button", { name: "settings.group.serial" }));
 fireEvent.change(screen.getByRole("textbox", { name: "settings.printer.serial_port" }), { target: { value: "/dev/ttyACM0" } });
 fireEvent.click(screen.getByRole("button", { name: "common.save" }));
 await waitFor(() => expect(mocks.patchSettings).toHaveBeenCalledWith({ "printer.default_backend": "serial", "printer.serial_port": "/dev/ttyACM0" }));
});
it("invalidates a green connection result after edits and requires saving before another test", async () => {
 render(<SettingsDialog onClose={vi.fn()}/>);
 fireEvent.click(await screen.findByRole("button", { name: "settings.group.octoprint" }));
 fireEvent.click(screen.getByRole("button", { name: "settings.printer.checkConnection" }));
 await screen.findByText("settings.printer.checkOk");
 fireEvent.change(screen.getByRole("textbox", { name: "settings.printer.octoprint_url" }), { target: { value: "http://changed.local" } });
 expect(screen.queryByText("settings.printer.checkOk")).toBeNull();
 const button = screen.getByRole("button", { name: "settings.printer.checkConnection" });
 expect((button as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(button); expect(mocks.octoprintCheck).toHaveBeenCalledTimes(1);
 expect(screen.getByText("settings.printer.saveBeforeTest")).toBeDefined();
 fireEvent.click(screen.getByRole("button", { name: "common.save" }));
 await waitFor(() => expect((screen.getByRole("button", { name: "settings.printer.checkConnection" }) as HTMLButtonElement).disabled).toBe(false));
});
it("locks editing and closing while a save is pending so later drafts are not lost", async () => {
 let resolve!: (data: EffectiveSettings) => void;
 mocks.patchSettings.mockReturnValue(new Promise((done) => { resolve = done; }));
 const close = vi.fn(); render(<SettingsDialog onClose={close}/>);
 const backend = await screen.findByRole("combobox", { name: "settings.printer.default_backend" });
 fireEvent.change(backend, { target: { value: "serial" } });
 fireEvent.click(screen.getByRole("button", { name: "common.save" }));
 expect((backend.closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
 fireEvent.change(backend, { target: { value: "octoprint" } });
 fireEvent.click(screen.getByRole("button", { name: "common.close" })); expect(close).not.toHaveBeenCalled();
 await act(async () => resolve({ ...settings, printer: { ...settings.printer, default_backend: "serial" } }));
 expect((backend as HTMLSelectElement).value).toBe("serial");
});
it("lets a user keep unsaved settings when dismissing the dialog", async () => {
 const close = vi.fn(); render(<SettingsDialog onClose={close}/>);
 fireEvent.change(await screen.findByRole("combobox", { name: "settings.printer.default_backend" }), { target: { value: "serial" } });
 fireEvent.click(screen.getByRole("button", { name: "common.close" }));
 const confirm = screen.getByRole("dialog", { name: "settings.discardTitle" });
 fireEvent.click(within(confirm).getByRole("button", { name: "common.cancel" }));
 expect(close).not.toHaveBeenCalled();
 expect((screen.getByRole("combobox", { name: "settings.printer.default_backend" }) as HTMLSelectElement).value).toBe("serial");
});
