import { useEffect, useRef, useState } from "react";
import { geometryTask } from "../lib/geometryTasks";
import { localBounds, type Pt } from "../lib/geometry";

const counts = new WeakMap<Pt[][], number>();
const renders = new WeakMap<Pt[][], { stroke: number; promise: Promise<Blob> }>();
export function rasterGeometry(lines: Pt[][]) {
  let count = counts.get(lines);
  if (count === undefined) { count = lines.reduce((sum, line) => sum + line.length, 0); counts.set(lines, count); }
  return count > 40000 && typeof OffscreenCanvas !== "undefined";
}
export function useGeometryRaster(lines: Pt[][], stroke: number, active: boolean) {
  const [raster, setRaster] = useState<{ url: string; lines: Pt[][]; stroke: number }>();
  const [failed, setFailed] = useState<Pt[][]>();
  const liveUrl = useRef<string>();
  useEffect(() => {
    if (!active || !rasterGeometry(lines)) return;
    let current = true;
    let url: string | undefined;
    let render = renders.get(lines);
    if (!render || render.stroke !== stroke) {
      render = { stroke, promise: geometryTask<ArrayBuffer>({ kind: "raster", lines, stroke }).then((buffer) => new Blob([buffer], { type: "image/png" })) };
      renders.set(lines, render);
    }
    render.promise.then((blob) => {
      if (!current) return;
      url = URL.createObjectURL(blob); liveUrl.current = url; setFailed(undefined); setRaster({ url, lines, stroke });
    }).catch(() => { renders.delete(lines); if (current) setFailed(lines); });
    return () => { current = false; if (url) { URL.revokeObjectURL(url); if (liveUrl.current === url) liveUrl.current = undefined; } };
  }, [lines, stroke, active]);
  const b = localBounds(lines);
  const image = raster?.lines === lines && raster.stroke === stroke && active && raster.url === liveUrl.current
    ? { url: raster.url, x: b[0] - stroke, y: b[1] - stroke, width: b[2] - b[0] + stroke * 2, height: b[3] - b[1] + stroke * 2 }
    : null;
  return { image, failed: failed === lines };
}
