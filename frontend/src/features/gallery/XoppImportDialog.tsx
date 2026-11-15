import { useEffect, useState } from "react";
import { previewXopp, startImport, type XoppPagePreview } from "../../api/assetTasks";
import { useI18n } from "../../i18n";
import Modal from "../../components/Modal";
import PolylinePreview from "../../components/PolylinePreview";

/** Select native Xournal++ pen pages before creating individual gallery items. */
export default function XoppImportDialog({ file, onClose, onImported }: {
  file: File;
  onClose: () => void;
  onImported: () => void;
}) {
  const { t } = useI18n();
  const [pages, setPages] = useState<XoppPagePreview[] | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    previewXopp(file)
      .then((next) => {
        if (!live) return;
        setPages(next);
        setSelected(next.filter((p) => p.strokes > 0).slice(0, 20).map((p) => p.n));
      })
      .catch((e) => { if (live) setError(String(e.message ?? e)); });
    return () => { live = false; };
  }, [file]);

  const toggle = (n: number) => {
    setSelected((current) => current.includes(n)
      ? current.filter((p) => p !== n)
      : current.length < 20 ? [...current, n].sort((a, b) => a - b) : current);
  };

  const submit = () => {
    if (!selected.length || busy) return;
    setBusy(true);
    setError("");
    startImport(file, { selectedPages: selected })
      .then(() => { onImported(); onClose(); })
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setBusy(false));
  };

  return (
    <Modal
      title={t("gallery.xopp.title")}
      onClose={() => { if (!busy) onClose(); }}
      className="xopp-import-modal"
      footer={<>
        <button className="ghost" disabled={busy} onClick={onClose}>{t("common.cancel")}</button>
        <button className="primary" disabled={busy || !selected.length || !pages} onClick={submit}>
          {busy ? t("common.loading") : selected.length === 1
            ? t("gallery.xopp.importOne") : t("gallery.xopp.importMany", { count: selected.length })}
        </button>
      </>}
    >
      <p className="muted">{file.name} · {t("gallery.xopp.hint")}</p>
      {error && <p role="alert" className="error">{error}</p>}
      {!pages && !error && <p>{t("common.loading")}</p>}
      {pages && <>
        <div className="xopp-import-actions">
          <button className="ghost tiny" onClick={() => setSelected(pages.filter((p) => p.strokes > 0).slice(0, 20).map((p) => p.n))}>{t("gallery.xopp.first20")}</button>
          <button className="ghost tiny" onClick={() => setSelected([])}>{t("gallery.xopp.clear")}</button>
          <span className="muted">{selected.length}/20</span>
        </div>
        <div className="xopp-import-grid">
          {pages.map((page) => (
            <button
              key={page.n}
              type="button"
              className={`xopp-import-page ${selected.includes(page.n) ? "selected" : ""}`}
              disabled={!page.strokes || busy}
              aria-pressed={selected.includes(page.n)}
              onClick={() => toggle(page.n)}
            >
              <PolylinePreview data={page.preview} />
              <span><strong>{t("gallery.page")} {page.n}</strong> · {t("gallery.xopp.strokes", { count: page.strokes })}</span>
            </button>
          ))}
        </div>
      </>}
    </Modal>
  );
}
