// Screen-space hidden-line removal.
//
// Each candidate edge is projected to a 2D segment carrying per-endpoint depth.
// Every front-facing triangle that overlaps the segment in 2D and sits nearer
// to the camera clips away the hidden span. What remains is "visible"; the
// removed spans are returned separately so they can be drawn in a second pen
// colour instead of discarded. Runtime is O(edges × triangles), like the
// reference plotter-vision occluder.
import type { CameraBasis } from "./camera";
import { frontFacing, projectPoint } from "./camera";
import type { Candidate } from "./edges";
import type { ScreenPt, Triangle, Vec3 } from "./types";

export interface Line2D {
  /** Flat screen-space polyline points [[x,y], ...] — always 2 points here. */
  a: [number, number];
  b: [number, number];
}

export interface OcclusionResult {
  visible: Line2D[];
  hidden: Line2D[];
}

interface ProjTri {
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
  x2: number; y2: number; z2: number;
  minx: number; miny: number; maxx: number; maxy: number;
  minz: number;
  ccw: boolean;
}

function projectTriangles(triangles: Triangle[], basis: CameraBasis): ProjTri[] {
  const out: ProjTri[] = [];
  for (const t of triangles) {
    if (!frontFacing(t.n, t.a, basis)) continue; // solids: front faces occlude
    const pa = projectPoint(t.a, basis);
    const pb = projectPoint(t.b, basis);
    const pc = projectPoint(t.c, basis);
    if (!pa.front || !pb.front || !pc.front) continue; // skip if clipped by near plane
    const area = (pb.x - pa.x) * (pc.y - pa.y) - (pc.x - pa.x) * (pb.y - pa.y);
    out.push({
      x0: pa.x, y0: pa.y, z0: pa.depth,
      x1: pb.x, y1: pb.y, z1: pb.depth,
      x2: pc.x, y2: pc.y, z2: pc.depth,
      minx: Math.min(pa.x, pb.x, pc.x),
      miny: Math.min(pa.y, pb.y, pc.y),
      maxx: Math.max(pa.x, pb.x, pc.x),
      maxy: Math.max(pa.y, pb.y, pc.y),
      minz: Math.min(pa.depth, pb.depth, pc.depth),
      ccw: area > 0,
    });
  }
  return out;
}

/** Barycentric depth of (px,py) on a projected triangle, or null if degenerate. */
function triDepth(t: ProjTri, px: number, py: number): number | null {
  const det = (t.y1 - t.y2) * (t.x0 - t.x2) + (t.x2 - t.x1) * (t.y0 - t.y2);
  if (Math.abs(det) < 1e-12) return null;
  const u = ((t.y1 - t.y2) * (px - t.x2) + (t.x2 - t.x1) * (py - t.y2)) / det;
  const v = ((t.y2 - t.y0) * (px - t.x2) + (t.x0 - t.x2) * (py - t.y2)) / det;
  const w = 1 - u - v;
  return u * t.z0 + v * t.z1 + w * t.z2;
}

/** Clip the parametric segment A→B to the triangle's interior; [t0,t1] or null. */
function clipToTriangle(
  ax: number, ay: number, dx: number, dy: number, t: ProjTri,
): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const verts: [number, number][] = [[t.x0, t.y0], [t.x1, t.y1], [t.x2, t.y2]];
  for (let i = 0; i < 3; i++) {
    const [ex, ey] = verts[i];
    const [fx, fy] = verts[(i + 1) % 3];
    // Inward normal of edge E→F (depends on winding).
    let nx = -(fy - ey);
    let ny = fx - ex;
    if (!t.ccw) { nx = -nx; ny = -ny; }
    const c = nx * (ax - ex) + ny * (ay - ey);
    const m = nx * dx + ny * dy;
    if (Math.abs(m) < 1e-12) {
      if (c < 0) return null; // segment runs parallel and outside this edge
    } else {
      const tc = -c / m;
      if (m > 0) t0 = Math.max(t0, tc);
      else t1 = Math.min(t1, tc);
      if (t0 > t1) return null;
    }
  }
  return [t0, t1];
}

interface Interval { t0: number; t1: number }

