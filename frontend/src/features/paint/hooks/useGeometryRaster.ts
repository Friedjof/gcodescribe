import { DISPLAY_INK_PX } from "../../../lib/displayStroke";
import { useEffect, useState } from "react";
import { geometryTask } from "../lib/geometryTasks";
import { localBounds, type Pt } from "../lib/geometry";

const counts = new WeakMap<Pt[][], number>();
const renders = new WeakMap<Pt[][], { stroke: number; promise: Promise<Blob> }>();
export function rasterGeometry(lines: Pt[][]) {
  let count = counts.get(lines);
  if (count === undefined) { count = lines.reduce((sum, line) => sum + line.length, 0); counts.set(lines, count); }
  return count > 40000 && typeof OffscreenCanvas !== "undefined";
}
/** Avoid magnifying a capped bitmap when zooming into fine linework. */
export function rasterFitsDisplay(lines: Pt[][], stroke: number) {
  const bounds = localBounds(lines);
  const edge = Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]);
  return Number.isFinite(edge) && edge / Math.max(stroke, 0.000001) * DISPLAY_INK_PX <= 2048;
}
export function useGeometryRaster(lines: Pt[][], stroke: number, active: boolean) {
  const [raster, setRaster] = useState<{ url: string; lines: Pt[][]; stroke: number }>();
  const [failed, setFailed] = useState<Pt[][]>();
  // Retain the last complete image while its replacement is rendered.
  useEffect(() => () => { if (raster?.url) URL.revokeObjectURL(raster.url); }, [raster?.url]);
  useEffect(() => {
    if (!active || !rasterGeometry(lines)) return;
    let current = true;
    let render = renders.get(lines);
    if (!render || render.stroke !== stroke) {
      render = { stroke, promise: geometryTask<ArrayBuffer>({ kind: "raster", lines, stroke }).then((buffer) => new Blob([buffer], { type: "image/png" })) };
      renders.set(lines, render);
    }
    render.promise.then((blob) => {
      if (!current) return;
      const url = URL.createObjectURL(blob); setFailed(undefined); setRaster({ url, lines, stroke });
    }).catch(() => { renders.delete(lines); if (current) setFailed(lines); });
    return () => { current = false; };
  }, [lines, stroke, active]);
  const b = localBounds(lines);
  const image = raster?.lines === lines && active
    ? { url: raster.url, x: b[0] - raster.stroke, y: b[1] - raster.stroke, width: b[2] - b[0] + raster.stroke * 2, height: b[3] - b[1] + raster.stroke * 2 }
    : null;
  return { image, failed: failed === lines };
}
