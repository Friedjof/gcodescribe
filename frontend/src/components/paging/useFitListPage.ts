import { useLayoutEffect, useRef, useState } from "react";
/** A bounded collection uses explicit pages, sized from its actual desktop pane. */
export function useFitListPage<T>(
  items: readonly T[],
  rowHeight: number,
  initialSize = 8,
) {
  const viewport = useRef<HTMLDivElement>(null),
    [size, setSize] = useState(initialSize),
    [requested, setPage] = useState(0);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => {
      if (element.clientHeight > 0)
        setSize(Math.max(1, Math.floor(element.clientHeight / rowHeight)));
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [rowHeight]);
  const pages = Math.max(1, Math.ceil(items.length / size)),
    page = Math.min(requested, pages - 1);
  return {
    viewport,
    page,
    pages,
    setPage,
    size,
    items: items.slice(page * size, (page + 1) * size),
  };
}
