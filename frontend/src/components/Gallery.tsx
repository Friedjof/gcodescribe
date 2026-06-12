import { useEffect, useState } from "react";
import { api, type GalleryItem, type GallerySvg } from "../api";
import { useI18n } from "../i18n";
import GalleryDetail from "./GalleryDetail";
import PolylinePreview from "./PolylinePreview";
import ScoreBadge from "./ScoreBadge";

// Thumbnails are tiny polyline sets; cache them across tab switches.
const thumbCache = new Map<string, GallerySvg>();

export default function Gallery({ onOpenPaint }: { onOpenPaint: () => void }) {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<GalleryItem | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () =>
    api
      .galleryList(true)
      .then((list) => {
        setItems(list);
        setErr(null);
      })
      .catch((e) => setErr(String(e.message ?? e)));

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15000); // pick up new event submissions
    return () => clearInterval(id);
  }, []);

  const visible = items.filter((i) => showArchived || i.status === "active");
  const archivedCount = items.length - items.filter((i) => i.status === "active").length;

  return (
    <div className="single-col">
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

        {err && <div className="banner err">{err}</div>}
        {visible.length === 0 && <p className="muted">{t("gallery.empty")}</p>}

        <div className="gallery-scroll">
          <div className="gallery-grid">
            {visible.map((item) => (
              <GalleryCard key={item.id} item={item} lang={lang} onOpen={() => setSelected(item)} />
            ))}
          </div>
        </div>
      </section>

      {selected && (
        <GalleryDetail
          item={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            refresh();
            setSelected(null);
          }}
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
  const [svg, setSvg] = useState<GallerySvg | null>(thumbCache.get(item.id) ?? null);

  useEffect(() => {
    if (svg) return;
    let alive = true;
    api
      .gallerySvg(item.id)
      .then((data) => {
        thumbCache.set(item.id, data);
        if (alive) setSvg(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [item.id, svg]);

  return (
    <button
      className={`gallery-item ${item.status === "archived" ? "archived" : ""}`}
      onClick={onOpen}
    >
      <div className="gallery-thumb">
        {svg ? <PolylinePreview data={svg} /> : <span className="muted">…</span>}
        <ScoreBadge score={item.score} />
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
