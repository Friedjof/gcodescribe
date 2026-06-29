// Orchestrates mesh → camera → edges → occlusion → continuous polylines.
//
// The visible (and optionally hidden) segments coming out of the occluder are
// many short, collinear pieces. We chain them back into long polylines so each
// pen colour plots as few continuous strokes as possible — exactly the
// "durchgehende Linie pro Farbe" requirement.
import type { Camera } from "./camera";
import { cameraBasis, projectPoint } from "./camera";
import { buildEdgeModel, selectEdges, type EdgeModel } from "./edges";
import { occlude, type Line2D } from "./hiddenLine";
import type { Mesh } from "./types";

export type Pt2 = [number, number];

export type HiddenMode = "remove" | "show" | "secondColor";

export interface RenderOptions {
  camera: Camera;
  /** Crease threshold in degrees; edges sharper than this are drawn. */
  featureAngleDeg: number;
  hidden: HiddenMode;
  /** Join each colour's polylines into ONE continuous line (default true). */
  continuous?: boolean;
}

export interface RenderLayer {
  role: "visible" | "hidden";
  polylines: Pt2[][];
}

export interface RenderResult {
  layers: RenderLayer[];
  /** Combined bounds of all layers: [x0, y0, x1, y1] (screen space). */
  bounds: [number, number, number, number] | null;
}

/** Build the (camera-independent) edge model once; reuse across orientations. */
export function prepareMesh(mesh: Mesh): EdgeModel {
  return buildEdgeModel(mesh);
}

function chain(segs: Line2D[], tol: number): Pt2[][] {
  if (segs.length === 0) return [];
  const inv = 1 / Math.max(tol, 1e-9);
  const ids = new Map<string, number>();
  const pts: Pt2[] = [];
  const idOf = (p: Pt2): number => {
    const key = `${Math.round(p[0] * inv)}|${Math.round(p[1] * inv)}`;
    let id = ids.get(key);
    if (id === undefined) { id = pts.length; ids.set(key, id); pts.push(p); }
    return id;
  };

  const segA: number[] = [];
  const segB: number[] = [];
  const adj = new Map<number, number[]>();
  const push = (id: number, s: number) => {
    const list = adj.get(id);
    if (list) list.push(s); else adj.set(id, [s]);
  };
  segs.forEach((s, i) => {
    const a = idOf(s.a);
    const b = idOf(s.b);
    if (a === b) return;
    segA.push(a); segB.push(b);
    push(a, i); push(b, i);
  });

  const used = new Array<boolean>(segA.length).fill(false);
  const nextFrom = (id: number): number => {
    for (const s of adj.get(id) ?? []) if (!used[s]) return s;
    return -1;
  };

  const out: Pt2[][] = [];
  for (let i = 0; i < segA.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const poly: number[] = [segA[i], segB[i]];
    // Extend forward from the tail.
    for (let s = nextFrom(poly[poly.length - 1]); s !== -1; s = nextFrom(poly[poly.length - 1])) {
      used[s] = true;
      const tail = poly[poly.length - 1];
      poly.push(segA[s] === tail ? segB[s] : segA[s]);
    }
    // Extend backward from the head.
    for (let s = nextFrom(poly[0]); s !== -1; s = nextFrom(poly[0])) {
      used[s] = true;
      const head = poly[0];
      poly.unshift(segA[s] === head ? segB[s] : segA[s]);
    }
    out.push(poly.map((id) => pts[id]));
  }
  return out;
}

/** Connect all polylines of one colour into a single continuous line by greedily
 *  appending the nearest remaining endpoint (flipping as needed). The straight
 *  gaps between parts become "bridge" segments — the price of one unbroken line. */
function joinPolylines(lines: Pt2[][]): Pt2[] {
  const parts = lines.filter((l) => l.length > 0);
  if (parts.length <= 1) return parts[0] ?? [];
  const remaining = parts.map((l) => l.slice());
  const result: Pt2[] = [...remaining.shift()!];
  const d2 = (a: Pt2, b: Pt2) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  while (remaining.length) {
    const tail = result[result.length - 1];
    let best = 0, flip = false, bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const l = remaining[i];
      const ds = d2(tail, l[0]);
      const de = d2(tail, l[l.length - 1]);
      if (ds < bestD) { bestD = ds; best = i; flip = false; }
      if (de < bestD) { bestD = de; best = i; flip = true; }
    }
    const next = remaining.splice(best, 1)[0];
    if (flip) next.reverse();
    result.push(...next);
  }
  return result;
}

function boundsOf(layers: RenderLayer[]): [number, number, number, number] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const layer of layers) {
    for (const line of layer.polylines) {
      for (const [x, y] of line) {
        if (x < x0) x0 = x; if (y < y0) y0 = y;
        if (x > x1) x1 = x; if (y > y1) y1 = y;
      }
    }
  }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
}

export function renderMesh(model: EdgeModel, opts: RenderOptions): RenderResult {
  const basis = cameraBasis(opts.camera);
  const featureAngle = (opts.featureAngleDeg * Math.PI) / 180;
  const candidates = selectEdges(model, basis, featureAngle);
  const removeHidden = opts.hidden !== "show";
  // Estimate the projected extent up front so occlusion can drop sub-pixel
  // corner slivers (relative to the model size, before fitting).
  let ext = 1;
  {
    let lo = Infinity, hi = -Infinity;
    for (const c of candidates) {
      for (const p of [projectPoint(c.a, basis), projectPoint(c.b, basis)]) {
        lo = Math.min(lo, p.x, p.y); hi = Math.max(hi, p.x, p.y);
      }
    }
    if (Number.isFinite(lo)) ext = Math.max(hi - lo, 1e-6);
  }
  const minLen = ext * 1.5e-3;
  const { visible, hidden } = occlude(candidates, model.triangles, basis, { removeHidden, minLen });

  // Chain tolerance relative to the projected extent (reused from above).
  const tol = ext * 1e-4;

  const layers: RenderLayer[] = [{ role: "visible", polylines: chain(visible, tol) }];
  if (opts.hidden === "secondColor" && hidden.length) {
    layers.push({ role: "hidden", polylines: chain(hidden, tol) });
  }

  // One continuous line per colour, so each pen colour is a single SVG path.
  if (opts.continuous !== false) {
    for (const layer of layers) {
      if (layer.polylines.length > 1) layer.polylines = [joinPolylines(layer.polylines)];
    }
  }
  return { layers, bounds: boundsOf(layers) };
}

/** Scale + translate every layer so the combined bounds fit width×height (mm),
 *  preserving aspect ratio and anchoring at the origin (y already points down). */
export interface FitResult {
  layers: RenderLayer[];
  width: number;
  height: number;
  /** Transform mapping unfitted projected points → fitted: (p - [x0,y0]) * scale. */
  scale: number;
  x0: number;
  y0: number;
}

export function fitLayers(result: RenderResult, width: number, height: number): FitResult {
  if (!result.bounds) return { layers: result.layers, width: 0, height: 0, scale: 1, x0: 0, y0: 0 };
  const [x0, y0, x1, y1] = result.bounds;
  const bw = Math.max(x1 - x0, 1e-6);
  const bh = Math.max(y1 - y0, 1e-6);
  const scale = Math.min(width / bw, height / bh);
  const map = (p: Pt2): Pt2 => [(p[0] - x0) * scale, (p[1] - y0) * scale];
  const layers = result.layers.map((l) => ({
    role: l.role,
    polylines: l.polylines.map((line) => line.map(map)),
  }));
  return { layers, width: bw * scale, height: bh * scale, scale, x0, y0 };
}
