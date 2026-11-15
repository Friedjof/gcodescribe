import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import type { GalleryItem } from "../../api";

/** Only mount nearby rows. Tab focus naturally scrolls the next buffered row into view. */
export default function GalleryGrid({ items, renderItem, minWidth = 190, gap = 10, footerHeight = 64, ...props }: {
  items: GalleryItem[]; renderItem: (item: GalleryItem) => ReactNode;
  minWidth?: number; gap?: number; footerHeight?: number;
} & HTMLAttributes<HTMLDivElement>) {
  const element = useRef<HTMLDivElement>(null);
  const frame = useRef<number>();
  const [view, setView] = useState({ width: 800, height: 500, top: 0 });
  useEffect(() => {
    const container = element.current!;
    const measure = () => {
      if (frame.current != null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        const style = getComputedStyle(container);
        const width = container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        if (width > 0) setView({ width, height: container.clientHeight || 500, top: container.scrollTop });
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container); container.addEventListener("scroll", measure, { passive: true }); measure();
    return () => { observer.disconnect(); container.removeEventListener("scroll", measure); if (frame.current != null) cancelAnimationFrame(frame.current); };
  }, []);
  const columns = Math.max(1, Math.floor((view.width + gap) / (minWidth + gap)));
  const rowHeight = Math.ceil((view.width - gap * (columns - 1)) / columns * .75 + footerHeight + gap);
  const rows = Math.ceil(items.length / columns);
  const first = Math.max(0, Math.min(rows - 1, Math.floor(view.top / rowHeight)) - 1);
  const end = Math.min(rows, first + Math.ceil(view.height / rowHeight) + 3);
  return <div {...props} ref={element} style={{ ...props.style, display: "block" }}>
    <div className="gallery-grid" style={{ height: rows * rowHeight, position: "relative", display: "block" }}>
      <div style={{ position: "absolute", top: first * rowHeight, width: "100%", display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridAutoRows: rowHeight - gap, gap }}>
        {items.slice(first * columns, end * columns).map((item) => <div className="gallery-grid-cell" key={item.id}>{renderItem(item)}</div>)}
      </div>
    </div>
  </div>;
}
