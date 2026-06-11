import type { Pt } from "./geometry";

export type StrokeMode = "solid" | "dashed" | "dotted" | "double";
export type FillMode = "hatch" | "dashed-hatch" | "dotted-fill" | "crosshatch" | "chaos";

export interface StrokeStyle {
  mode: StrokeMode;
  dashLength: number;
  gapLength: number;
  dotSpacing: number;
  dotSize: number;
  doubleGap: number;
}

export interface FillStyle {
  enabled: boolean;
  mode: FillMode;
  angle: number;
  spacing: number;
  dashLength: number;
  gapLength: number;
  dotSpacing: number;
}

export interface VectorStyle {
  stroke: StrokeStyle;
  fill: FillStyle;
}

export const DEFAULT_VECTOR_STYLE: VectorStyle = {
  stroke: {
    mode: "solid",
    dashLength: 6,
    gapLength: 3,
    dotSpacing: 4,
    dotSize: 0.8,
    doubleGap: 1.5,
  },
  fill: {
    enabled: false,
    mode: "hatch",
    angle: 45,
    spacing: 4,
    dashLength: 5,
    gapLength: 3,
    dotSpacing: 4,
  },
};

export function normalizeStyle(style?: Partial<VectorStyle>): VectorStyle {
  return {
    stroke: { ...DEFAULT_VECTOR_STYLE.stroke, ...(style?.stroke ?? {}) },
    fill: { ...DEFAULT_VECTOR_STYLE.fill, ...(style?.fill ?? {}) },
  };
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function lineLength(line: Pt[]): number {
  let len = 0;
  for (let i = 1; i < line.length; i++) len += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  return len;
}

function pointAt(line: Pt[], dist: number): Pt {
  let left = dist;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (left <= seg) return lerp(a, b, seg ? left / seg : 0);
    left -= seg;
  }
  return line[line.length - 1];
}

function dashLine(line: Pt[], dash: number, gap: number): Pt[][] {
  const total = lineLength(line);
  const out: Pt[][] = [];
  const cycle = Math.max(0.1, dash + gap);
  for (let d = 0; d < total; d += cycle) {
    const end = Math.min(total, d + dash);
    if (end > d) out.push([pointAt(line, d), pointAt(line, end)]);
  }
  return out;
}

function dottedLine(line: Pt[], spacing: number, size: number): Pt[][] {
  const total = lineLength(line);
  const out: Pt[][] = [];
  const step = Math.max(0.2, spacing);
  for (let d = 0; d <= total; d += step) {
    const p = pointAt(line, d);
    out.push([[p[0] - size / 2, p[1]], [p[0] + size / 2, p[1]]]);
    out.push([[p[0], p[1] - size / 2], [p[0], p[1] + size / 2]]);
  }
  return out;
}

function applyStroke(lines: Pt[][], stroke: StrokeStyle): Pt[][] {
  if (stroke.mode === "dashed") return lines.flatMap((line) => dashLine(line, stroke.dashLength, stroke.gapLength));
  if (stroke.mode === "dotted") return lines.flatMap((line) => dottedLine(line, stroke.dotSpacing, stroke.dotSize));
  // Double-line offset needs robust joins; keep solid until the dedicated step.
  return lines;
}

function closedLine(lines: Pt[][]): Pt[] | null {
  const line = lines.find((l) => l.length > 2);
  if (!line) return null;
  const a = line[0], b = line[line.length - 1];
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= 0.5) return line;
  return null;
}

function rotate(p: Pt, angle: number): Pt {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
}

function unrotate(p: Pt, angle: number): Pt {
  return rotate(p, -angle);
}

function bounds(points: Pt[]): [number, number, number, number] {
  return points.reduce(
    (b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])],
    [Infinity, Infinity, -Infinity, -Infinity] as [number, number, number, number]
  );
}

function hatchFill(poly: Pt[], fill: FillStyle): Pt[][] {
  const angle = (fill.angle * Math.PI) / 180;
  const rp = poly.map((p) => rotate(p, angle));
  const [, y0, , y1] = bounds(rp);
  const out: Pt[][] = [];
  const step = Math.max(0.5, fill.spacing);
  for (let y = y0; y <= y1; y += step) {
    const xs: number[] = [];
    for (let i = 1; i < rp.length; i++) {
      const a = rp[i - 1], b = rp[i];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        const t = (y - a[1]) / (b[1] - a[1]);
        xs.push(a[0] + (b[0] - a[0]) * t);
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      out.push([unrotate([xs[i], y], angle), unrotate([xs[i + 1], y], angle)]);
    }
  }
  return fill.mode === "dashed-hatch" ? out.flatMap((line) => dashLine(line, fill.dashLength, fill.gapLength)) : out;
}

function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function dottedFill(poly: Pt[], fill: FillStyle): Pt[][] {
  const [x0, y0, x1, y1] = bounds(poly);
  const out: Pt[][] = [];
  const step = Math.max(0.5, fill.dotSpacing);
  const size = Math.min(step * 0.35, 1.2);
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      if (!pointInPoly([x, y], poly)) continue;
      out.push([[x - size / 2, y], [x + size / 2, y]]);
      out.push([[x, y - size / 2], [x, y + size / 2]]);
    }
  }
  return out;
}

function applyFill(base: Pt[][], fill: FillStyle): Pt[][] {
  if (!fill.enabled) return [];
  const poly = closedLine(base);
  if (!poly) return [];
  if (fill.mode === "dotted-fill") return dottedFill(poly, fill);
  return hatchFill(poly, fill);
}

export function buildStyledPolylines(base: Pt[][], style?: Partial<VectorStyle>): Pt[][] {
  const s = normalizeStyle(style);
  return [...applyStroke(base, s.stroke), ...applyFill(base, s.fill)];
}
