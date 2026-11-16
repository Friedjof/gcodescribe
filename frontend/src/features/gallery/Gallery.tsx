import { useEffect, useRef, useState } from "react";
import { api, type Calibration, type GalleryItem, type GalleryUploader } from "../../api";
import { useI18n } from "../../i18n";
import { polylinesObject } from "../games/lib/utils";
import { resultToSvgLayers } from "../stl/lib";
import GalleryAccessDialog from "./GalleryAccessDialog";
import GalleryDetail from "./GalleryDetail";
import StlEditor from "../stl/StlEditor";
import { useLiveRegistryState } from "../stream/lib/liveRegistry";
import PagedGrid from "../../components/paging/PagedGrid";
import LazyThumbnail from "./LazyThumbnail";
import XoppImportDialog from "./XoppImportDialog";
import { startImport } from "../../api/assetTasks";
import ScoreBadge from "../../components/ScoreBadge";
import Segmented from "../../components/Segmented";
import { useToasts } from "../../components/Toasts";

type UploaderFilter = "all" | GalleryUploader;
const MAX_UPLOAD_MB = 15;
const MAX_STL_MB = 20;
const ALLOWED = /\.(xopp|svg|png|jpe?g|pdf|odt|ods|odp|docx?|xlsx?|pptx?)$/i;
const ACCEPT =
  ".xopp,.svg,.png,.jpg,.jpeg,.pdf,.odt,.ods,.odp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.stl";

// Thumbnails are tiny polyline sets; cache them across tab switches.
// Keep the last list so re-opening the tab renders instantly while we refetch.
let listCache: GalleryItem[] = [];

