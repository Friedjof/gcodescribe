import { rulerTicks, type CanvasView } from "../../lib/canvasViewport";
import type { ViewRotation } from "../../lib/viewTransform";

/** Screen-aligned rulers stay legible while the page is rotated, zoomed or panned. */
export default function CanvasRulers({ view, pixel, rotation, width, height }: {
  view: CanvasView; pixel: number; rotation: ViewRotation; width: number; height: number;
}) {
  const bar = pixel * 20, font = pixel * 10;
  const horizontal = rulerTicks(view.x, view.w, pixel), vertical = rulerTicks(view.y, view.h, pixel);
  const format = (value: number) => Number(value.toFixed(2)).toString();
  const xLabel = (x: number) => rotation === 0 ? x : rotation === 90 ? (width + height) / 2 - x
    : rotation === 180 ? width - x : x - (width - height) / 2;
  const yLabel = (y: number) => rotation === 0 ? y : rotation === 90 ? y + (width - height) / 2
    : rotation === 180 ? height - y : (width + height) / 2 - y;
  return <g className="canvas-rulers" pointerEvents="none" aria-hidden="true" fontSize={font}>
    <rect x={view.x} y={view.y} width={view.w} height={bar} fill="var(--panel)" />
    <rect x={view.x} y={view.y} width={bar} height={view.h} fill="var(--panel)" />
    <path d={`M${view.x} ${view.y + bar}h${view.w}M${view.x + bar} ${view.y}v${view.h}`} stroke="var(--border)" strokeWidth={pixel} />
    {horizontal.map(x => x > view.x + bar && <g key={x}>
      <path d={`M${x} ${view.y + bar - 4 * pixel}v${4 * pixel}`} stroke="var(--muted)" strokeWidth={pixel} />
      <text x={x + 3 * pixel} y={view.y + 12 * pixel} fill="var(--muted)">{format(xLabel(x))}</text>
    </g>)}
    {vertical.map(y => y > view.y + bar && <g key={y}>
      <path d={`M${view.x + bar - 4 * pixel} ${y}h${4 * pixel}`} stroke="var(--muted)" strokeWidth={pixel} />
      <text x={view.x + 12 * pixel} y={y - 3 * pixel} transform={`rotate(-90 ${view.x + 12 * pixel} ${y - 3 * pixel})`} fill="var(--muted)">{format(yLabel(y))}</text>
    </g>)}
    <rect x={view.x} y={view.y} width={bar} height={bar} fill="var(--panel-2)" />
    <text x={view.x + 3 * pixel} y={view.y + 13 * pixel} fill="var(--muted)" fontSize={pixel * 8}>mm</text>
  </g>;
}
