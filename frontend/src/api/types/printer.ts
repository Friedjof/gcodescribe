export type PrinterBackendId = "octoprint" | "serial";

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
  backend?: PrinterBackendId;
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
}

export interface OctoPrintCheckResult {
  ok: boolean;
  version?: string;
  api?: string;
  error?: string;
}
