import type { Calibration } from "../api";
import type { Pt } from "../paint/geometry";
import type { NoodlesSettings, TemplateSpec, Translator } from "./types";
import { centeredOrigin, clamp, formatMm, mulberry32, randomInt, usableArea } from "./utils";

// Inspired by cadin/generative-noodles: noodles grow as self-avoiding walks on a
// grid, then each path is drawn as a thick band. For the plotter we render the
// band as its outline — two parallel offset lines closed at the ends into one
// loop per noodle (decorative SVG ends/twists/joiners from the original are
// dropped as they are not single-stroke line art).

const CAP_SEGMENTS = 8; // points per rounded end cap
const CHAIKIN_ITERATIONS = 2; // corner rounding passes when rounded=true

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const scale = (a: Pt, s: number): Pt => [a[0] * s, a[1] * s];
const unit = (a: Pt): Pt => {
  const d = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / d, a[1] / d];
};

// Corner-cutting: rounds the path while keeping its two endpoints fixed.
function chaikin(pts: Pt[], iterations: number): Pt[] {
  let out = pts;
  for (let it = 0; it < iterations && out.length >= 3; it++) {
    const next: Pt[] = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const p = out[i];
      const q = out[i + 1];
      next.push([p[0] + (q[0] - p[0]) * 0.25, p[1] + (q[1] - p[1]) * 0.25]);
      next.push([p[0] + (q[0] - p[0]) * 0.75, p[1] + (q[1] - p[1]) * 0.75]);
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

// Offset a polyline sideways by h (signed) using miter joins at vertices.
function offsetSide(pts: Pt[], h: number): Pt[] {
  const n = pts.length;
  if (n < 2) return pts.slice();
  const segNor: Pt[] = [];
  for (let i = 0; i < n - 1; i++) {
    const d = unit(sub(pts[i + 1], pts[i]));
    segNor.push([-d[1], d[0]]);
  }
  const res: Pt[] = [];
  for (let i = 0; i < n; i++) {
    let nv: Pt;
    let m = 1;
    if (i === 0) nv = segNor[0];
    else if (i === n - 1) nv = segNor[n - 2];
    else {
      const a = segNor[i - 1];
      const b = segNor[i];
      const s: Pt = [a[0] + b[0], a[1] + b[1]];
      const len = Math.hypot(s[0], s[1]);
      if (len < 1e-9) {
        nv = b;
      } else {
        nv = [s[0] / len, s[1] / len];
        const cosHalf = nv[0] * b[0] + nv[1] * b[1];
        m = cosHalf > 0.2 ? 1 / cosHalf : 1; // miter length keeps constant width
      }
    }
    res.push([pts[i][0] + nv[0] * h * m, pts[i][1] + nv[1] * h * m]);
  }
  return res;
}

// Interior points of a semicircle cap (endpoints excluded — already on the band).
function capArc(center: Pt, nrm: Pt, outward: Pt, h: number, fromPlus: boolean): Pt[] {
  const sign = fromPlus ? 1 : -1;
  const pts: Pt[] = [];
  for (let k = 1; k < CAP_SEGMENTS; k++) {
    const th = (Math.PI * k) / CAP_SEGMENTS;
    const c = Math.cos(th);
    const s = Math.sin(th);
    pts.push([
      center[0] + h * (sign * c * nrm[0] + s * outward[0]),
      center[1] + h * (sign * c * nrm[1] + s * outward[1]),
    ]);
  }
  return pts;
}

// Turn a centerline into a closed band outline of half-width h.
function strokePolyline(centerline: Pt[], h: number, rounded: boolean): Pt[] {
  const line = rounded ? chaikin(centerline, CHAIKIN_ITERATIONS) : centerline;
  if (line.length < 2) {
    const c = line[0];
    const out: Pt[] = [];
    const segs = CAP_SEGMENTS * 2;
    for (let k = 0; k <= segs; k++) {
      const th = (2 * Math.PI * k) / segs;
      out.push([c[0] + h * Math.cos(th), c[1] + h * Math.sin(th)]);
    }
    return out;
  }
  const n = line.length;
  const left = offsetSide(line, h);
  const right = offsetSide(line, -h);
  const firstDir = unit(sub(line[1], line[0]));
  const lastDir = unit(sub(line[n - 1], line[n - 2]));
  const firstNor: Pt = [-firstDir[1], firstDir[0]];
  const lastNor: Pt = [-lastDir[1], lastDir[0]];

  const out: Pt[] = [...left];
  if (rounded) out.push(...capArc(line[n - 1], lastNor, lastDir, h, true));
  for (let i = n - 1; i >= 0; i--) out.push(right[i]);
  if (rounded) out.push(...capArc(line[0], firstNor, scale(firstDir, -1), h, false));
  out.push(out[0]); // close the loop
  return out;
}

export function buildNoodlesTemplate(
  cal: Calibration,
  t: Translator,
  opts: NoodlesSettings,
): TemplateSpec {
  const { width, height } = usableArea(cal);
  const [x0, y0] = centeredOrigin(width, height, cal, t);

  const columns = Math.max(3, Math.round(opts.columns));
  const cell = width / columns;
  const rows = Math.max(2, Math.round(height / cell));
  const thickness = clamp(opts.thickness, 0.2, 0.95);
  const fill = clamp(opts.fill, 0.1, 1);
  const h = (thickness * cell) / 2;

  const total = columns * rows;
  const maxLength = clamp(Math.round(opts.maxLength), 2, total);
  const rand = mulberry32(opts.seed);
  const occupied = new Array<boolean>(total).fill(false);
  const idx = (c: number, r: number) => r * columns + c;
  const center = (c: number, r: number): Pt => [x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell];

  const lines: Pt[][] = [];
  const target = Math.floor(total * fill);
  let occupiedCount = 0;
  let guard = 0;

  while (occupiedCount < target && guard++ < total + 5) {
    // Find an empty start cell, probing forward from a random index.
    const from = randomInt(rand, 0, total);
    let s = -1;
    for (let k = 0; k < total; k++) {
      const j = (from + k) % total;
      if (!occupied[j]) { s = j; break; }
    }
    if (s < 0) break;

    let c = s % columns;
    let r = Math.floor(s / columns);
    occupied[s] = true;
    occupiedCount++;
    const path: Array<[number, number]> = [[c, r]];
    const len = randomInt(rand, 2, maxLength + 1);

    while (path.length < len) {
      const neigh: Array<[number, number]> = [];
      if (c > 0 && !occupied[idx(c - 1, r)]) neigh.push([c - 1, r]);
      if (c < columns - 1 && !occupied[idx(c + 1, r)]) neigh.push([c + 1, r]);
      if (r > 0 && !occupied[idx(c, r - 1)]) neigh.push([c, r - 1]);
      if (r < rows - 1 && !occupied[idx(c, r + 1)]) neigh.push([c, r + 1]);
      if (neigh.length === 0) break;
      const pick = neigh[randomInt(rand, 0, neigh.length)];
      c = pick[0];
      r = pick[1];
      occupied[idx(c, r)] = true;
      occupiedCount++;
      path.push([c, r]);
    }

    if (path.length < 2) continue; // stuck single cell: stays occupied, not drawn
    lines.push(strokePolyline(path.map(([cc, rr]) => center(cc, rr)), h, opts.rounded));
  }

  return {
    name: t("game.noodles.name"),
    lines,
    width,
    height,
    details: [
      { label: t("games.param.gridDensity"), value: `${columns} × ${rows}` },
      { label: t("games.param.thickness"), value: `${Math.round(thickness * 100)}%` },
      { label: t("games.param.fill"), value: `${Math.round(fill * 100)}%` },
      { label: t("games.param.corners"), value: opts.rounded ? t("games.cornersRound") : t("games.cornersSquare") },
      { label: t("games.param.boardSize"), value: `${formatMm(width)} × ${formatMm(height)}` },
      { label: t("games.param.seed"), value: String(opts.seed) },
    ],
  };
}
