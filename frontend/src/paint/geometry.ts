// Geometry helpers for the paint editor. All coordinates are plot-area mm
// (editor space: origin top-left, y down — the printer Y-flip happens later
// at G-code export). Objects store their polylines in LOCAL coordinates,
// centered on (0,0), plus a Transform placing them in the world.

export type Pt = [number, number];

export interface Transform {
  x: number; // world position of the object's center
  y: number;
  rotation: number; // radians
  scale: number;    // uniform fallback; prefer scaleX/scaleY when set
  scaleX?: number;
  scaleY?: number;
}

export const IDENTITY: Transform = { x: 0, y: 0, rotation: 0, scale: 1 };

// --- shape generators (world coordinates from two drag points) ---

export function lineWorld(a: Pt, b: Pt): Pt[] {
  return [a, b];
}

export function rectWorld(a: Pt, b: Pt): Pt[] {
  const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]);
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
}

export function ellipseWorld(a: Pt, b: Pt, seg = 72): Pt[] {
  const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
  const rx = Math.abs(a[0] - b[0]) / 2, ry = Math.abs(a[1] - b[1]) / 2;
  const pts: Pt[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * 2 * Math.PI;
    pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return pts;
}

export function semicircleWorld(a: Pt, b: Pt, seg = 48): Pt[] {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  const cx = (x0 + x1) / 2, rx = (x1 - x0) / 2, ry = y1 - y0, baseY = y1;
  const pts: Pt[] = [];
  // arc bulging up from the (lower) flat side, then close along the base
  for (let i = 0; i <= seg; i++) {
    const t = (Math.PI * i) / seg;
    pts.push([cx - rx * Math.cos(t), baseY - ry * Math.sin(t)]);
  }
  pts.push([x0, baseY]);
  return pts;
}

// --- freehand simplification (Ramer–Douglas–Peucker) ---

export function simplify(points: Pt[], eps: number): Pt[] {
  if (points.length < 3) return points;
  let maxD = 0, idx = 0;
  const [a, b] = [points[0], points[points.length - 1]];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDistance(points[i], a, b);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > eps) {
    const left = simplify(points.slice(0, idx + 1), eps);
    const right = simplify(points.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}

function perpDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}

// --- bounds / localization / transforms ---

export function bounds(pts: Pt[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x; if (y < y0) y0 = y;
    if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/** Recenter world polylines to local (centered) coords + the center point. */
export function localize(world: Pt[][]): { local: Pt[][]; cx: number; cy: number } {
  const all = world.flat();
  const [x0, y0, x1, y1] = bounds(all);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return { local: world.map((line) => line.map(([x, y]) => [x - cx, y - cy] as Pt)), cx, cy };
}

export function transformPolylines(local: Pt[][], t: Transform): Pt[][] {
  const cos = Math.cos(t.rotation), sin = Math.sin(t.rotation);
  const sx = t.scaleX ?? t.scale;
  const sy = t.scaleY ?? t.scale;
  return local.map((line) =>
    line.map(([x, y]) => {
      const rx = x * sx, ry = y * sy;
      return [t.x + rx * cos - ry * sin, t.y + rx * sin + ry * cos] as Pt;
    })
  );
}

export function objectWorldBounds(local: Pt[][], t: Transform): [number, number, number, number] {
  return bounds(transformPolylines(local, t).flat());
}

// --- snapping ---

export function snap(v: number, step: number, on: boolean): number {
  return on && step > 0 ? Math.round(v / step) * step : v;
}

export function snapPt(p: Pt, step: number, on: boolean): Pt {
  return [snap(p[0], step, on), snap(p[1], step, on)];
}

// --- alignment guides (smart snapping while moving) ---

export type Bounds = [number, number, number, number];

// A candidate alignment line. `pos` is the coordinate on the snapped axis
// (x for vertical guides, y for horizontal). `from`/`to` span the line on the
// other axis — the extent of the reference (object bounds or full canvas) — so
// the overlay can draw the guide only across the relevant region.
export interface GuideCandidate {
  pos: number;
  from: number;
  to: number;
}

// A guide that the moving selection actually snapped to, ready to render.
export interface Guide {
  axis: "x" | "y";
  pos: number;
  from: number;
  to: number;
}

// Build vertical (x) and horizontal (y) snap candidates from the canvas edges
// and a set of static object bounds. Each object contributes its left/center/
// right (vertical) and top/center/bottom (horizontal). The canvas contributes
// its two edges and the midline on each axis.
export function alignmentCandidates(
  staticBounds: Bounds[],
  W: number,
  H: number
): { vertical: GuideCandidate[]; horizontal: GuideCandidate[] } {
  const vertical: GuideCandidate[] = [
    { pos: 0, from: 0, to: H },
    { pos: W / 2, from: 0, to: H },
    { pos: W, from: 0, to: H },
  ];
  const horizontal: GuideCandidate[] = [
    { pos: 0, from: 0, to: W },
    { pos: H / 2, from: 0, to: W },
    { pos: H, from: 0, to: W },
  ];
  for (const [x0, y0, x1, y1] of staticBounds) {
    vertical.push(
      { pos: x0, from: y0, to: y1 },
      { pos: (x0 + x1) / 2, from: y0, to: y1 },
      { pos: x1, from: y0, to: y1 }
    );
    horizontal.push(
      { pos: y0, from: x0, to: x1 },
      { pos: (y0 + y1) / 2, from: x0, to: x1 },
      { pos: y1, from: x0, to: x1 }
    );
  }
  return { vertical, horizontal };
}

// Given the moving selection's bounds (already offset by the candidate dx/dy)
// and the candidates for one axis, find the best snap on that axis. Probes the
// selection's near edge, center and far edge against every candidate and keeps
// the smallest correction within `tol`. Returns the delta to apply plus the
// guide to draw, or null when nothing is close enough.
function snapAxis(
  lo: number,
  hi: number,
  candidates: GuideCandidate[],
  tol: number
): { delta: number; cand: GuideCandidate } | null {
  const probes = [lo, (lo + hi) / 2, hi];
  let best: { delta: number; cand: GuideCandidate } | null = null;
  for (const cand of candidates) {
    for (const probe of probes) {
      const delta = cand.pos - probe;
      if (Math.abs(delta) <= tol && (!best || Math.abs(delta) < Math.abs(best.delta))) {
        best = { delta, cand };
      }
    }
  }
  return best;
}

// Snap a candidate move (dx, dy) of a selection to alignment guides. `sel` is
// the selection's world bounds BEFORE the move; the probe positions are derived
// by adding the candidate delta. Returns corrected deltas and the guides that
// were hit (for rendering). X and Y snap independently.
export function snapToGuides(
  sel: Bounds,
  dx: number,
  dy: number,
  vertical: GuideCandidate[],
  horizontal: GuideCandidate[],
  tol: number
): { dx: number; dy: number; guides: Guide[] } {
  const guides: Guide[] = [];
  const vx = snapAxis(sel[0] + dx, sel[2] + dx, vertical, tol);
  if (vx) {
    dx += vx.delta;
    // Extend the guide along y to also span the moving selection, so the line
    // visibly connects the reference and the object that snapped to it.
    guides.push({
      axis: "x",
      pos: vx.cand.pos,
      from: Math.min(vx.cand.from, sel[1] + dy),
      to: Math.max(vx.cand.to, sel[3] + dy),
    });
  }
  const hy = snapAxis(sel[1] + dy, sel[3] + dy, horizontal, tol);
  if (hy) {
    dy += hy.delta;
    guides.push({
      axis: "y",
      pos: hy.cand.pos,
      from: Math.min(hy.cand.from, sel[0] + dx),
      to: Math.max(hy.cand.to, sel[2] + dx),
    });
  }
  return { dx, dy, guides };
}

// --- svg path helper ---

export function toPath(line: Pt[]): string {
  return line.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ");
}

// All polylines of an object joined into one path string. Rendering a single
// <path> per object (instead of one per line) collapses thousands of DOM nodes
// for image-heavy pages into one, which dominates canvas render/reconcile cost.
export function toMultiPath(lines: Pt[][]): string {
  return lines.map(toPath).join(" ");
}
