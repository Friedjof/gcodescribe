import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  clampCanvasView,
  fitCanvasView,
  resizeCanvasView,
  zoomCanvasView,
  type CanvasView,
} from "../lib/canvasViewport";

/** View navigation is independent from drawing gestures and physical geometry. */
export function useCanvasViewport(
  bounds: readonly number[],
  size: { width: number; height: number },
  padding: number,
  rotation: number,
) {
  const [x0, y0, x1, y1] = bounds;
  const baseView = useMemo(
    () => fitCanvasView([x0, y0, x1, y1], size, padding),
    [x0, y0, x1, y1, size.width, size.height, padding],
  );
  const [view, setView] = useState<CanvasView>(baseView);
  const resetKey = JSON.stringify([x0, y0, x1, y1, padding, rotation]);
  const previous = useRef({ base: baseView, size, resetKey });
  useLayoutEffect(() => {
    const before = previous.current;
    setView((current) =>
      before.resetKey !== resetKey
        ? baseView
        : resizeCanvasView(current, before.base, baseView, before.size, size),
    );
    previous.current = { base: baseView, size, resetKey };
  }, [baseView, resetKey, size.width, size.height]);
  return {
    view,
    setView,
    baseView,
    zoom: baseView.w / view.w,
    zoomAt: (factor: number, anchor?: readonly number[]) =>
      setView((current) => zoomCanvasView(current, baseView, factor, anchor)),
    clampView: (next: CanvasView) => clampCanvasView(next, baseView),
    fitPage: () => setView(baseView),
  };
}
