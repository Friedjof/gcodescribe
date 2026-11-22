import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import type { PrinterConnection, PrinterConnectionInput, PrinterStatus, SerialPortCandidate } from "../../api";
import { errorMessage } from "../../api/errors";
import { useI18n } from "../../i18n";
import { isPrinterBusy } from "../../lib/printerState";

const empty: PrinterConnectionInput = { name: "", transport: "serial", serial_port: "", serial_baud: 115200,
  octoprint_url: "", octoprint_api_key: "", octoprint_verify_ssl: true };

export default function PrintersPanel({ status, onChanged, onBusyChange, onDirtyChange }: {
  status: PrinterStatus | null; onChanged: () => void;
  onBusyChange?: (busy: boolean) => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const [printers, setPrinters] = useState<PrinterConnection[]>([]);
  const [ports, setPorts] = useState<SerialPortCandidate[]>([]);
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const pending = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => { onDirtyChange?.(editing !== undefined); }, [editing, onDirtyChange]);
  const refresh = () => api.printerConnections().then(setPrinters);
  useEffect(() => {
    let alive = true;
    api.printerConnections().then(items => { if (alive) setPrinters(items); })
      .catch(err => { if (alive) setError(errorMessage(err)); }).finally(() => { if (alive) setLoading(false); });
    api.listSerialPorts().then(items => { if (alive) setPorts(items); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  useEffect(() => { if (editing !== undefined) nameInput.current?.focus(); }, [editing]);
  const activeId = status?.printer_id ?? status?.backend;
  const locked = (id: string) => id === activeId && isPrinterBusy(status);
  const edit = (item?: PrinterConnection) => {
    setEditing(item?.id ?? null); setRemoving(null); setError("");
    if (item) {
      const { id: _id, octoprint_api_key_configured: _configured, ...values } = item;
      setForm({ ...empty, ...values, octoprint_api_key: "" });
    } else setForm({ ...empty });
  };
  const run = async (action: () => Promise<unknown>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await action(); setEditing(undefined); setRemoving(null); await refresh(); onChanged(); }
    catch (err) { setError(errorMessage(err)); }
    finally { pending.current = false; setBusy(false); }
  };
  const update = <K extends keyof PrinterConnectionInput>(key: K, value: PrinterConnectionInput[K]) => setForm(prev => ({ ...prev, [key]: value }));
  return <section className="printers-panel" aria-label={t("printers.manage")}>
    <h3>{t("printers.manage")}</h3>
    <p className="muted">{t("printers.intro")}</p>
    {error && <p role="alert" className="settings-err">{error}</p>}
    {loading ? <p>{t("common.loading")}</p> : <ul className="printers-list">
      {printers.map(item => <li key={item.id}>
        <div><strong>{item.name}</strong>{item.id === activeId && <span className="pbadge pbadge-active">{t("printers.selected")}</span>}
          <small>{item.transport === "serial" ? `USB / Serial · ${item.serial_port}` : `OctoPrint · ${item.octoprint_url}`}</small></div>
        <button disabled={busy || locked(item.id)} onClick={() => edit(item)}>{t("common.edit")}</button>
        <button disabled={busy || locked(item.id)} onClick={() => { setRemoving(item.id); setEditing(undefined); }}>{t("common.delete")}</button>
        {removing === item.id && <div className="printers-remove"><p>{t("printers.removeHint", { name: item.name })}</p>
          <button disabled={busy} onClick={() => setRemoving(null)}>{t("common.cancel")}</button>
          <button className="danger" disabled={busy} onClick={() => void run(() => api.deletePrinterConnection(item.id))}>{t("common.delete")}</button></div>}
      </li>)}
    </ul>}
    {isPrinterBusy(status) && <p className="muted">{t("printers.locked")}</p>}
    {editing === undefined ? <button className="primary" disabled={busy || loading} onClick={() => edit()}>{t("printers.add")}</button> :
      <form className="printer-form" onSubmit={event => { event.preventDefault(); void run(() => api.savePrinterConnection(form, editing ?? undefined)); }}>
        <h3>{t(editing ? "printers.edit" : "printers.add")}</h3>
        <fieldset disabled={busy || (!!editing && locked(editing))}>
          <label>{t("printers.name")}<input ref={nameInput} required maxLength={80} value={form.name} onChange={event => update("name", event.target.value)} placeholder={t("printers.nameHint")} /></label>
          <label>{t("printers.transport")}<select disabled={!!editing} value={form.transport} onChange={event => update("transport", event.target.value as "serial" | "octoprint")}>
            <option value="serial">USB / Serial</option><option value="octoprint">OctoPrint</option></select></label>
          {form.transport === "serial" ? <>
            <label>{t("printers.port")}<input list="printer-ports" required value={form.serial_port} onChange={event => update("serial_port", event.target.value)} placeholder="/dev/serial/by-id/…" /></label>
            <datalist id="printer-ports">{ports.map(port => <option key={port.byId ?? port.device} value={port.byId ?? port.device}>{port.description || port.device}</option>)}</datalist>
            <p className="muted">{t("printers.portHint")}</p>
            <button type="button" onClick={() => void api.listSerialPorts().then(setPorts).catch(err => setError(errorMessage(err)))}>{t("serial.rescan")}</button>
            <label>{t("printers.baud")}<input type="number" min={1200} max={2000000} required value={form.serial_baud} onChange={event => update("serial_baud", Number(event.target.value))} /></label>
          </> : <>
            <label>{t("printers.url")}<input type="url" required value={form.octoprint_url} onChange={event => update("octoprint_url", event.target.value)} placeholder="http://octopi.local" /></label>
            <label>{t("printers.apiKey")}<input type="password" autoComplete="new-password" value={form.octoprint_api_key ?? ""} onChange={event => update("octoprint_api_key", event.target.value)} placeholder={editing ? t("printers.keepKey") : ""} /></label>
            <label className="printer-checkbox"><input type="checkbox" checked={form.octoprint_verify_ssl} onChange={event => update("octoprint_verify_ssl", event.target.checked)} />{t("printers.ssl")}</label>
          </>}
          <div className="printer-form-actions"><button type="button" onClick={() => setEditing(undefined)}>{t("common.cancel")}</button>
            <button className="primary" type="submit">{busy ? t("common.loading") : t("common.save")}</button></div>
        </fieldset>
      </form>}
    <p className="muted">{t("printers.calibrationHint")}</p>
  </section>;
}
