// Plottable dimension annotations for an STL drawing. Everything is returned as
// polylines (uppercase stroke text via the games lettering) so it becomes part
// of the SVG output, never just a preview overlay.
//
// Placement is dynamic: each dimension is pushed fully *outside* the projected
// bounding box along the edge's outward normal (clearance computed from the box
// corners), so labels/arrows never sit on or behind the model regardless of how
// it is rotated.
import { gameTextWorld } from "../games/lettering";
import type { Pt } from "../paint/geometry";
import type { Pt2 } from "./render";

export interface DimLabels {
  w: string;
  h: string;
  d: string;
}

/** A measured, already-projected edge: endpoints + real length + label. */
export interface DimItem {
  a: Pt2;
  b: Pt2;
  len: number;
  label: string;
}

export const UNIT = "MM";

type Vec2 = [number, number];

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
const perp = (a: Vec2): Vec2 => [-a[1], a[0]];
function norm(a: Vec2): Vec2 { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; }

/** Stroke text centred at (cx,cy), rotated by `angle` (radians). */
function centeredText(text: string, c: Vec2, angle: number, height: number): Pt2[][] {
  const raw = gameTextWorld(text, [0, 0], height);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const line of raw) for (const [x, y] of line) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const ox = (minX + maxX) / 2, oy = (minY + maxY) / 2;
  const co = Math.cos(angle), si = Math.sin(angle);
  return raw.map((line) =>
    line.map(([x, y]) => {
      const lx = x - ox, ly = y - oy;
      return [c[0] + lx * co - ly * si, c[1] + lx * si + ly * co] as Pt2;
    }),
  );
}

function leftText(text: string, x: number, y: number, height: number): Pt2[][] {
  return gameTextWorld(text, [x, y] as Pt, height) as Pt2[][];
}

/** Two-stroke arrowhead with tip at `tip`, barbs trailing along `shaft` (unit). */
function arrowHead(tip: Vec2, shaft: Vec2, len: number): Pt2[][] {
  const a = 0.4, ca = Math.cos(a), sa = Math.sin(a);
  const r1: Vec2 = [shaft[0] * ca - shaft[1] * sa, shaft[0] * sa + shaft[1] * ca];
  const r2: Vec2 = [shaft[0] * ca + shaft[1] * sa, -shaft[0] * sa + shaft[1] * ca];
  return [
    [tip, add(tip, mul(r1, len))],
    [tip, add(tip, mul(r2, len))],
  ];
}

function uprightAngle(d: Vec2): number {
  let a = Math.atan2(d[1], d[0]);
  if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI;
  return a;
}

/** Outward normal of an edge + the distance needed to clear all box corners. */
function placement(it: DimItem, corners: Pt2[], center: Vec2) {
  const d = norm(sub(it.b, it.a));
  const mid: Vec2 = [(it.a[0] + it.b[0]) / 2, (it.a[1] + it.b[1]) / 2];
  let n = perp(d);
  if (dot(n, sub(mid, center)) < 0) n = [-n[0], -n[1]];
  // Push beyond the farthest box corner in the +n direction → always outside.
  let clear = 0;
  for (const c of corners) clear = Math.max(clear, dot(sub(c, mid), n));
  return { d, n, mid, clear };
}

/** Box style: one label per measured edge, placed clear of the model. */
export function boxLabels(items: DimItem[], corners: Pt2[], center: Vec2, h: number): Pt2[][] {
  const out: Pt2[][] = [];
  for (const it of items) {
    const { d, n, mid, clear } = placement(it, corners, center);
    const c = add(mid, mul(n, clear + h * 1.4));
    out.push(...centeredText(`${it.label} ${it.len.toFixed(1)} ${UNIT}`, c, uprightAngle(d), h));
  }
  return out;
}

/** Arrows style: offset dimension line + extension lines + arrowheads + label,
 *  all outside the projected silhouette. */
export function arrowDimensions(items: DimItem[], corners: Pt2[], center: Vec2, h: number): Pt2[][] {
  const out: Pt2[][] = [];
  for (const it of items) {
    const { d, n, clear } = placement(it, corners, center);
    const off = clear + h * 1.2;
    const A = add(it.a, mul(n, off));
    const B = add(it.b, mul(n, off));
    out.push([A, B]);                                   // dimension line
    out.push([it.a, add(it.a, mul(n, off + h * 0.4))]); // extension lines
    out.push([it.b, add(it.b, mul(n, off + h * 0.4))]);
    out.push(...arrowHead(A, d, h * 0.7));              // tips touch the ext. lines
    out.push(...arrowHead(B, mul(d, -1), h * 0.7));
    const mid: Vec2 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    out.push(...centeredText(`${it.label} ${it.len.toFixed(1)} ${UNIT}`, add(mid, mul(n, h)), uprightAngle(d), h));
  }
  return out;
}

/** A small stacked size table just to the right of the drawing. */
export function sizeTable(
  items: DimItem[], h: number, bounds: [number, number, number, number],
): Pt2[][] {
  const [, by0, bx1] = bounds;
  const x = bx1 + h * 1.4;
  const lineH = h * 1.6;
  const out: Pt2[][] = [];
  items.forEach((it, i) => {
    out.push(...leftText(`${it.label} ${it.len.toFixed(1)} ${UNIT}`, x, by0 + i * lineH, h));
  });
  return out;
}
