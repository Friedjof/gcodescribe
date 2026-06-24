import { forwardRef, type ReactNode } from "react";
import type { Calibration, Page, SceneObject } from "../api";
import { IDENTITY, toMultiPath, type Pt } from "./geometry";

export type ViewBox = { x: number; y: number; w: number; h: number };
export type ViewRotation = 0 | 90 | 180 | 270;

const zValue = (obj: SceneObject, index: number) => obj.zOrder ?? index;

function objTransform(t: NonNullable<SceneObject["transform"]>) {
  const sx = t.scaleX ?? t.scale;
  const sy = t.scaleY ?? t.scale;
  return `translate(${t.x} ${t.y}) rotate(${(t.rotation * 180) / Math.PI}) scale(${sx},${sy})`;
}

function rotatePoint([x, y]: Pt, W: number, H: number, deg: ViewRotation): Pt {
  const cx = W / 2;
  const cy = H / 2;
  const dx = x - cx;
  const dy = y - cy;
  if (deg === 90) return [cx - dy, cy + dx];
  if (deg === 180) return [cx - dx, cy - dy];
  if (deg === 270) return [cx + dy, cy - dx];
  return [x, y];
}

function rotatedBounds(W: number, H: number, deg: ViewRotation): [number, number, number, number] {
  const pts = [[0, 0], [W, 0], [W, H], [0, H]].map((p) => rotatePoint(p as Pt, W, H, deg));
  return [
    Math.min(...pts.map((p) => p[0])),
    Math.min(...pts.map((p) => p[1])),
    Math.max(...pts.map((p) => p[0])),
    Math.max(...pts.map((p) => p[1])),
  ];
}

export function defaultSceneViewBox(cal: Calibration, viewRotation: ViewRotation = 0): ViewBox {
  const W = cal.plot_width;
  const H = cal.plot_height;
  const pad = Math.max(W, H) * 0.04 + 4;
  const [x0, y0, x1, y1] = rotatedBounds(W, H, viewRotation);
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}

type SceneViewProps = {
  cal: Calibration;
  page: Pick<Page, "objects" | "grid">;
  viewBox?: ViewBox;
  viewRotation?: ViewRotation;
  showGrid?: boolean;
  className?: string;
  children?: ReactNode;
};

const SceneView = forwardRef<SVGSVGElement, SceneViewProps>(function SceneView({
  cal,
  page,
  viewBox = defaultSceneViewBox(cal),
  viewRotation = 0,
  showGrid = true,
  className,
  children,
}, ref) {
  const W = cal.plot_width;
  const H = cal.plot_height;
  const step = page.grid?.step ?? 10;
  const major = step * 5;
  const S = Math.max(W, H);
  const STROKE = S * 0.0045;
  const canvasRotationTransform = `rotate(${viewRotation} ${W / 2} ${H / 2})`;
  const gridId = `scene-grid-${Math.round(W)}-${Math.round(H)}-${step}`;
  const majorId = `${gridId}-major`;
  const objectsByZ = page.objects
    .map((obj, index) => ({ obj, index }))
    .sort((a, b) => zValue(a.obj, a.index) - zValue(b.obj, b.index))
    .map(({ obj }) => obj);

  return (
    <svg
      ref={ref}
      className={className}
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <pattern id={gridId} width={step} height={step} patternUnits="userSpaceOnUse">
          <path d={`M ${step} 0 L 0 0 L 0 ${step}`} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={0.25} />
        </pattern>
        <pattern id={majorId} width={major} height={major} patternUnits="userSpaceOnUse">
          <rect width={major} height={major} fill={`url(#${gridId})`} />
          <path d={`M ${major} 0 L 0 0 L 0 ${major}`} fill="none" stroke="rgba(255,255,255,0.13)" strokeWidth={0.4} />
        </pattern>
      </defs>

      <g transform={canvasRotationTransform}>
      <rect x={0} y={0} width={W} height={H} rx={1.5} fill="#101013" stroke="var(--accent)" strokeWidth={0.6} />
      {showGrid && <rect x={0} y={0} width={W} height={H} fill={`url(#${majorId})`} />}

      {objectsByZ.map((obj) => {
        const t = obj.transform ?? IDENTITY;
        const strokeScale = Math.max(t.scaleX ?? t.scale, t.scaleY ?? t.scale);
        return (
          <g key={obj.id} transform={objTransform(t)} opacity={obj.plotted ? 0.25 : 1} style={{ pointerEvents: "none" }}>
            <path
              d={toMultiPath((obj.cachedPolylines ?? []) as Pt[][])}
              fill="none"
              stroke={obj.plotted ? "var(--muted)" : "var(--busy)"}
              strokeWidth={STROKE / strokeScale}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        );
      })}

      {/* Obstacle no-go zones — converted from bed to local (editor) coordinates */}
      {(cal.obstacles ?? []).map((obs) => {
        const lx = obs.x - cal.origin_x;
        const lw = obs.w;
        const lh = obs.h;
        const ly = cal.flip_y
          ? cal.plot_height + cal.origin_y - obs.y - obs.h
          : obs.y - cal.origin_y;
        return (
          <rect
            key={obs.id}
            x={lx} y={ly} width={lw} height={lh}
            fill="rgba(255,59,48,0.13)"
            stroke="rgba(255,59,48,0.7)"
            strokeWidth={STROKE * 0.5}
            strokeDasharray={`${STROKE * 1.5} ${STROKE * 0.8}`}
            pointerEvents="none"
          />
        );
      })}

      {children}
      </g>
    </svg>
  );
});

export default SceneView;