export default function Gallery({ visible = true, initialItemId, onOpenPaint, onOpenAiDesigner, aiEnabled = false, desktop = false }: { visible?: boolean; initialItemId?: string; onOpenPaint: () => void; onOpenAiDesigner?: (itemId: string) => void; aiEnabled?: boolean; desktop?: boolean }) {
  const { t, lang } = useI18n();
  const toast = useToasts();
  const [items, setItems] = useState<GalleryItem[]>(listCache);
  const [showArchived, setShowArchived] = useState(false);
  const [uploaderFilter, setUploaderFilter] = useState<UploaderFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const globalLive = useLiveRegistryState();
  const [err, setErr] = useState<string | null>(null);
  const [stlNew, setStlNew] = useState<{ buf: ArrayBuffer; filename: string; cal: Calibration } | null>(null);
  const [xoppFile, setXoppFile] = useState<File | null>(null);
  const [stlSaving, setStlSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () =>
    api
      .galleryList(true)
      .then((list) => {
        listCache = list;
        setItems(list);
        setErr(null);

      })
      .catch((e) => setErr(String(e.message ?? e)));

  useEffect(() => { if (initialItemId) setSelectedId(initialItemId); }, [initialItemId]);
  useEffect(() => {
    if (!visible) return;
    refresh();
    const onReady = () => refresh();
    const id = setInterval(() => { if (!document.hidden) refresh(); }, 15000);
    window.addEventListener("gcs:asset-ready", onReady);
    return () => { clearInterval(id); window.removeEventListener("gcs:asset-ready", onReady); };
  }, [visible]);

  useEffect(() => {
    if (err) toast.error(err);
  }, [err, toast]);

  const resetFileInput = () => { if (fileRef.current) fileRef.current.value = ""; };

  // An STL doesn't upload directly — it opens the editor so the model can be
  // oriented and turned into SVG line layers, then saved (keeping the .stl).
  const openStl = (file: File) => {
    if (file.size > MAX_STL_MB * 1024 * 1024) {
      resetFileInput();
      return setErr(t("stl.errorTooLarge", { mb: String(MAX_STL_MB) }));
    }
    setErr(null);
    Promise.all([api.getCalibration(), file.arrayBuffer()])
      .then(([cal, buf]) => setStlNew({ buf, filename: file.name, cal }))
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(resetFileInput);
  };

  const upload = (file: File | undefined | null) => {
    if (!file || uploading) return;
    if (/\.stl$/i.test(file.name)) return openStl(file);
    if (!ALLOWED.test(file.name)) return setErr(t("upload.badType"));
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      return setErr(t("upload.tooLarge", { mb: String(MAX_UPLOAD_MB) }));
    }
    if (/\.xopp$/i.test(file.name)) { setXoppFile(file); resetFileInput(); return; }
    setUploading(true);
    setErr(null);
    startImport(file)
      .then(() => refresh())
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => {
        setUploading(false);
        resetFileInput();
      });
  };

  const q = query.trim().toLowerCase();
  const visibleItems = items.filter(
    (i) =>
      (showArchived || i.status === "active") &&
      (uploaderFilter === "all" || i.uploader === uploaderFilter) &&
      (!q || i.title.toLowerCase().includes(q) || i.filename.toLowerCase().includes(q))
  );
  const archivedCount = items.length - items.filter((i) => i.status === "active").length;
  // Resolve from the list so the open detail reflects refreshes (e.g. a new
  // title) and closes by itself once the item is deleted.
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const refreshSelected = () => {
    refresh();
  };

  return (
    <div className="gallery-page">
      <section className="card gallery-card">
        <div className="gallery-head">
          <div>
            <h2>{t("gallery.title")}</h2>
            <p className="muted">{t("gallery.hint")}</p>
          </div>
          <label className="gallery-archived-toggle">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            {t("gallery.showArchived")} ({archivedCount})
          </label>
        </div>

        <div className="gallery-controls">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            hidden
            onChange={(e) => upload(e.target.files?.[0])}
          />
          <button className="primary gallery-upload-btn" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? t("upload.uploading") : t("gallery.upload")}
          </button>
          {!desktop && (
            <button className="ghost gallery-access-btn" onClick={() => setAccessOpen(true)}>
              {t("gallery.uploadAccess")}
            </button>
          )}
          <Segmented<UploaderFilter>
            className="gallery-filter-seg"
            value={uploaderFilter}
            onChange={setUploaderFilter}
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

        {visibleItems.length === 0 && <p className="muted">{t("gallery.empty")}</p>}

        <PagedGrid label={t("gallery.title")} resetKey={`${query}/${showArchived}/${uploaderFilter}`} items={visibleItems} itemKey={(item) => item.id} renderItem={(item) =>
          <GalleryCard active={visible} item={item} lang={lang} onOpen={() => setSelectedId(item.id)} />
        } />

      </section>

      {selected && (
        <GalleryDetail
          item={selected}
          visible={visible}
          autoLive={globalLive.active}
          onClose={() => setSelectedId(null)}
          onChanged={refreshSelected}
          onOpenPaint={onOpenPaint}
          onOpenAiDesigner={onOpenAiDesigner}
          aiEnabled={aiEnabled}
          desktop={desktop}
        />
      )}
      {accessOpen && <GalleryAccessDialog onClose={() => setAccessOpen(false)} />}
      {xoppFile && <XoppImportDialog file={xoppFile} onClose={() => setXoppFile(null)} onImported={refresh} />}

      {stlNew && (
        <StlEditor
          cal={stlNew.cal}
          saving={stlSaving}
          initialStl={stlNew.buf}
          initialName={stlNew.filename}
          onClose={() => setStlNew(null)}
          onInsert={(template) => {
            api.createPage(template.name)
              .then((page) => api.savePage(page.id, { objects: [polylinesObject(template.lines)] }))
              .then(() => { setStlNew(null); onOpenPaint(); })
              .catch((e) => setErr(String(e.message ?? e)));
          }}
          onSaveGallery={({ stl, filename, params, result }) => {
            setStlSaving(true);
            api.galleryCreateStl(stl, filename, params, resultToSvgLayers(result), filename.replace(/\.stl$/i, ""))
              .then((item) => { setStlNew(null); toast.success(t("stl.saved")); refresh(); setSelectedId(item.id); })
              .catch((e) => setErr(String(e.message ?? e)))
              .finally(() => setStlSaving(false));
          }}
        />
      )}
    </div>
  );
}

function GalleryCard({
  item,
  active,
  lang,
  onOpen,
}: {
  item: GalleryItem;
  active: boolean;
  lang: string;
  onOpen: () => void;
}) {
  const { t } = useI18n();

  return (
    <button
      className={`gallery-item ${item.status === "archived" ? "archived" : ""}`}
      onClick={onOpen}
    >
      <div className="gallery-thumb">
        <LazyThumbnail item={item} active={active} />
        <ScoreBadge score={item.score} />
        <span className={`gallery-uploader uploader-${item.uploader}`}>
          {item.uploader === "admin" ? t("gallery.byAdmin") : t("gallery.byUser")}
        </span>
        {item.status === "archived" && (
          <span className="gallery-flag">{t("gallery.archived")}</span>
        )}
      </div>
      <div className="gallery-item-meta">
        <strong>{item.title || t("gallery.untitled")}</strong>
        <span className="muted">
          {new Date(item.created * 1000).toLocaleString(lang, {
            dateStyle: "short",
            timeStyle: "short",
          })}
        </span>
      </div>
    </button>
  );
}
