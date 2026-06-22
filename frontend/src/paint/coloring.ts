import type { ColoringColor } from "../api";
import type { Pt } from "./geometry";

/** Pure geometry helpers for the coloring editor's segment-level brushing. */

export const MAX_SUBDIVISIONS = 400;

// Insert collinear points so no segment is longer than `step`. Geometry is
// unchanged — this only raises the resolution at which the brush can split a
// stroke into separately coloured parts.
export function densify(line: Pt[], step: number): Pt[] {
  if (line.length < 2 || step <= 0) return line.slice();
  const out: Pt[] = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.min(MAX_SUBDIVISIONS, Math.max(1, Math.ceil(d / step)));
    for (let k = 1; k <= n; k++) {
      const tt = k / n;
      out.push([a[0] + (b[0] - a[0]) * tt, a[1] + (b[1] - a[1]) * tt]);
    }
  }
  return out;
}

// Distance from point p to a single segment a–b.
export function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// Contiguous runs of one colour along a line, as sub-paths over `points`.
// `colors[i]` is the colour of the segment between points i and i+1, so a run
// of segments start..end-1 maps to the point slice start..end.
export function colourRuns(
  points: Pt[],
  colors: (ColoringColor | null)[],
): { color: ColoringColor; pts: Pt[] }[] {
  const runs: { color: ColoringColor; pts: Pt[] }[] = [];
  let cur: { color: ColoringColor; pts: Pt[] } | null = null;
  for (let i = 0; i < colors.length; i++) {
    const c = colors[i];
    if (c == null) { cur = null; continue; }
    if (cur && cur.color === c) cur.pts.push(points[i + 1]);
    else { cur = { color: c, pts: [points[i], points[i + 1]] }; runs.push(cur); }
  }
  return runs;
}

// A stable key for a line's geometry (rounded to 0.1mm), used to persist the
// coloring per page: identical geometry keeps its colour across editor re-opens,
// while any change in the manual designer yields a new key — so edited lines
// come back as unpainted. FNV-1a over the rounded coordinates.
export function lineKey(pts: Pt[]): string {
  let h = 2166136261;
  for (const [x, y] of pts) {
    h = Math.imul(h ^ (Math.round(x * 10) | 0), 16777619);
    h = Math.imul(h ^ (Math.round(y * 10) | 0), 16777619);
  }
  return `${pts.length}_${(h >>> 0).toString(36)}`;
}

// Sub-strokes of one colour, as point slices ready to become cachedPolylines.
export function strokesForColor(
  points: Pt[],
  colors: (ColoringColor | null)[],
  color: ColoringColor,
): Pt[][] {
  return colourRuns(points, colors)
    .filter((run) => run.color === color)
    .map((run) => run.pts);
}
