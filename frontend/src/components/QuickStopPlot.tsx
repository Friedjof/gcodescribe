import { useEffect, useState } from "react";
import { errorMessage } from "../api/errors";
import type { PrinterStatus } from "../api/types/printer";
import { api } from "../api";
import { useI18n } from "../i18n";
import { useToasts } from "./Toasts";
import { hasActiveJob, printerJobState } from "../lib/printerState";

export const canStopPlot = hasActiveJob;

export default function QuickStopPlot({ status, onAction }: {
  status: PrinterStatus | null;
  onAction: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const toast = useToasts();
  const [pending, setPending] = useState(false);
  const [requested, setRequested] = useState(false);
  const cancelling = printerJobState(status).includes("cancelling");

  // Allow a retry if the printer still reports an active job after the request.
  useEffect(() => {
    if (!requested) return;
    const timer = window.setTimeout(() => setRequested(false), 8000);
    return () => window.clearTimeout(timer);
  }, [requested]);

  const stop = async () => {
    if (pending || requested || cancelling) return;
    setPending(true);
    try {
      await api.jobCommand("cancel");
      setRequested(true);
      toast.success(t("plot.quickStopped"));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
      void Promise.resolve().then(onAction).catch(() => {});
    }
  };

  const stopping = pending || requested || cancelling;
  return (
    <button
      type="button"
      className="quick-stop-plot"
      disabled={stopping}
      onClick={stop}
      aria-label={stopping ? t("plot.quickStopping") : t("plot.quickStop")}
      title={stopping ? t("plot.quickStopping") : t("plot.quickStop")}
    >
      <span className="quick-stop-plot-icon" aria-hidden="true" />
      <span>{stopping ? t("plot.quickStopping") : t("plot.quickStop")}</span>
    </button>
  );
}
