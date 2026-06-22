import type { SceneObject } from "../api";
import { IDENTITY, transformPolylines, type Pt } from "./geometry";

/** Client-side port of the backend's mask clipping (plotter/scene.py), so the
 * coloring editor sees exactly what gets plotted: lines under an "erase" mask
 * are cut away and the mask outline itself is never drawn. Masks are convex
 * polygons (rectangles / many-gon circles). */

const EPS = 1e-9;

export const isMaskObject = (obj: SceneObject) =>
  obj.type === "mask-rect" || obj.data?.mask === "erase";

export function maskPolygon(obj: SceneObject): Pt[] | null {
  const transform = obj.transform ?? IDENTITY;
  const raw = (obj.cachedPolylines ?? []).find((l) => l.length >= 4) as Pt[] | undefined;
  if (!raw) return null;
  let pts = transformPolylines([raw.map((p) => [p[0], p[1]] as Pt)], transform)[0];
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= EPS) {
    pts = pts.slice(0, -1);
  }
  return pts.length >= 3 ? pts : null;
}

function insideConvex(p: Pt, poly: Pt[]): boolean {
  const signs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (Math.abs(cross) > EPS) signs.push(cross);
  }
  return signs.length > 0 && (signs.every((s) => s >= 0) || signs.every((s) => s <= 0));
}

function segIntersectT(a: Pt, b: Pt, c: Pt, d: Pt): number | null {
  const rx = b[0] - a[0], ry = b[1] - a[1];
  const sx = d[0] - c[0], sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) <= EPS) return null;
  const qpx = c[0] - a[0], qpy = c[1] - a[1];
  const t = (qpx * sy - qpy * sx) / den;
  const u = (qpx * ry - qpy * rx) / den;
  if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS) return Math.max(0, Math.min(1, t));
  return null;
}

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function subtractFromSegment(a: Pt, b: Pt, poly: Pt[]): Pt[][] {
  const ts = new Set<number>([0, 1]);
  for (let i = 0; i < poly.length; i++) {
    const t = segIntersectT(a, b, poly[i], poly[(i + 1) % poly.length]);
    if (t !== null) ts.add(t);
  }
  const ordered = [...ts].sort((x, y) => x - y);
  const out: Pt[][] = [];
  for (let i = 0; i + 1 < ordered.length; i++) {
    const t0 = ordered[i], t1 = ordered[i + 1];
    if (t1 - t0 <= EPS) continue;
    if (insideConvex(lerp(a, b, (t0 + t1) / 2), poly)) continue;
    const p0 = lerp(a, b, t0), p1 = lerp(a, b, t1);
    if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > EPS) out.push([p0, p1]);
  }
  return out;
}

/** The visible pieces of `line` once `poly` is subtracted from it. */
export function subtractPolygon(line: Pt[], poly: Pt[]): Pt[][] {
  const pieces: Pt[][] = [];
  let current: Pt[] = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const visible = subtractFromSegment(line[i], line[i + 1], poly);
    for (const seg of visible) {
      if (current.length && Math.hypot(current[current.length - 1][0] - seg[0][0], current[current.length - 1][1] - seg[0][1]) <= EPS) {
        current.push(seg[1]);
      } else {
        if (current.length > 1) pieces.push(current);
        current = [...seg];
      }
    }
    if (!visible.length && current.length > 1) { pieces.push(current); current = []; }
  }
  if (current.length > 1) pieces.push(current);
  return pieces;
}
