import { useEffect, useState } from "react";
import { api, type GalleryItem, type GallerySvg, type GalleryUploader } from "../api";
import { useI18n } from "../i18n";
import GalleryDetail from "./GalleryDetail";
import PolylinePreview from "./PolylinePreview";
import ScoreBadge from "./ScoreBadge";
import Segmented from "./Segmented";

type UploaderFilter = "all" | GalleryUploader;

// Thumbnails are tiny polyline sets; cache them across tab switches.
const thumbCache = new Map<string, GallerySvg>();
// Keep the last list so re-opening the tab renders instantly while we refetch.
let listCache: GalleryItem[] = [];

export default function Gallery({ onOpenPaint }: { onOpenPaint: () => void }) {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<GalleryItem[]>(listCache);
  const [showArchived, setShowArchived] = useState(false);
  const [uploaderFilter, setUploaderFilter] = useState<UploaderFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Bump to re-render once batched thumbnails have landed in the cache.
  const [, setThumbTick] = useState(0);

  const refresh = () =>
    api
      .galleryList(true)
      .then((list) => {
        listCache = list;
        setItems(list);
        setErr(null);
        // One request for every thumbnail instead of one per card.
        const missing = list.some((i) => !thumbCache.has(i.id));
        if (missing) {
          api
            .galleryThumbnails()
            .then((thumbs) => {
              for (const [id, svg] of Object.entries(thumbs)) thumbCache.set(id, svg);
              setThumbTick((n) => n + 1);
            })
            .catch(() => {});
        }
      })
      .catch((e) => setErr(String(e.message ?? e)));

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15000); // pick up new event submissions
    return () => clearInterval(id);
  }, []);

  const q = query.trim().toLowerCase();
  const visible = items.filter(
    (i) =>
      (showArchived || i.status === "active") &&
      (uploaderFilter === "all" || i.uploader === uploaderFilter) &&
      (!q || i.title.toLowerCase().includes(q) || i.filename.toLowerCase().includes(q))
  );
  const archivedCount = items.length - items.filter((i) => i.status === "active").length;
  // Resolve from the list so the open detail reflects refreshes (e.g. a new
  // title) and closes by itself once the item is deleted.
  const selected = items.find((i) => i.id === selectedId) ?? null;

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

        {err && <div className="banner err">{err}</div>}
        {visible.length === 0 && <p className="muted">{t("gallery.empty")}</p>}

        <div className="gallery-scroll">
          <div className="gallery-grid">
            {visible.map((item) => (
              <GalleryCard key={item.id} item={item} lang={lang} onOpen={() => setSelectedId(item.id)} />
            ))}
          </div>
        </div>
      </section>

      {selected && (
        <GalleryDetail
          item={selected}
          onClose={() => setSelectedId(null)}
          onChanged={refresh}
          onOpenPaint={onOpenPaint}
        />
      )}
    </div>
  );
}

function GalleryCard({
  item,
  lang,
  onOpen,
}: {
  item: GalleryItem;
  lang: string;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const svg = thumbCache.get(item.id) ?? null;

  return (
    <button
      className={`gallery-item ${item.status === "archived" ? "archived" : ""}`}
      onClick={onOpen}
    >
      <div className="gallery-thumb">
        {svg ? <PolylinePreview data={svg} /> : <span className="muted">…</span>}
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
