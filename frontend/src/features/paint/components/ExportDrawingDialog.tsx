import { useState } from "react";
import Modal from "../../../components/Modal";
import type { Calibration, Page } from "../../../api";
import { useI18n } from "../../../i18n";
import { IDENTITY, transformPolylines, type Pt } from "../lib/geometry";
import { preparePath } from "../lib/geometryTasks";
import { cachedPage, flushEdits } from "../../../api/pageEdits";

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function ExportDrawingDialog({ page, cal, onClose }: { page: Page; cal: Calibration; onClose: () => void }) {
  const { t } = useI18n();
  const [format, setFormat] = useState("svg"), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const exportDrawing = async () => {
    setBusy(true); setError("");
    try {
      await flushEdits(page.id);
      const current = cachedPage(page.id) ?? page;
      const filename = page.name.replace(/[/\\\x00-\x1f]/g, "_") || "drawing";
      if (format === "json") {
        downloadBlob(new Blob([JSON.stringify({ format: "gcodescribe-slide", version: 1, page: current, calibration: cal }, null, 2)], { type: "application/json" }), filename + ".json");
      } else {
        const objects = current.objects.map((object, index) => ({ object, index })).sort((a, b) => (a.object.zOrder ?? a.index) - (b.object.zOrder ?? b.index));
        const paths = await Promise.all(objects.map(async ({ object }) => {
          const path = await preparePath(transformPolylines((object.cachedPolylines ?? []) as Pt[][], object.transform ?? IDENTITY));
          return `<path d="${path}"${object.type === "mask-rect" || object.data?.mask === "erase" ? ' fill="white" stroke="white"' : ""}/>`;
        }));
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cal.plot_width}mm" height="${cal.plot_height}mm" viewBox="0 0 ${cal.plot_width} ${cal.plot_height}"><rect width="100%" height="100%" fill="white"/><g fill="none" stroke="black" stroke-width="0.3" stroke-linecap="round" stroke-linejoin="round">${paths.join("")}</g></svg>`;
        downloadBlob(new Blob([svg], { type: "image/svg+xml" }), filename + ".svg");
      }
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <Modal title={t("shortcuts.export")} onClose={() => { if (!busy) onClose(); }} footer={<button className="primary" disabled={busy} onClick={() => void exportDrawing()}>{t(busy ? "common.loading" : "shortcuts.export")}</button>}>
    <label>{t("shortcuts.format")}<select value={format} disabled={busy} onChange={e => setFormat(e.target.value)}>
      <option value="svg">SVG</option><option value="json">JSON</option>
    </select></label><p>{t("shortcuts.exportHint")}</p>{error && <p role="alert" className="err">{error}</p>}
  </Modal>;
}
