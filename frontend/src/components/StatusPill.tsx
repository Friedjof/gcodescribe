import type { PrinterStatus } from "../api/types/printer";
import { useI18n } from "../i18n";
import { isPrinting } from "../lib/printerState";

/** Compact printer/backend status indicator shown in the app header. */
export default function StatusPill({ status }: { status: PrinterStatus | null }) {
  const { t } = useI18n();
  if (!status) return <span className="pill off">{t("status.backendOffline")}</span>;
  if (!status.configured)
    return <span className="pill warn">{t("status.octoUnconfigured")}</span>;
  if (!status.online) return <span className="pill off">{t("status.octoOffline")}</span>;
  const state = status.printer?.state?.text ?? status.connection?.state ?? t("status.connected");
  const printing = isPrinting(status);
  return (
    <span className={`pill ${printing ? "busy" : "ok"}`}>
      ● {state}
    </span>
  );
}
