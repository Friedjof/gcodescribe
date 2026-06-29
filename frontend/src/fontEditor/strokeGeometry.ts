import type { Stroke, StrokeFontMetrics } from "../api";

// Pure coordinate helpers. The data model is in em units, y-up (baseline = 0,
// ascender positive, descender negative). SVG draws y-down, so we flip around a
// fixed `top` reference. Keeping these pure makes the transforms unit-testable
// and keeps the canvas component free of coordinate math.

export interface Pt {
  x: number;
  y: number;
}

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MARGIN_RATIO = 0.1;

/** Top of the visible em region (above the ascender), in em y-up units. */
export function metricTop(m: StrokeFontMetrics): number {
  return m.ascender + Math.round(m.em * MARGIN_RATIO);
}

/** Bottom of the visible em region (below the descender), in em y-up units. */
export function metricBottom(m: StrokeFontMetrics): number {
  return m.descender - Math.round(m.em * MARGIN_RATIO);
}

/** Initial viewBox covering the whole metric region in SVG (y-down) space. */
export function viewBoxFor(m: StrokeFontMetrics): ViewBox {
  return { x: 0, y: 0, w: m.em, h: metricTop(m) - metricBottom(m) };
}

/** em (y-up) → SVG view (y-down), flipped around `top`. */
export function emToView(p: Pt, top: number): Pt {
  return { x: p.x, y: top - p.y };
}

/** SVG view (y-down) → em (y-up). Inverse of {@link emToView}. */
export function viewToEm(p: Pt, top: number): Pt {
  return { x: p.x, y: top - p.y };
}

/** Build an SVG path for em-space points, converting each to view space. */
export function pointsToPath(points: Pt[], top: number): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const v = emToView(points[0], top);
    // Degenerate single-tap stroke — emit a hairline so it stays visible.
    return `M ${v.x.toFixed(2)} ${v.y.toFixed(2)} l 0.01 0`;
  }
  return points
    .map((p, i) => {
      const v = emToView(p, top);
      return `${i === 0 ? "M" : "L"} ${v.x.toFixed(2)} ${v.y.toFixed(2)}`;
    })
    .join(" ");
}

/** Shortest distance from point `p` to segment a–b. */
export function pointToSegmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Id of the stroke closest to `p` within `threshold` em, or null. */
export function nearestStrokeId(strokes: Stroke[], p: Pt, threshold: number): string | null {
  let best = Infinity;
  let bestId: string | null = null;
  for (const s of strokes) {
    const pts = s.points.length ? s.points : s.rawPoints;
    if (pts.length === 0) continue;
    let d = Infinity;
    if (pts.length === 1) {
      d = Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
    } else {
      for (let i = 1; i < pts.length; i += 1) {
        d = Math.min(d, pointToSegmentDistance(p, pts[i - 1], pts[i]));
      }
    }
    if (d < best) {
      best = d;
      bestId = s.id;
    }
  }
  return best <= threshold ? bestId : null;
}

/** Tight em-space bounds of a point set, or null when empty. */
export function boundsOf(points: Pt[]): { xMin: number; yMin: number; xMax: number; yMax: number } | null {
  if (points.length === 0) return null;
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (const p of points) {
    if (p.x < xMin) xMin = p.x;
    if (p.y < yMin) yMin = p.y;
    if (p.x > xMax) xMax = p.x;
    if (p.y > yMax) yMax = p.y;
  }
  return { xMin, yMin, xMax, yMax };
}
