import { useEffect, useRef, useState } from "react";
import { api, type PageMeta, type PageThumb } from "../../api";

/** Small line preview. Only visible rows request their current slide revision. */
export default function PageThumbnail({ page }: { page: Pick<PageMeta, "id" | "modified" | "thumb"> }) {
  const frame = useRef<HTMLSpanElement>(null);
  const [thumb, setThumb] = useState<PageThumb | null>(page.thumb ?? null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setThumb(page.thumb ?? null);
    setVisible(false);
    const node = frame.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "120px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [page.id, page.modified]);

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    api.pageThumbnail(page.id, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setThumb(result.thumb); })
      .catch(() => {});
    return () => controller.abort();
  }, [page.id, page.modified, visible]);

  return <span ref={frame} className="page-thumb project-page-thumb" aria-hidden="true">
    {thumb ? <svg viewBox={`-1 -1 ${thumb.w + 2} ${thumb.h + 2}`} preserveAspectRatio="xMidYMid meet">
      <path d={thumb.d} fill="none" stroke="currentColor"
        strokeWidth={Math.max(thumb.w, thumb.h) / 60 || 1} strokeLinecap="round" strokeLinejoin="round" />
    </svg> : <span className="page-thumb-empty">▦</span>}
  </span>;
}
