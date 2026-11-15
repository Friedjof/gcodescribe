// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TabSettings from "./TabSettings";
import { InterfaceProvider } from "../../interface/InterfaceProvider";
import { defaultInterfacePreferences, INTERFACE_STORAGE_KEY } from "../../interface/preferences";
vi.mock("../../i18n", () => ({ useI18n: () => ({ t: (key: string, args?: Record<string, string>) => args ? `${key}:${args.name}` : key }) }));
beforeEach(() => localStorage.clear());
afterEach(cleanup);
it("persists visibility and ordering without opening or resetting editors", () => {
  const open = vi.fn();
  render(<InterfaceProvider><TabSettings aiEnabled onClose={vi.fn()} onOpen={open} /></InterfaceProvider>);
  fireEvent.click(screen.getByRole("checkbox", { name: /workspace.font/ }));
  const stored = () => JSON.parse(localStorage.getItem(INTERFACE_STORAGE_KEY)!);
  expect(stored().visibleWorkspaces).toContain("font");
  fireEvent.click(screen.getByRole("button", { name: "interface.moveTabUp:workspace.font" }));
  expect(stored().workspaceOrder.indexOf("font")).toBe(7);
  expect(open).not.toHaveBeenCalled();
});
it("does not allow hiding the last available workspace or enabling server-disabled AI", () => {
  localStorage.setItem(INTERFACE_STORAGE_KEY, JSON.stringify({ ...defaultInterfacePreferences(), visibleWorkspaces: ["paint"] }));
  render(<InterfaceProvider><TabSettings aiEnabled={false} onClose={vi.fn()} onOpen={vi.fn()} /></InterfaceProvider>);
  expect((screen.getByRole("checkbox", { name: /workspace.paint/ }) as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole("checkbox", { name: /workspace.ai/ }) as HTMLInputElement).disabled).toBe(true);
});
