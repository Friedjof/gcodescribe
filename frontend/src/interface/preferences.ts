import { DEFAULT_VISIBLE, WORKSPACE_IDS, isWorkspaceId, type WorkspaceId } from "./workspaces";
import { isDesktop } from "./desktop";

export type ThemePreference = "light" | "dark" | "system";
export type InterfaceDensity = "comfortable" | "compact";
export type Experience = "guided" | "full";
export interface InterfacePreferences {
  version: 1;
  theme: ThemePreference;
  density: InterfaceDensity;
  experience: Experience;
  workspaceOrder: WorkspaceId[];
  visibleWorkspaces: WorkspaceId[];
  pagesPanel: { open: boolean; width: number };
  propertiesPanel: { open: boolean; width: number };
  canvas: { rulers: boolean; gridVisible: boolean; padding: number };
}
export const INTERFACE_STORAGE_KEY = "gcs.interface.v1";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const number = (value: unknown, fallback: number, min: number, max: number) => typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const boolean = (value: unknown, fallback: boolean) => typeof value === "boolean" ? value : fallback;
const ids = (value: unknown, fallback: readonly WorkspaceId[]) => Array.isArray(value) ? [...new Set(value.map(id => id === "start" ? "paper" : id).filter(isWorkspaceId))] : [...fallback];
export function defaultInterfacePreferences(): InterfacePreferences {
  return { version: 1, theme: isDesktop() ? "system" : "light", density: "compact", experience: "guided", workspaceOrder: WORKSPACE_IDS.filter(id => id !== "start"),
    visibleWorkspaces: [...DEFAULT_VISIBLE], pagesPanel: { open: true, width: 220 }, propertiesPanel: { open: false, width: 260 },
    canvas: { rulers: true, gridVisible: false, padding: 32 } };
}
/** Corrupt storage and future schemas can never remove access to the editor. */
export function normalizeInterfacePreferences(value: unknown): InterfacePreferences {
  const defaults = defaultInterfacePreferences(), root = record(value);
  if (root.version !== 1) return defaults;
  const pages = record(root.pagesPanel), properties = record(root.propertiesPanel), canvas = record(root.canvas);
  const order = ids(root.workspaceOrder, WORKSPACE_IDS);
  const visible = ids(root.visibleWorkspaces, DEFAULT_VISIBLE);
  return { version: 1, theme: ["light", "dark", "system"].includes(String(root.theme)) ? root.theme as ThemePreference : defaults.theme,
    density: root.density === "comfortable" ? "comfortable" : "compact", experience: root.experience === "full" ? "full" : "guided",
    workspaceOrder: [...order, ...WORKSPACE_IDS.filter(id => id !== "start" && !order.includes(id))],
    visibleWorkspaces: visible.length ? visible : [...DEFAULT_VISIBLE],
    pagesPanel: { open: boolean(pages.open, true), width: number(pages.width, 220, 180, 400) },
    propertiesPanel: { open: boolean(properties.open, false), width: number(properties.width, 260, 240, 400) },
    canvas: { rulers: boolean(canvas.rulers, true), gridVisible: boolean(canvas.gridVisible, false), padding: number(canvas.padding, 32, 0, 72) } };
}
export function readInterfacePreferences(storage?: Pick<Storage, "getItem">): InterfacePreferences {
  try { return normalizeInterfacePreferences(JSON.parse(storage?.getItem(INTERFACE_STORAGE_KEY) ?? "null")); }
  catch { return defaultInterfacePreferences(); }
}

export class InterfacePreferencesStore {
  private snapshot: InterfacePreferences;
  private listeners = new Set<() => void>();
  constructor(private storage?: Pick<Storage, "getItem" | "setItem">) { this.snapshot = readInterfacePreferences(storage); }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  update = (change: (preferences: InterfacePreferences) => InterfacePreferences) => {
    const changed = change(this.snapshot);
    if (changed === this.snapshot) return;
    this.snapshot = normalizeInterfacePreferences(changed);
    try { this.storage?.setItem(INTERFACE_STORAGE_KEY, JSON.stringify(this.snapshot)); } catch { /* Preferences still work in memory. */ }
    this.listeners.forEach(listener => listener());
  };
  reload = () => { this.snapshot = readInterfacePreferences(this.storage); this.listeners.forEach(listener => listener()); };
  resetTabs = (full = false) => this.update(preferences => ({ ...preferences, workspaceOrder: WORKSPACE_IDS.filter(id => id !== "start"), visibleWorkspaces: full ? WORKSPACE_IDS.filter(id => id !== "start") : [...DEFAULT_VISIBLE] }));
}
