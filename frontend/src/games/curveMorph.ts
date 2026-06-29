import type { Calibration } from "../api";
import type { Pt } from "../paint/geometry";
import type { CurveMorphSettings, TemplateSpec, Translator } from "./types";
import { centeredOrigin, clamp, formatMm, mulberry32, usableArea } from "./utils";

// Sample points per cubic Bézier segment — two per closed loop, so a loop is
// drawn with 2×SEGMENT_SAMPLES points. Plenty for a smooth plot at this size.
const SEGMENT_SAMPLES = 40;

// One morph shape: two anchors (p0, p1) plus two control vectors (w, v). The
// closed loop is p0 →(p0+w, p1+v)→ p1 →(p1−v, p0−w)→ p0 (two cubic Béziers).
type Shape = { p0: Pt; p1: Pt; w: Pt; v: Pt };

const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const lerpPt = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function lerpShape(s1: Shape, s2: Shape, t: number): Shape {
  return {
    p0: lerpPt(s1.p0, s2.p0, t),
    p1: lerpPt(s1.p1, s2.p1, t),
    w: lerpPt(s1.w, s2.w, t),
    v: lerpPt(s1.v, s2.v, t),
  };
}

function cubicBezier(p0: Pt, c1: Pt, c2: Pt, p3: Pt, samples: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    pts.push([
      a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0],
      a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1],
    ]);
  }
  return pts;
}

// Sample a shape's closed loop into a single polyline (join point not doubled).
function sampleClosedLoop(s: Shape): Pt[] {
  const A = add(s.p0, s.w);
  const B = add(s.p1, s.v);
  const C = sub(s.p1, s.v);
  const D = sub(s.p0, s.w);
  const seg1 = cubicBezier(s.p0, A, B, s.p1, SEGMENT_SAMPLES);
  const seg2 = cubicBezier(s.p1, C, D, s.p0, SEGMENT_SAMPLES);
  return seg1.concat(seg2.slice(1));
}

export function buildCurveMorphTemplate(
  cal: Calibration,
  t: Translator,
  opts: CurveMorphSettings,
): TemplateSpec {
  const { width, height } = usableArea(cal);
  const [x0, y0] = centeredOrigin(width, height, cal, t);
  const rand = mulberry32(opts.seed);

  const curves = clamp(Math.round(opts.curves), 2, 40);
  const complexity = clamp(opts.complexity, 0, 1);
  const grid = Math.min(width, height) / 40;
  const snap = (v: number) => (opts.snapToGrid ? Math.round(v / grid) * grid : v);

  // A grid-snapped point inside a fractional sub-rectangle of the page.
  const anchor = (xMin: number, xMax: number, yMin: number, yMax: number): Pt => [
    snap(x0 + (xMin + rand() * (xMax - xMin)) * width),
    snap(y0 + (yMin + rand() * (yMax - yMin)) * height),
  ];

  // Control vector: random direction, length scaled by complexity (relative to
  // the page) so low complexity = gentle loops, high = wild ones.
  const ctrl = (): Pt => {
    const angle = rand() * Math.PI * 2;
    const len = (0.04 + complexity * 0.22) * Math.min(width, height);
    return [snap(Math.cos(angle) * len), snap(Math.sin(angle) * len)];
  };

  // Shape 1 on the left, shape 2 on the right — preserves the horizontal morph.
  const shape1: Shape = { p0: anchor(0.10, 0.35, 0.20, 0.80), p1: anchor(0.10, 0.35, 0.20, 0.80), w: ctrl(), v: ctrl() };
  const shape2: Shape = { p0: anchor(0.65, 0.90, 0.20, 0.80), p1: anchor(0.65, 0.90, 0.20, 0.80), w: ctrl(), v: ctrl() };

  const lines: Pt[][] = [];
  const steps = curves + 1;
  for (let i = 0; i <= steps; i++) {
    lines.push(sampleClosedLoop(lerpShape(shape1, shape2, i / steps)));
  }

  return {
    name: t("game.curveMorph.name"),
    lines,
    width,
    height,
    details: [
      { label: t("games.param.transitionalCurves"), value: String(curves) },
      { label: t("games.param.complexity"), value: `${Math.round(complexity * 100)}%` },
      { label: t("games.param.snapGrid"), value: opts.snapToGrid ? t("games.gridOn") : t("games.gridOff") },
      { label: t("games.param.seed"), value: String(opts.seed) },
      { label: t("games.param.boardSize"), value: `${formatMm(width)} × ${formatMm(height)}` },
    ],
  };
}
