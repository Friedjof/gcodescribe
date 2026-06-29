import { req } from "./req";
import type { AppSettings, EffectiveSettings } from "../types/settings";

export const settingsClient = {
  getSettings: () => req<AppSettings>("/api/settings"),
  getEffectiveSettings: () => req<EffectiveSettings>("/api/settings/effective"),
  patchSettings: (settings: Record<string, unknown>) =>
    req<EffectiveSettings>("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings }),
    }),
  resetSetting: (section: string, field: string) =>
    req<EffectiveSettings>(`/api/settings/${section}/${field}`, { method: "DELETE" }),
};
