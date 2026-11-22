import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { PrinterBackendInfo, PrinterStatus } from "../api/types/printer";
import { errorMessage } from "../api/errors";
import { useI18n } from "../i18n";
import { isPrinterBusy } from "../lib/printerState";
import { useToasts } from "./Toasts";

export default function PrinterSelector({ status, onAction, onManage, onSwitching }: {
  status: PrinterStatus | null; onAction: () => void; onManage: () => void;
  onSwitching: (switching: boolean) => void;
}) {
  const { t } = useI18n();
  const toast = useToasts();
  const [printers, setPrinters] = useState<PrinterBackendInfo[]>([]);
  const [switching, setSwitching] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    let alive = true, loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try { const items = await api.listBackends(); if (alive) setPrinters(items.filter(item => item.configured)); }
      catch { /* Keep the last known selection during a temporary polling failure. */ }
      finally { loading = false; }
    };
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 4000);
    return () => { alive = false; clearInterval(timer); };
  }, [status?.printer_id, status?.backend, status?.configured]);
  const selected = status?.printer_id ?? printers.find(item => item.active)?.id ?? "";
  const blocked = switching || !status || isPrinterBusy(status);
  const state = (item: PrinterBackendInfo) => {
    if (item.busy) return t("printers.busy");
    if (item.online) return t("printers.online");
    if (item.available) return t(item.transport === "octoprint" ? "printers.serverReachable" : "printers.detected");
    return t("printers.offline");
  };
  const select = async (id: string) => {
    if (blocked || pending.current || id === selected) return;
    pending.current = true; setSwitching(true); onSwitching(true);
    try { await api.setBackend(id); }
    catch (error) { toast.error(errorMessage(error)); }
    finally { pending.current = false; setSwitching(false); onSwitching(false); onAction(); }
  };
  return <div className="printer-selector">
    <select aria-label={t("printers.select")} value={printers.some(item => item.id === selected) ? selected : ""}
      disabled={blocked || !printers.length} title={isPrinterBusy(status) ? t("printer.switchBlocked") : t("printers.select")}
      onChange={event => void select(event.target.value)}>
      {!printers.some(item => item.id === selected) && <option value="">{t("printers.none")}</option>}
      {printers.map(item => <option key={item.id} value={item.id}>
        {item.online ? "●" : item.available ? "◐" : "○"} {item.name ?? t(`printer.backend.${item.id}`)} · {state(item)}{item.id === selected ? ` · ${t("printers.selected")}` : ""}
      </option>)}
    </select>
    <button type="button" onClick={onManage} disabled={switching} title={t("printers.manage")} aria-label={t("printers.manage")}>⚙</button>
  </div>;
}
