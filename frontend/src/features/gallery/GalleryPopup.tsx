import { useEffect, useRef, useState } from "react";
import {
  api,
  type Calibration,
  type GalleryItem,
  type GalleryPreview,
  type GalleryUploader,
  type ProfileRef,
  type SceneObject,
} from "../../api";
import { galleryPageObject } from "../paint/lib/insertAsset";
import { polylinesObject } from "../games/lib/utils";
import { resultToSvgLayers } from "../stl/lib";
import { useI18n } from "../../i18n";
import Modal from "../../components/Modal";
import StlEditor from "../stl/StlEditor";
import Segmented from "../../components/Segmented";
import PolylinePreview from "../../components/PolylinePreview";
import GalleryGrid from "./GalleryGrid";
import LazyThumbnail from "./LazyThumbnail";
import XoppImportDialog from "./XoppImportDialog";
import { startImport, startRender } from "../../api/assetTasks";
import ScoreBadge from "../../components/ScoreBadge";
import { useToasts } from "../../components/Toasts";

type UploaderFilter = "all" | GalleryUploader;
type RenderMode = "auto" | "vector" | "trace" | "edges" | "hatch" | "lines" | "dots" | "handwriting";

const MAX_UPLOAD_MB = 15;
const MAX_STL_MB = 20;
// Admin popup accepts the full asset library: images/SVG plus PDF/Office, and
// STL (which opens the orientation editor instead of uploading directly).
const ALLOWED = /\.(xopp|svg|png|jpe?g|pdf|odt|ods|odp|docx?|xlsx?|pptx?)$/i;
const ACCEPT =
  ".xopp,.svg,.png,.jpg,.jpeg,.pdf,.odt,.ods,.odp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.stl";

/** Designer popup over the unified gallery: upload, search/filter, browse and
 * insert an item (or one page of a multi-page asset) as an image object into
 * the current page. */
