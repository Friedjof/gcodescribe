import { useEffect, useState, type RefObject } from "react";
import { canvasUnitsPerPixel } from "../lib/canvasTransforms";

export function useCanvasMetrics(ref: RefObject<SVGSVGElement>, view: { w: number; h: number }) {
  const [size, setSize] = useState({ width: 800, height: 600 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setSize(previous =>
        previous.width === rect.width && previous.height === rect.height ? previous : { width: rect.width, height: rect.height });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [ref]);
  return canvasUnitsPerPixel(view, size);
}
