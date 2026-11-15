export interface AppSettings {
  printer: {
    octoprint_url: string;
    octoprint_api_key_configured: boolean;
    octoprint_verify_ssl: boolean;
    serial_enabled: boolean;
    serial_port: string;
    serial_baud: number;
    default_backend: string;
  };
  ai: {
    enabled: boolean;
    fake: boolean;
    api_key_configured: boolean;
    model: string;
    api_mode: string;
    size: string;
    quality: string;
    max_input_mb: number;
    timeout_seconds: number;
  };
  storage: { data_dir: string };
  auth: { session_ttl: number; cookie_secure: boolean };
  server: { host: string; port: number; redis_url: string };
  gallery: { upload_enabled: boolean; upload_secret_configured: boolean };
  mcp: { enabled: boolean; token_configured: boolean };
}

export type SettingsSection = keyof AppSettings;
export type ConfigSource = "default" | "environment" | "saved";
export type SettingsSources = Record<SettingsSection, Partial<Record<string, ConfigSource>>>;
export type SettingValue = string | number | boolean;

// Flat section.field keys may also contain write-only secrets. Keep these
// separate from AppSettings, which only exposes secret presence flags.
export type SettingsPatch = Record<string, SettingValue>;

export interface EffectiveSettings extends AppSettings {
  sources: SettingsSources;
}

export interface McpTokenResponse {
  token: string;
  settings: EffectiveSettings;
}
