// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EffectiveSettings } from "../../api";
import SettingsDialog from "./SettingsDialog";
const mocks = vi.hoisted(() => ({ getEffectiveSettings: vi.fn(), patchSettings: vi.fn(), resetSetting: vi.fn(), printerConnections: vi.fn(), listSerialPorts: vi.fn(), savePrinterConnection: vi.fn() }));
vi.mock("../../api", () => ({ api: mocks }));
vi.mock("../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../paint/hooks/useTextFonts", () => ({ useTextFonts: () => ({ fonts: [], loading: false, error: null, reload: vi.fn(), setFonts: vi.fn() }), fontLabel: () => "font" }));
const settings = {
 printer: { octoprint_url: "http://printer.local", octoprint_api_key_configured: true, octoprint_verify_ssl: true, serial_enabled: false, serial_port: "", serial_baud: 115200, default_backend: "" },
 ai: { enabled: false, fake: false, api_key_configured: false, model: "gpt-image-1", api_mode: "images", size: "1024x1024", quality: "medium", max_input_mb: 10, timeout_seconds: 60 },
 storage: { data_dir: "/tmp/test" }, auth: { session_ttl: 3600, cookie_secure: false }, server: { host: "localhost", port: 8000, redis_url: "" }, mcp: { enabled: false, token_configured: false }, gallery: { upload_enabled: false, upload_secret_configured: false }, sources: { printer: {}, ai: {}, storage: {}, auth: {}, server: {}, mcp: {}, gallery: {} },
} as EffectiveSettings;
afterEach(cleanup);
beforeEach(() => { Object.values(mocks).forEach((mock) => mock.mockReset()); mocks.getEffectiveSettings.mockResolvedValue(settings); mocks.patchSettings.mockResolvedValue(settings); mocks.printerConnections.mockResolvedValue([{ id: "left", name: "Plotter links", transport: "serial", serial_port: "/dev/left", serial_baud: 115200 }]); mocks.listSerialPorts.mockResolvedValue([]); });
it("shows printers directly in Settings without a second dialog", async () => {
 render(<SettingsDialog onClose={vi.fn()}/>);
 expect(await screen.findByText("Plotter links")).toBeDefined();
 expect(screen.getAllByRole("dialog")).toHaveLength(1);
 expect(screen.queryByRole("combobox", { name: "settings.printer.default_backend" })).toBeNull();
 fireEvent.click(screen.getByRole("button", { name: "printers.add" }));
 expect(screen.getByRole("textbox", { name: "printers.name" })).toBeDefined();
 expect(screen.getAllByRole("dialog")).toHaveLength(1);
});
it("protects unsaved printer edits when closing or changing settings tabs", async () => {
 const close = vi.fn(); render(<SettingsDialog onClose={close}/>);
 fireEvent.click(await screen.findByRole("button", { name: "printers.add" }));
 fireEvent.change(screen.getByRole("textbox", { name: "printers.name" }), { target: { value: "Rechts" } });
 expect((screen.getByRole("button", { name: "settings.section.ai" }) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole("button", { name: "common.close" }));
 const confirm = screen.getByRole("dialog", { name: "settings.discardTitle" });
 fireEvent.click(within(confirm).getByRole("button", { name: "common.cancel" }));
 expect(close).not.toHaveBeenCalled();
 expect((screen.getByRole("textbox", { name: "printers.name" }) as HTMLInputElement).value).toBe("Rechts");
});
it("locks editing and closing while another settings save is pending", async () => {
 let resolve!: (data: EffectiveSettings) => void;
 mocks.patchSettings.mockReturnValue(new Promise((done) => { resolve = done; }));
 const close = vi.fn(); render(<SettingsDialog onClose={close}/>);
 fireEvent.click(await screen.findByRole("button", { name: "settings.section.ai" }));
 fireEvent.click(screen.getByRole("button", { name: "settings.group.output" }));
 const model = screen.getByRole("textbox", { name: "settings.ai.model" });
 fireEvent.change(model, { target: { value: "new-model" } });
 fireEvent.click(screen.getByRole("button", { name: "common.save" }));
 expect((model.closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole("button", { name: "common.close" })); expect(close).not.toHaveBeenCalled();
 await act(async () => resolve({ ...settings, ai: { ...settings.ai, model: "new-model" } }));
 expect((model as HTMLInputElement).value).toBe("new-model");
});
it("keeps non-printer drafts across sections", async () => {
 render(<SettingsDialog onClose={vi.fn()}/>);
 fireEvent.click(await screen.findByRole("button", { name: "settings.section.ai" }));
 fireEvent.click(screen.getByRole("button", { name: "settings.group.output" }));
 fireEvent.change(screen.getByRole("textbox", { name: "settings.ai.model" }), { target: { value: "new-model" } });
 fireEvent.click(screen.getByRole("button", { name: "settings.section.printer" }));
 expect(screen.getByText("Plotter links")).toBeDefined();
 fireEvent.click(screen.getByRole("button", { name: "settings.section.ai" }));
 fireEvent.click(screen.getByRole("button", { name: "settings.group.output" }));
 fireEvent.click(screen.getByRole("button", { name: "common.save" }));
 await waitFor(() => expect(mocks.patchSettings).toHaveBeenCalledWith({ "ai.model": "new-model" }));
});

it("keeps desktop settings focused on local features and removes Fonts everywhere", async()=>{
 const {rerender}=render(<SettingsDialog desktop onClose={vi.fn()}/>);
 await screen.findByText("Plotter links");
 expect(screen.queryByRole("button",{name:"settings.section.server"})).toBeNull();
 expect(screen.queryByRole("button",{name:"settings.section.auth"})).toBeNull();
 expect(screen.queryByRole("button",{name:"settings.section.fonts"})).toBeNull();
 expect(screen.getByRole("button",{name:"settings.section.mcp"})).toBeDefined();
 rerender(<SettingsDialog onClose={vi.fn()}/>);
 expect(screen.getByRole("button",{name:"settings.section.server"})).toBeDefined();
 expect(screen.getByRole("button",{name:"settings.section.auth"})).toBeDefined();
 expect(screen.queryByRole("button",{name:"settings.section.fonts"})).toBeNull();
});
