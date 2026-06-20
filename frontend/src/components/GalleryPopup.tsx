import { useEffect, useRef, useState } from "react";
import {
  api,
  type Calibration,
  type GalleryItem,
  type GalleryPreview,
  type GallerySvg,
  type GalleryUploader,
  type ProfileRef,
  type SceneObject,
} from "../api";
import { galleryPageObject } from "../paint/insertAsset";
import { useI18n } from "../i18n";
import Modal from "./Modal";
import Segmented from "./Segmented";
import PolylinePreview from "./PolylinePreview";
import ScoreBadge from "./ScoreBadge";

type UploaderFilter = "all" | GalleryUploader;
type RenderMode = "auto" | "vector" | "trace" | "edges" | "hatch" | "lines" | "dots" | "handwriting";

const MAX_UPLOAD_MB = 15;
// Admin popup accepts the full asset library: images/SVG plus PDF/Office.
const ALLOWED = /\.(svg|png|jpe?g|pdf|odt|ods|odp|docx?|xlsx?|pptx?)$/i;
const ACCEPT =
  ".svg,.png,.jpg,.jpeg,.pdf,.odt,.ods,.odp,.doc,.docx,.xls,.xlsx,.ppt,.pptx";

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
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, GallerySvg>>({});
  const [filter, setFilter] = useState<UploaderFilter>("all");
  const [query, setQuery] = useState("");
  // Render controls applied to the next upload (admin asset path), matching the
  // old Place import: mode + detail. `vector` ignores detail.
  const [mode, setMode] = useState<RenderMode>("auto");
  const [detail, setDetail] = useState(2);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // When a multi-page asset is opened, the grid is replaced by a page picker.
  const [picker, setPicker] = useState<GalleryItem | null>(null);
  const [pagePreviews, setPagePreviews] = useState<Record<number, GalleryPreview>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const online = !!status?.online;

  const fail = (e: any) => setErr(String(e.message ?? e));
  const loadThumbs = () => api.galleryThumbnails().then(setThumbs).catch(() => {});
  const load = () => api.galleryList(false).then(setItems).catch(fail);

  useEffect(() => {
    load();
    loadThumbs();
  }, []);

  const q = query.trim().toLowerCase();
  const visible = items.filter(
    (i) =>
      (filter === "all" || i.uploader === filter) &&
      (!q || i.title.toLowerCase().includes(q) || i.filename.toLowerCase().includes(q))
  );

  const upload = (file: File | undefined | null) => {
    if (!file || busy) return;
    if (!ALLOWED.test(file.name)) return setErr(t("upload.badType"));
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return setErr(t("upload.tooLarge", { mb: String(MAX_UPLOAD_MB) }));
    setBusy(true);
    setErr(null);
    api
      .galleryUpload(file, "", { mode, detail })
      .then(() => Promise.all([load(), loadThumbs()]))
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const rerender = (item: GalleryItem) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    api
      .galleryRender(item.id, mode, detail)
      .then(() => Promise.all([load(), loadThumbs()]))
      .then(() => setMsg(t("gallery.rendered")))
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
    const pv = preview ? Promise.resolve(preview) : api.galleryPreview(item.id, page);
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
    const pv = preview ? Promise.resolve(preview) : api.galleryPreview(item.id, page);
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
    <Modal
      title={picker ? picker.title || picker.filename : t("gallery.popupTitle")}
      onClose={onClose}
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
          </div>

          {msg && <div className="banner ok">{msg}</div>}
          {err && <div className="banner err">{err}</div>}

          <div
            className={`gallery-popup-grid ${dragOver ? "drag-over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files?.[0]); }}
          >
            {visible.map((item) => (
              <div key={item.id} className="gallery-pop-card">
                <button
                  className="gallery-item"
                  disabled={busy}
                  title={item.pages.length > 1 ? t("gallery.choosePage") : t("gallery.insertHint")}
                  onClick={() => open(item)}
                >
                  <div className="gallery-thumb">
                    {thumbs[item.id] ? <PolylinePreview data={thumbs[item.id]} /> : <span className="muted">…</span>}
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
            ))}
            {visible.length === 0 && <p className="muted gallery-popup-empty">{t("gallery.empty")}</p>}
          </div>
        </>
      )}
    </Modal>
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
