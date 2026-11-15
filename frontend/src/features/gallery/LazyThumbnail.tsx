import { useEffect, useRef, useState } from "react";
import { req } from "../../api/client/req";
import type { GalleryItem, GallerySvg } from "../../api";
import PolylinePreview from "../../components/PolylinePreview";

const LIMIT = 32 * 1024 * 1024;
const cache = new Map<string, { data: GallerySvg; bytes: number }>();
const pending = new Map<string, Promise<GallerySvg>>();
let bytes = 0;
let running = 0;
const queue: (() => void)[] = [];
function put(key: string, data: GallerySvg) {
  const size = data.polylines.reduce((total, line) => total + line.length * 48 + 32, 128);
  bytes -= cache.get(key)?.bytes ?? 0;
  cache.delete(key); cache.set(key, { data, bytes: size }); bytes += size;
  while (bytes > LIMIT && cache.size) {
    const oldest = cache.keys().next().value!;
    bytes -= cache.get(oldest)!.bytes; cache.delete(oldest);
  }
  return data;
}
export function thumbnailKey(item: GalleryItem) {
  return `${item.id}:${item.render_revision ?? `${item.created}:${item.mode}:${item.detail}:${item.lines}`}`;
}
function read(key: string) {
  const entry = cache.get(key);
  if (entry) { cache.delete(key); cache.set(key, entry); }
  return entry?.data;
}
function load(item: GalleryItem, signal: AbortSignal): Promise<GallerySvg> {
  const key = thumbnailKey(item);
  const cached = read(key);
  if (cached) return Promise.resolve(cached);
  const existing = pending.get(key);
  if (existing) return existing.catch((error) => {
    if (error.name === "AbortError" && !signal.aborted) return load(item, signal);
    throw error;
  });
  const promise = new Promise<GallerySvg>((resolve, reject) => {
    const run = () => {
      if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); queue.shift()?.(); return; }
      running++;
      // Consumers may share a request; cancellation is local after it starts.
      req<GallerySvg>(`/api/gallery/${item.id}/thumbnail?revision=${encodeURIComponent(key)}`)
        .then((data) => resolve(put(key, data)), reject)
        .finally(() => { running--; queue.shift()?.(); });
    };
    if (running < 4) run(); else queue.push(run);
  });
  pending.set(key, promise);
  void promise.finally(() => pending.delete(key)).catch(() => {});
  return promise;
}

export default function LazyThumbnail({ item, active = true }: { item: GalleryItem; active?: boolean }) {
  const element = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [data, setData] = useState<GallerySvg>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const key = thumbnailKey(item);
  useEffect(() => {
    if (!active || !element.current) return;
    if (typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: "160px" });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [active]);
  useEffect(() => {
    setData(undefined); setFailed(false);
    if (!active || !near) return;
    const controller = new AbortController();
    load(item, controller.signal).then((next) => { if (!controller.signal.aborted) setData(next); }, (error) => {
      if (!controller.signal.aborted && error.name !== "AbortError") setFailed(true);
    });
    return () => controller.abort();
  }, [key, near, active, attempt]);
  return <div ref={element} className="gallery-thumbnail-view" aria-busy={active && near && !data && !failed}>
    {data && active && near ? <PolylinePreview data={data} /> : failed ? <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); setAttempt(attempt + 1); }} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setAttempt(attempt + 1); } }}>↻</span> : <span className="thumbnail-placeholder" />}
  </div>;
}
