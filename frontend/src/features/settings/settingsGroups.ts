import type { SettingsPatch } from "../../api";
export function settingsGroups(section: string, values: SettingsPatch) {
  const entries = Object.entries(values);
  if (section === "printer") return [
    { id: "connection", fields: entries.filter(([key]) => key === "default_backend") },
    { id: "octoprint", fields: entries.filter(([key]) => key.startsWith("octoprint_")) },
    { id: "serial", fields: entries.filter(([key]) => key.startsWith("serial_")) },
  ];
  if (section === "ai") return [
    { id: "access", fields: entries.filter(([key]) => ["enabled", "fake", "api_key_configured"].includes(key)) },
    { id: "output", fields: entries.filter(([key]) => ["model", "api_mode", "size", "quality"].includes(key)) },
    { id: "limits", fields: entries.filter(([key]) => ["max_input_mb", "timeout_seconds"].includes(key)) },
  ];
  return [{ id: section, fields: entries }];
}
