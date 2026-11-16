import { expect, it, vi } from "vitest";
import { defaultInterfacePreferences, InterfacePreferencesStore, normalizeInterfacePreferences, readInterfacePreferences } from "./preferences";
import { usableWorkspace, visibleWorkspaces } from "./workspaces";
it("starts with a light guided interface and five practical workspaces", () => {
  const defaults = defaultInterfacePreferences();
  expect(defaults.theme).toBe("light");
  expect(defaults.propertiesPanel.open).toBe(false);
  expect(defaults.visibleWorkspaces).toEqual(["start", "paint", "games", "convert", "paper"]);
});
it("repairs unavailable, duplicated and empty preference data", () => {
  const prefs = normalizeInterfacePreferences({ version: 1, workspaceOrder: ["font", "font", "unknown"], visibleWorkspaces: [],
    pagesPanel: { width: 9999 }, propertiesPanel: { width: -10 }, canvas: { padding: Infinity } });
  expect(prefs.workspaceOrder[0]).toBe("font");
  expect(new Set(prefs.workspaceOrder).size).toBe(prefs.workspaceOrder.length);
  expect(prefs.visibleWorkspaces).toContain("start");
  expect(prefs.pagesPanel.width).toBe(400); expect(prefs.propertiesPanel.width).toBe(240);
  expect(prefs.canvas.padding).toBe(32);
});
it("keeps server-disabled AI hidden even if preferences ask to show it", () => {
  expect(visibleWorkspaces(["paint", "ai"], ["paint", "ai"], false).map(workspace => workspace.id)).toEqual(["paint"]);
  expect(usableWorkspace("ai", ["ai"], ["ai"], false)).toBe("start");
  expect(visibleWorkspaces(["ai"], ["ai"], false).map(workspace => workspace.id)).toEqual(["start"]);
});
it("chooses a visible neighbour when the active workspace is hidden", () => {
  expect(usableWorkspace("paint", ["start", "paint", "games"], ["start", "games"], false)).toBe("games");
  expect(usableWorkspace("games", ["start", "paint", "games"], ["start", "paint"], false)).toBe("paint");
});
it("preserves explicit tab choices when changing experience or theme", () => {
  const store = new InterfacePreferencesStore();
  store.update(prefs => ({ ...prefs, visibleWorkspaces: ["font", "paint"] }));
  store.update(prefs => ({ ...prefs, experience: "full", theme: "dark" }));
  expect(store.getSnapshot().visibleWorkspaces).toEqual(["font", "paint"]);
});
it("recovers from blocked or corrupt storage while retaining local updates", () => {
  expect(readInterfacePreferences({ getItem: () => "invalid JSON" })).toEqual(defaultInterfacePreferences());
  const store = new InterfacePreferencesStore({ getItem: () => null, setItem: () => { throw new Error("blocked"); } });
  const changed = vi.fn(); store.subscribe(changed);
  store.update(prefs => ({ ...prefs, density: "compact" }));
  expect(store.getSnapshot().density).toBe("compact"); expect(changed).toHaveBeenCalledOnce();
});
it("does not interpret unsupported preference schema versions", () => {
  expect(normalizeInterfacePreferences({ version: 2, theme: "dark", visibleWorkspaces: ["font"] })).toEqual(defaultInterfacePreferences());
});
