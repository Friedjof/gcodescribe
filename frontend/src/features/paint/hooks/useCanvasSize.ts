import { useEffect, useRef, useState, type RefObject } from "react";

export function useCanvasSize(ref: RefObject<SVGSVGElement>, onResize?: () => void) {
  const [size, setSize] = useState({ width: 800, height: 600 });
  const callback = useRef(onResize); callback.current = onResize;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let previous: { width: number; height: number } | null = null;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || previous?.width === rect.width && previous.height === rect.height) return;
      // A pane resize changes pointer mapping; discard a gesture rather than commit a jump.
      if (previous) callback.current?.();
      previous = { width: rect.width, height: rect.height };
      setSize(current => current.width === rect.width && current.height === rect.height ? current : previous!);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element); window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [ref]);
  return size;
}