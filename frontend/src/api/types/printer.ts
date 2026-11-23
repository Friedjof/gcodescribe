export type PrinterTransport = "octoprint" | "serial";
export interface PrinterCheckResult {
  id: string; ok: boolean; canProbe: boolean;
  steps: { key: string; state: "ok" | "failed" | "skipped" | "busy"; message: string; messageKey?:string;variables?:Record<string,string|number> }[];
}
export type PrinterBackendId = string;

/** Shared subset of OctoPrint's job payload and the serial worker snapshot. */
export interface PrinterJob {
  id?: string | null;
  state?: string | null;
  progress?: { completion?: number | null } | null;
  job?: { file?: { name?: string | null } | null } | null;
}

export interface PrinterJobResult {
  id: string;
  filename: string;
  outcome: "completed" | "cancelled" | "failed";
}

/** Unconfigured/offline backends omit fields they cannot determine. */
export interface PrinterStatus {
  configured: boolean;
  backend?: PrinterTransport;
  printer_id?: string;
  online?: boolean;
  url?: string;
  connection?: { state?: string | null } | null;
  printer?: { state?: { text?: string | null } | null } | null;
  job?: PrinterJob | null;
  last_job?: PrinterJobResult | null;
  error?: string | null;
  motion_locked?: boolean;
}

export interface PrinterBackendInfo {
  id: PrinterBackendId;
  configured: boolean;
  online: boolean;
  active: boolean;
  name?: string;
  transport?: PrinterTransport;
  available?: boolean;
  busy?: boolean;
}

export interface PrinterConnectionInput {
  name: string;
  transport: PrinterTransport;
  serial_port: string;
  serial_baud: number;
  octoprint_url: string;
  octoprint_api_key?: string;
  octoprint_verify_ssl: boolean;
}
export interface PrinterConnection extends Omit<PrinterConnectionInput, "octoprint_api_key"> {
  id: string;
  octoprint_api_key_configured: boolean;
}

export interface OctoPrintCheckResult {
  ok: boolean;
  version?: string;
  api?: string;
  error?: string;
}