export default function GalleryPopup({
  cal,
  status,
  activeProfile,
  onClose,
  onInsert,
  onPlotted,
}: {
  cal: Calibration;
  status?: any;
  activeProfile?: ProfileRef | null;
  onClose: () => void;
  onInsert: (obj: SceneObject) => void;
  onPlotted?: () => void;
}) {
  const { t } = useI18n();
  const toast = useToasts();
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [filter, setFilter] = useState<UploaderFilter>("all");
  const [query, setQuery] = useState("");
  // Render controls applied to the next upload (admin asset path), matching the
  // old Place import: mode + detail. `vector` ignores detail.
  const [mode, setMode] = useState<RenderMode>("auto");
  const [detail, setDetail] = useState(2);
  const [continuous, setContinuous] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // When a multi-page asset is opened, the grid is replaced by a page picker.
  const [picker, setPicker] = useState<GalleryItem | null>(null);
  const [pagePreviews, setPagePreviews] = useState<Record<number, GalleryPreview>>({});
  const [stlNew, setStlNew] = useState<{ buf: ArrayBuffer; filename: string } | null>(null);
  const [xoppFile, setXoppFile] = useState<File | null>(null);
  const [stlSaving, setStlSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const online = !!status?.online;

  const fail = (e: any) => setErr(String(e.message ?? e));
  const load = () => api.galleryList(false).then(setItems).catch(fail);

  useEffect(() => {
    load();
    window.addEventListener("gcs:asset-ready", load);
    return () => window.removeEventListener("gcs:asset-ready", load);
  }, []);

  useEffect(() => {
    if (msg) toast.success(msg);
  }, [msg, toast]);

  useEffect(() => {
    if (err) toast.error(err);
  }, [err, toast]);

  const q = query.trim().toLowerCase();
  const visible = items.filter(
    (i) =>
      (filter === "all" || i.uploader === filter) &&
      (!q || i.title.toLowerCase().includes(q) || i.filename.toLowerCase().includes(q))
  );

  const openStl = (file: File) => {
    if (file.size > MAX_STL_MB * 1024 * 1024) return setErr(t("stl.errorTooLarge", { mb: String(MAX_STL_MB) }));
    setErr(null);
    file.arrayBuffer()
      .then((buf) => setStlNew({ buf, filename: file.name }))
      .catch(fail);
  };

  const upload = (file: File | undefined | null) => {
    if (!file || busy) return;
    if (/\.stl$/i.test(file.name)) return openStl(file);
    if (!ALLOWED.test(file.name)) return setErr(t("upload.badType"));
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return setErr(t("upload.tooLarge", { mb: String(MAX_UPLOAD_MB) }));
    if (/\.xopp$/i.test(file.name)) { setXoppFile(file); return; }
    setBusy(true);
    setErr(null);
    startImport(file, { mode, detail })
      .then(() => load())
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const rerender = (item: GalleryItem) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    startRender(item.id, mode, detail, continuous)
      .then(() => load())
      .catch(fail)
      .finally(() => setBusy(false));
  };

  // A single-page item inserts straight away; a multi-page asset opens the
  // page picker so the user chooses which page to bring in.
  const open = (item: GalleryItem) => {
    if (busy) return;
    if (item.pages.length > 1) {
      setPicker(item);
      setPagePreviews({});
      setErr(null);
      Promise.all(
        item.pages.map((p) =>
          api.galleryPreview(item.id, p.n).then((pv) => [p.n, pv] as const)
        )
      )
        .then((entries) => setPagePreviews(Object.fromEntries(entries)))
        .catch(fail);
      return;
    }
    insert(item, 1);
  };

  const insert = (item: GalleryItem, page: number, preview?: GalleryPreview) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const pv = item.kind === "xopp" ? api.galleryStrokes(item.id, page)
      : preview ? Promise.resolve(preview) : api.galleryPreview(item.id, page);
    pv
      .then((p) => {
        onInsert(galleryPageObject(item, p, page, cal));
        onClose();
      })
      .catch(fail)
      .finally(() => setBusy(false));
  };

  // Quick path: drop the page onto a fresh page, fitted, and plot it directly —
  // no need to enter the editor. The new page keeps the active profile.
  const quickPlot = (item: GalleryItem, page: number, preview?: GalleryPreview) => {
    if (busy || !online) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    const name = item.title || item.filename.replace(/\.[^.]+$/, "");
    const pv = item.kind === "xopp" ? api.galleryStrokes(item.id, page)
      : preview ? Promise.resolve(preview) : api.galleryPreview(item.id, page);
    pv
      .then((p) =>
        api.createPage(name).then((created) => ({ created, obj: galleryPageObject(item, p, page, cal) }))
      )
      .then(({ created, obj }) => api.savePage(created.id, { objects: [obj] }).then(() => created))
      .then((created) => api.pageGcode(created.id, activeProfile ?? undefined))
      .then((job) => api.send(job.filename, true))
      .then(() => {
        setMsg(t("gallery.plotStarted"));
        onPlotted?.();
      })
      .catch(fail)
      .finally(() => setBusy(false));
  };

  return (
    <>
    <Modal
      title={picker ? picker.title || picker.filename : t("gallery.popupTitle")}
      onClose={xoppFile ? () => setXoppFile(null) : onClose}
      className="gallery-popup"
      bodyClassName="gallery-popup-body"
    >
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }}
      />

      {picker ? (
        <PagePicker
          item={picker}
          previews={pagePreviews}
          online={online}
          busy={busy}
          onBack={() => setPicker(null)}
          onInsert={(page) => insert(picker, page, pagePreviews[page])}
          onQuickPlot={(page) => quickPlot(picker, page, pagePreviews[page])}
          t={t}
        />
      ) : (
        <>
          <div className="gallery-popup-controls">
            <button className="primary" disabled={busy} onClick={() => fileRef.current?.click()}>
              ⤓ {t("gallery.upload")}
            </button>
            <Segmented<UploaderFilter>
              className="gallery-filter-seg"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: t("gallery.filterAll") },
                { value: "admin", label: t("gallery.filterAdmin") },
                { value: "public", label: t("gallery.filterUser") },
              ]}
            />
            <input
              className="gallery-search"
              type="search"
              placeholder={t("gallery.search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="gallery-upload-opts">
            <span className="muted">{t("gallery.renderMode")}</span>
            <Segmented<RenderMode>
              value={mode}
              onChange={setMode}
              options={[
                { value: "auto", label: t("gallery.modeAuto") },
                { value: "vector", label: t("gallery.modeVector") },
                { value: "trace", label: t("gallery.modeTrace") },
                { value: "edges", label: t("paint.image.edges") },
                { value: "hatch", label: t("paint.image.hatch") },
                { value: "lines", label: t("paint.image.lines") },
                { value: "dots", label: t("paint.image.dots") },
                { value: "handwriting", label: t("gallery.modeHandwriting") },
              ]}
            />
            {mode !== "vector" && (
              <>
                <span className="muted">{t("paint.image.detail")}</span>
                <Segmented
                  value={detail}
                  onChange={setDetail}
                  options={[
                    { value: 1, label: t("paint.image.low") },
                    { value: 2, label: t("paint.image.medium") },
                    { value: 3, label: t("paint.image.high") },
                  ]}
                />
              </>
            )}
            <label className="gallery-continuous-toggle" title={t("paint.image.continuousDesc")}>
              <input
                type="checkbox"
                checked={continuous}
                onChange={(e) => setContinuous(e.target.checked)}
              />
              {t("paint.image.continuous")}
            </label>
          </div>

          <GalleryGrid
            items={visible} minWidth={180} gap={12} footerHeight={45}
            className={`gallery-popup-grid ${dragOver ? "drag-over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files?.[0]); }}
            renderItem={(item) => (
              <div key={item.id} className="gallery-pop-card">
                <button
                  className="gallery-item"
                  disabled={busy}
                  title={item.pages.length > 1 ? t("gallery.choosePage") : t("gallery.insertHint")}
                  onClick={() => open(item)}
                >
                  <div className="gallery-thumb">
                    <LazyThumbnail item={item} />
                    <ScoreBadge score={item.score} />
                    {item.pages.length > 1 && (
                      <span className="gallery-pagecount">{item.pages.length} ⤵</span>
                    )}
                    <span className={`gallery-uploader uploader-${item.uploader}`}>
                      {item.uploader === "admin" ? t("gallery.byAdmin") : t("gallery.byUser")}
                    </span>
                  </div>
                  <div className="gallery-item-meta">
                    <strong>{item.title || t("gallery.untitled")}</strong>
                  </div>
                </button>
                {item.pages.length === 1 && (
                  <button
                    className="gallery-quick-plot"
                    disabled={busy || !online}
                    title={online ? t("gallery.quickPlot") : t("gallery.offline")}
                    onClick={() => quickPlot(item, 1)}
                  >
                    ⏵ {t("gallery.quickPlot")}
                  </button>
                )}
                <button
                  className="gallery-rerender"
                  disabled={busy || !item.original}
                  title={t("gallery.rerenderHint")}
                  onClick={() => rerender(item)}
                >
                  {t("gallery.rerender")}
                </button>
              </div>
            )}
          />
          {visible.length === 0 && <p className="muted gallery-popup-empty">{t("gallery.empty")}</p>}
        </>
      )}
      {stlNew && (
        <StlEditor
          cal={cal}
          saving={stlSaving}
          initialStl={stlNew.buf}
          initialName={stlNew.filename}
          onClose={() => setStlNew(null)}
          onInsert={(template) => { onInsert(polylinesObject(template.lines)); setStlNew(null); onClose(); }}
          onSaveGallery={({ stl, filename, params, result }) => {
            setStlSaving(true);
            api.galleryCreateStl(stl, filename, params, resultToSvgLayers(result), filename.replace(/\.stl$/i, ""))
              .then(() => load())
              .then(() => { setStlNew(null); setMsg(t("stl.saved")); })
              .catch(fail)
              .finally(() => setStlSaving(false));
          }}
        />
      )}
    </Modal>
    {xoppFile && <XoppImportDialog file={xoppFile} onClose={() => setXoppFile(null)} onImported={load} />}
    </>
  );
}

/** Page chooser for a multi-page asset: one preview tile per page with insert
 * and (when online) quick-plot. */
function PagePicker({
  item,
  previews,
  online,
  busy,
  onBack,
  onInsert,
  onQuickPlot,
  t,
}: {
  item: GalleryItem;
  previews: Record<number, GalleryPreview>;
  online: boolean;
  busy: boolean;
  onBack: () => void;
  onInsert: (page: number) => void;
  onQuickPlot: (page: number) => void;
  t: (k: string, v?: Record<string, string>) => string;
}) {
  return (
    <>
      <div className="gallery-popup-controls">
        <button disabled={busy} onClick={onBack}>← {t("gallery.back")}</button>
        <span className="muted">{t("gallery.choosePage")}</span>
      </div>
      <div className="gallery-popup-grid">
        {item.pages.map((p) => (
          <div key={p.n} className="gallery-pop-card">
            <button
              className="gallery-item"
              disabled={busy}
              title={t("gallery.insertHint")}
              onClick={() => onInsert(p.n)}
            >
              <div className="gallery-thumb">
                {previews[p.n] ? <PolylinePreview data={previews[p.n]} /> : <span className="muted">…</span>}
              </div>
              <div className="gallery-item-meta">
                <strong>{t("gallery.page")} {p.n}</strong>
              </div>
            </button>
            <button
              className="gallery-quick-plot"
              disabled={busy || !online}
              title={online ? t("gallery.quickPlot") : t("gallery.offline")}
              onClick={() => onQuickPlot(p.n)}
            >
              ⏵ {t("gallery.quickPlot")}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