/** Remove [o0,o1] from a sorted, disjoint visible-interval list. */
function subtract(vis: Interval[], o0: number, o1: number): Interval[] {
  if (o1 <= o0) return vis;
  const out: Interval[] = [];
  for (const iv of vis) {
    if (o1 <= iv.t0 || o0 >= iv.t1) { out.push(iv); continue; }
    if (o0 > iv.t0) out.push({ t0: iv.t0, t1: o0 });
    if (o1 < iv.t1) out.push({ t0: o1, t1: iv.t1 });
  }
  return out;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function emit(
  out: Line2D[], ax: number, ay: number, bx: number, by: number, t0: number, t1: number,
  minLen: number,
): void {
  if (t1 - t0 < 1e-6) return;
  const a: [number, number] = [lerp(ax, bx, t0), lerp(ay, by, t0)];
  const b: [number, number] = [lerp(ax, bx, t1), lerp(ay, by, t1)];
  // Drop sub-threshold fragments: corner slivers at silhouette-shared vertices,
  // unplottable stray marks.
  if (minLen > 0 && Math.hypot(b[0] - a[0], b[1] - a[1]) < minLen) return;
  out.push({ a, b });
}

export interface OccludeOptions {
  /** When false, every candidate edge is returned visible (plain wireframe). */
  removeHidden: boolean;
  /** Screen-space length below which an emitted fragment is discarded. */
  minLen?: number;
}

export function occlude(
  candidates: Candidate[], triangles: Triangle[], basis: CameraBasis, opts: OccludeOptions,
): OcclusionResult {
  const visible: Line2D[] = [];
  const hidden: Line2D[] = [];
  const minLen = opts.minLen ?? 0;

  if (!opts.removeHidden) {
    for (const c of candidates) {
      const pa = projectPoint(c.a, basis);
      const pb = projectPoint(c.b, basis);
      if (pa.front && pb.front) emit(visible, pa.x, pa.y, pb.x, pb.y, 0, 1, minLen);
    }
    return { visible, hidden };
  }

  const tris = projectTriangles(triangles, basis);
  // Depth-bias so a candidate edge isn't occluded by the very face it lies on.
  let zspan = 1;
  if (tris.length) {
    let lo = Infinity, hi = -Infinity;
    for (const t of tris) { lo = Math.min(lo, t.minz); hi = Math.max(hi, t.z0, t.z1, t.z2); }
    zspan = Math.max(hi - lo, 1e-6);
  }
  const eps = zspan * 1e-4;

  for (const c of candidates) {
    const pa = projectPoint(c.a, basis);
    const pb = projectPoint(c.b, basis);
    if (!pa.front || !pb.front) continue;
    const ax = pa.x, ay = pa.y, bx = pb.x, by = pb.y;
    const dx = bx - ax, dy = by - ay;
    const segMinX = Math.min(ax, bx), segMaxX = Math.max(ax, bx);
    const segMinY = Math.min(ay, by), segMaxY = Math.max(ay, by);

    let vis: Interval[] = [{ t0: 0, t1: 1 }];
    for (const t of tris) {
      if (t.maxx < segMinX || t.minx > segMaxX || t.maxy < segMinY || t.miny > segMaxY) continue;
      // Quick depth reject: triangle entirely behind both endpoints.
      if (t.minz > Math.max(pa.depth, pb.depth) + eps) continue;
      const span = clipToTriangle(ax, ay, dx, dy, t);
      if (!span) continue;
      const [s0, s1] = span;
      if (s1 - s0 < 1e-7) continue;
      // Depths at the in-triangle endpoints; both segment and triangle depth are
      // linear in the parameter, so g(t)=segDepth-triDepth is linear too.
      const px0 = ax + dx * s0, py0 = ay + dy * s0;
      const px1 = ax + dx * s1, py1 = ay + dy * s1;
      const td0 = triDepth(t, px0, py0);
      const td1 = triDepth(t, px1, py1);
      if (td0 === null || td1 === null) continue;
      const sd0 = lerp(pa.depth, pb.depth, s0);
      const sd1 = lerp(pa.depth, pb.depth, s1);
      const g0 = sd0 - td0; // >0 ⇒ segment behind triangle ⇒ hidden
      const g1 = sd1 - td1;
      const o0 = g0 > eps;
      const o1 = g1 > eps;
      if (!o0 && !o1) continue; // segment in front throughout
      let occStart = s0, occEnd = s1;
      if (o0 !== o1) {
        // Linear crossing where g(t) = eps.
        const tc = s0 + ((eps - g0) / (g1 - g0)) * (s1 - s0);
        if (o0) { occStart = s0; occEnd = tc; } else { occStart = tc; occEnd = s1; }
      }
      vis = subtract(vis, occStart, occEnd);
      if (vis.length === 0) break;
    }

    for (const iv of vis) emit(visible, ax, ay, bx, by, iv.t0, iv.t1, minLen);
    // Hidden = the complement of the visible intervals over [0,1].
    let cursor = 0;
    for (const iv of vis) {
      emit(hidden, ax, ay, bx, by, cursor, iv.t0, minLen);
      cursor = iv.t1;
    }
    emit(hidden, ax, ay, bx, by, cursor, 1, minLen);
  }

  return { visible, hidden };
}

// Re-exported so the editor can project a single point for overlays.
export function project(p: Vec3, basis: CameraBasis): ScreenPt {
  return projectPoint(p, basis);
}
