import { DISPLAY_INK_PX } from "../../../../lib/displayStroke";
import { memo, useMemo, useRef, useState } from "react";
import type { SceneObject } from "../../../../api";
import { EMPTY_LINES, IDENTITY, localBounds, type Pt, type Transform } from "../../lib/geometry";
import { sourcePageFrame } from "../../lib/sourcePage";
import { useGeometryPath } from "../../hooks/useGeometryPath";
import { rasterFitsDisplay, rasterGeometry, useGeometryRaster } from "../../hooks/useGeometryRaster";
import { pressurePreviewPaths } from "../../lib/pressure";
import { rasterStrokeWidth } from "../../lib/rasterPreview";
function objTransform(t: Transform) {
  return `translate(${t.x} ${t.y}) rotate(${(t.rotation * 180) / Math.PI}) scale(${t.scaleX ?? t.scale},${t.scaleY ?? t.scale})`;
}
const ObjectView = memo(function ObjectView({ obj, selected, stroke, interactive, active }: {
  obj: SceneObject; selected: boolean; stroke: number; interactive: boolean; active: boolean;
}) {
  const t = obj.transform ?? IDENTITY;
  const scale = Math.max(Math.abs(t.scaleX ?? t.scale), Math.abs(t.scaleY ?? t.scale), 0.0001);
  // WebKit re-strokes the complete path on every zoom with non-scaling-stroke.
  // Uniform transforms can preserve the same pixel width with ordinary strokes.
  const nonUniform = Math.abs(Math.abs(t.scaleX ?? t.scale) - Math.abs(t.scaleY ?? t.scale)) > 0.000001;
  const inkWidth = nonUniform ? DISPLAY_INK_PX : stroke / scale;
  const inkEffect = nonUniform ? "non-scaling-stroke" : undefined;
  const mask = obj.type === "mask-rect" || obj.data?.mask === "erase";
  const sourcePage = sourcePageFrame(obj);
  const pageBounds = sourcePage ? localBounds(sourcePage) : null;
  const lines = (obj.cachedPolylines ?? EMPTY_LINES) as Pt[][];
  const large = !mask && rasterGeometry(lines);
  const bounds = localBounds(lines);
  const rasterWidth = rasterStrokeWidth(Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]), stroke / scale);
  // Keep the prepared bitmap throughout a gesture; only rebuild at rest.
  const rasterView = useRef({ lines, stroke: rasterWidth });
  if (!interactive || rasterView.current.lines !== lines) rasterView.current = {
    lines,
    stroke: rasterStrokeWidth(Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]), stroke / scale,
      rasterView.current.lines === lines ? rasterView.current.stroke : undefined),
  };
  const rasterStroke = rasterView.current.stroke;
  const rasterEligible = large && (interactive || rasterFitsDisplay(lines, stroke / scale));
  const pressurePaths = useMemo(() => obj.data?.pressureEnabled && !large && active && !interactive
    ? pressurePreviewPaths(lines, obj.data?.cachedSegmentPressures ?? obj.data?.baseSegmentPressures) : undefined,
  [obj.data?.pressureEnabled, obj.data?.cachedSegmentPressures, obj.data?.baseSegmentPressures, lines, large, active, interactive]);
  // Keep a bounded bitmap warm even when the resting view needs vector detail.
  // Otherwise the next wheel gesture at high zoom falls back to expensive SVG.
  const { image } = useGeometryRaster(lines, rasterStroke, large && active);
  const [loadedImage, setLoadedImage] = useState<string>();
  const [failedImage, setFailedImage] = useState<string>();
  // An allocated blob URL is not evidence that WebKit has loaded the SVG image.
  // Keep the complete vectors until the replacement can actually be displayed.
  const raster = rasterEligible && image?.url === loadedImage && image?.url !== failedImage ? image : null;
  // Bitmap refreshes and navigation share the complete vector fallback.
  const d = useGeometryPath(lines, interactive, active);
  return <g transform={objTransform(t)} opacity={obj.plotted ? 0.25 : 1} pointerEvents="none">
    {selected && pageBounds &&
      <rect x={pageBounds[0]} y={pageBounds[1]}
        width={pageBounds[2] - pageBounds[0]} height={pageBounds[3] - pageBounds[1]}
        fill="none" stroke="var(--accent)" strokeWidth={stroke / scale}
        strokeDasharray={`${stroke * 4 / scale} ${stroke * 3 / scale}`} />}
    {/* Preserve parsed SVG paths and decoded bitmaps across wheel gestures. */}
    <g display={raster ? "none" : undefined}>
    {pressurePaths ? pressurePaths.map((path, i) => path && <path key={i} d={path} fill="none"
      stroke={obj.plotted ? "var(--muted)" : "var(--ink)"} strokeOpacity={0.35 + i / 7 * 0.65}
      strokeWidth={inkWidth} vectorEffect={inkEffect} strokeLinejoin="round" strokeLinecap="round" />) : <path d={d} fill={mask ? "var(--paper)" : "none"} fillOpacity={mask ? 0.92 : undefined}
      stroke={mask ? selected ? "var(--accent)" : "var(--paper-mask)" : obj.plotted ? "var(--muted)" : "var(--ink)"}
      strokeWidth={mask ? stroke / scale : inkWidth} vectorEffect={mask ? undefined : inkEffect} strokeDasharray={mask ? `${stroke * 2 / scale} ${stroke / scale}` : undefined}
      strokeLinejoin="round" strokeLinecap="round" />}
    </g>
    {image && <image className="paint-raster" display={rasterEligible && image.url !== failedImage ? undefined : "none"}
      href={image.url} x={image.x} y={image.y} width={image.width} height={image.height}
      onLoad={() => setLoadedImage(image.url)} onError={() => setFailedImage(image.url)}
      preserveAspectRatio="none"/>}
  </g>;
});
export default memo(function ObjectsLayer({ objects, selectedIds, stroke, interactive = false, active = true }: {
  objects: SceneObject[]; selectedIds: string[]; stroke: number; interactive?: boolean; active?: boolean;
}) {
  const selected = new Set(selectedIds);
  return <>{objects.map((obj) => <ObjectView key={obj.id} obj={obj} selected={selected.has(obj.id)} stroke={stroke} interactive={interactive} active={active} />)}</>;
});
