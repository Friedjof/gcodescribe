import { objectWorldBounds, snapPt, snapToGuides, type GuideCandidate, type Bounds, type Pt, type Transform } from "./geometry";
import { screenVectorToRotatedLocal, snapRotation, worldPoint } from "./viewTransform";

/** Keep every visible corner inside the physical plot area, including mirrors. */
export function clampedTransform(t: Transform, local: Pt[][], width: number, height: number): Transform {
  if (!local.length) return t;
  const [x0, y0, x1, y1] = objectWorldBounds(local, t);
  if (x0 >= 0 && y0 >= 0 && x1 <= width && y1 <= height) return t;
  const sx = t.scaleX ?? t.scale, sy = t.scaleY ?? t.scale;
  const shrink = Math.min(x1 > x0 ? width / (x1 - x0) : 1, y1 > y0 ? height / (y1 - y0) : 1, 1);
  const next = shrink < 1 ? { ...t, scaleX: sx * shrink, scaleY: sy * shrink,
    scale: Math.max(Math.abs(sx * shrink), Math.abs(sy * shrink)) } : t;
  const [nx0, ny0, nx1, ny1] = objectWorldBounds(local, next);
  const dx = nx0 < 0 ? -nx0 : nx1 > width ? width - nx1 : 0;
  const dy = ny0 < 0 ? -ny0 : ny1 > height ? height - ny1 : 0;
  return { ...next, x: next.x + dx, y: next.y + dy };
}

export interface ResizeGesture {
  startTransform: Transform;
  startLocalBounds: Bounds;
  anchorLocal: Pt;
  handleLocal: Pt;
  anchorWorld: Pt;
}

/** Resize around the opposite handle, preserving mirrors and the chosen anchor. */
export function resizeTransform(gesture: ResizeGesture, pointer: Pt, keepAspect: boolean): Transform {
  const { startTransform: start, startLocalBounds: bounds, anchorLocal, handleLocal, anchorWorld } = gesture;
  const startSx = start.scaleX ?? start.scale, startSy = start.scaleY ?? start.scale;
  const delta = screenVectorToRotatedLocal([pointer[0] - anchorWorld[0], pointer[1] - anchorWorld[1]], start.rotation);
  const dx = handleLocal[0] - anchorLocal[0], dy = handleLocal[1] - anchorLocal[1];
  const movesX = Math.abs(dx) > 0.0001, movesY = Math.abs(dy) > 0.0001;
  const minX = bounds[2] > bounds[0] ? 2 / (bounds[2] - bounds[0]) : Math.abs(startSx);
  const minY = bounds[3] > bounds[1] ? 2 / (bounds[3] - bounds[1]) : Math.abs(startSy);
  let sx = movesX ? Math.max(minX, Math.abs(delta[0] / dx)) * Math.sign(startSx || 1) : startSx;
  let sy = movesY ? Math.max(minY, Math.abs(delta[1] / dy)) * Math.sign(startSy || 1) : startSy;
  if (keepAspect) {
    const fx = Math.abs(sx / (startSx || 1)), fy = Math.abs(sy / (startSy || 1));
    const factor = movesX && movesY ? (Math.abs(fx - 1) >= Math.abs(fy - 1) ? fx : fy) : movesX ? fx : fy;
    const bounded = Math.max(factor, minX / Math.abs(startSx || 1), minY / Math.abs(startSy || 1));
    sx = startSx * bounded; sy = startSy * bounded;
  }
  const anchor = worldPoint(anchorLocal, { ...start, x: 0, y: 0, scaleX: sx, scaleY: sy });
  return { ...start, x: anchorWorld[0] - anchor[0], y: anchorWorld[1] - anchor[1],
    scaleX: sx, scaleY: sy, scale: Math.max(Math.abs(sx), Math.abs(sy)) };
}

export function gestureRotation(raw: number, shift: boolean, free: boolean): number {
  if (free) return raw;
  return shift ? Math.round(raw / (Math.PI / 12)) * (Math.PI / 12) : snapRotation(raw);
}

/** SVG uses uniform meet scaling; include letterboxing when sizing CSS-pixel controls. */
export function canvasUnitsPerPixel(view: { w: number; h: number }, size: { width: number; height: number }): number {
  return Math.max(view.w / Math.max(size.width, 1), view.h / Math.max(size.height, 1));
}

export interface MoveGesture {
  primaryId: string; startMouse: Pt; startBoundsAll: Bounds;
  startTs: Map<string, Transform>; vGuides: GuideCandidate[]; hGuides: GuideCandidate[];
}

export function moveSelection(gesture: MoveGesture, pointer: Pt, options: {
  width: number; height: number; gridStep: number; grid: boolean; free: boolean; tolerance: number;
}) {
  const { primaryId, startMouse, startBoundsAll: bounds, startTs, vGuides, hGuides } = gesture;
  const primary = startTs.get(primaryId);
  if (!primary) return null;
  let dx = pointer[0] - startMouse[0], dy = pointer[1] - startMouse[1];
  if (options.grid && !options.free) {
    const [x, y] = snapPt([primary.x + dx, primary.y + dy], options.gridStep, true);
    dx = x - primary.x; dy = y - primary.y;
  }
  const alignment = options.free ? { dx, dy, guides: [] } :
    snapToGuides(bounds, dx, dy, vGuides, hGuides, options.tolerance);
  const boundedX = Math.max(-bounds[0], Math.min(alignment.dx, options.width - bounds[2]));
  const boundedY = Math.max(-bounds[1], Math.min(alignment.dy, options.height - bounds[3]));
  const constrained = Math.abs(boundedX - alignment.dx) > .001 || Math.abs(boundedY - alignment.dy) > .001;
  const guides = constrained ? [] : alignment.guides;
  const snap: "free" | "guides" | "grid" = options.free ? "free" : guides.length ? "guides" : options.grid ? "grid" : "free";
  return { updates: new Map([...startTs].map(([id, transform]) =>
    [id, { ...transform, x: transform.x + boundedX, y: transform.y + boundedY }])), guides, constrained, snap };
}
