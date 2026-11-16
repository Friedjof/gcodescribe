import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import PaginationBar from "./PaginationBar";

/** A desktop collection that sizes pages to its pane instead of growing the document. */
export default function PagedGrid<T>({ items, renderItem, itemKey, label, resetKey, minWidth = 190, footerHeight = 64 }: {
  items: T[]; renderItem: (item: T) => ReactNode; itemKey: (item: T) => string;
  label: string; resetKey?: string; minWidth?: number; footerHeight?: number;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 500 });
  const [requested, setPage] = useState(0);
  const [previousKey, setPreviousKey] = useState(resetKey);
  if (previousKey !== resetKey) { setPreviousKey(resetKey); setPage(0); }
  useLayoutEffect(() => {
    const element = viewport.current!;
    const measure = () => { if (element.clientWidth > 0 && element.clientHeight > 0) setSize({ width: element.clientWidth, height: element.clientHeight }); };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);
  const columns = Math.max(1, Math.floor((size.width + 10) / (minWidth + 10)));
  const rowHeight = (size.width - (columns - 1) * 10) / columns * .75 + footerHeight;
  const rows = Math.max(1, Math.floor((size.height + 10) / (rowHeight + 10)));
  const capacity = columns * rows;
  const pages = Math.max(1, Math.ceil(items.length / capacity));
  const page = Math.min(requested, pages - 1);
  return <div className="paged-grid">
    <div className="paged-grid-viewport" ref={viewport}>
      <div className="paged-grid-items" style={{ gridTemplateColumns: `repeat(${columns},minmax(0,1fr))`, gridAutoRows: Math.min(rowHeight, size.height) }}>
        {items.slice(page * capacity, (page + 1) * capacity).map((item) => <div className="paged-grid-cell" key={itemKey(item)}>{renderItem(item)}</div>)}
      </div>
    </div>
    <PaginationBar page={page} pages={pages} onChange={setPage} label={label}/>
  </div>;
}
