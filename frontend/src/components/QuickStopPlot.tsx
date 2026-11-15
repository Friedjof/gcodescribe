import { useEffect, useState } from "react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { useToasts } from "./Toasts";

const STOPPABLE_STATES = ["printing", "starting", "pausing", "paused", "resuming", "finishing", "cancelling"];

export function canStopPlot(status: any): boolean {
  const state = String(status?.job?.state ?? "").toLowerCase();
  return STOPPABLE_STATES.some((active) => state.includes(active));
}

export default function QuickStopPlot({ status, onAction }: {
  status: any;
  onAction: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const toast = useToasts();
  const [pending, setPending] = useState(false);
  const [requested, setRequested] = useState(false);
  const cancelling = String(status?.job?.state ?? "").toLowerCase().includes("cancelling");

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
      toast.error(String((error as Error)?.message ?? error));
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
