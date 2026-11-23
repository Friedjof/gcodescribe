import { DISPLAY_INK_PX } from "../../../../lib/displayStroke";
import { memo, useMemo, useRef } from "react";
import type { SceneObject } from "../../../../api";
import { EMPTY_LINES, IDENTITY, localBounds, type Pt, type Transform } from "../../lib/geometry";
import { sourcePageFrame } from "../../lib/sourcePage";
import { useGeometryPath } from "../../hooks/useGeometryPath";
import { rasterFitsDisplay, rasterGeometry, useGeometryRaster } from "../../hooks/useGeometryRaster";
import { pressurePreviewPaths } from "../../lib/pressure";
function objTransform(t: Transform) {
  return `translate(${t.x} ${t.y}) rotate(${(t.rotation * 180) / Math.PI}) scale(${t.scaleX ?? t.scale},${t.scaleY ?? t.scale})`;
}
const ObjectView = memo(function ObjectView({ obj, selected, stroke, interactive, active }: {
  obj: SceneObject; selected: boolean; stroke: number; interactive: boolean; active: boolean;
}) {
  const t = obj.transform ?? IDENTITY;
  const scale = Math.max(Math.abs(t.scaleX ?? t.scale), Math.abs(t.scaleY ?? t.scale), 0.0001);
  const mask = obj.type === "mask-rect" || obj.data?.mask === "erase";
  const sourcePage = sourcePageFrame(obj);
  const pageBounds = sourcePage ? localBounds(sourcePage) : null;
  const lines = (obj.cachedPolylines ?? EMPTY_LINES) as Pt[][];
  const large = !mask && rasterGeometry(lines);
  // Keep the prepared bitmap throughout a gesture; only rebuild at rest.
  const rasterView = useRef({ lines, stroke: stroke / scale });
  if (!interactive || rasterView.current.lines !== lines) rasterView.current = { lines, stroke: stroke / scale };
  const rasterStroke = rasterView.current.stroke;
  const rasterEligible = large && rasterFitsDisplay(lines, rasterStroke);
  const pressurePaths = useMemo(() => obj.data?.pressureEnabled && !large && active && !interactive
    ? pressurePreviewPaths(lines, obj.data?.cachedSegmentPressures ?? obj.data?.baseSegmentPressures) : undefined,
  [obj.data?.pressureEnabled, obj.data?.cachedSegmentPressures, obj.data?.baseSegmentPressures, lines, large, active, interactive]);
  const { image: raster } = useGeometryRaster(lines, rasterStroke, rasterEligible && active);
  // Bitmap refreshes and navigation share the complete vector fallback.
  const d = useGeometryPath(lines, interactive, active);
  return <g transform={objTransform(t)} opacity={obj.plotted ? 0.25 : 1} pointerEvents="none">
    {selected && pageBounds &&
      <rect x={pageBounds[0]} y={pageBounds[1]}
        width={pageBounds[2] - pageBounds[0]} height={pageBounds[3] - pageBounds[1]}
        fill="none" stroke="var(--accent)" strokeWidth={stroke / scale}
        strokeDasharray={`${stroke * 4 / scale} ${stroke * 3 / scale}`} />}
    {pressurePaths ? pressurePaths.map((path, i) => path && <path key={i} d={path} fill="none"
      stroke={obj.plotted ? "var(--muted)" : "var(--ink)"} strokeOpacity={0.35 + i / 7 * 0.65}
      strokeWidth={DISPLAY_INK_PX} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />) : raster ? <image className="paint-raster" href={raster.url} x={raster.x} y={raster.y} width={raster.width} height={raster.height}
      style={{filter:"var(--raster-ink, brightness(0))"}} preserveAspectRatio="none"/> : <path d={d} fill={mask ? "var(--paper)" : "none"} fillOpacity={mask ? 0.92 : undefined}
      stroke={mask ? selected ? "var(--accent)" : "var(--paper-mask)" : obj.plotted ? "var(--muted)" : "var(--ink)"}
      strokeWidth={mask ? stroke / scale : DISPLAY_INK_PX} vectorEffect={mask ? undefined : "non-scaling-stroke"} strokeDasharray={mask ? `${stroke * 2 / scale} ${stroke / scale}` : undefined}
      strokeLinejoin="round" strokeLinecap="round" />}
  </g>;
});
export default memo(function ObjectsLayer({ objects, selectedIds, stroke, interactive = false, active = true }: {
  objects: SceneObject[]; selectedIds: string[]; stroke: number; interactive?: boolean; active?: boolean;
}) {
  const selected = new Set(selectedIds);
  return <>{objects.map((obj) => <ObjectView key={obj.id} obj={obj} selected={selected.has(obj.id)} stroke={stroke} interactive={interactive} active={active} />)}</>;
});
