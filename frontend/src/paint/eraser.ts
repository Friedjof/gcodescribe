import type { Pt } from "./geometry";

export type EraserBrush = "point" | "small" | "medium" | "large";
export const ERASER_BRUSH_FACTOR: Record<"small" | "medium" | "large", number> = {
  small: 0.02,
  medium: 0.04,
  large: 0.08,
};

export function pointSegmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

export function segmentsDistance(a0: Pt, a1: Pt, b0: Pt, b1: Pt): number {
  const cross = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const intersects =
    Math.sign(cross(a0, a1, b0)) !== Math.sign(cross(a0, a1, b1)) &&
    Math.sign(cross(b0, b1, a0)) !== Math.sign(cross(b0, b1, a1));
  if (intersects) return 0;
  return Math.min(
    pointSegmentDistance(a0, b0, b1),
    pointSegmentDistance(a1, b0, b1),
    pointSegmentDistance(b0, a0, a1),
    pointSegmentDistance(b1, a0, a1),
  );
}

export function lineNearPath(line: Pt[], path: Pt[], radius: number): boolean {
  for (let i = 1; i < line.length; i++) {
    for (let j = 1; j < path.length; j++) {
      if (segmentsDistance(line[i - 1], line[i], path[j - 1], path[j]) <= radius) return true;
    }
  }
  return false;
}

export function segmentNearPath(a: Pt, b: Pt, path: Pt[], radius: number): boolean {
  for (let i = 1; i < path.length; i++) {
    if (segmentsDistance(a, b, path[i - 1], path[i]) <= radius) return true;
  }
  return false;
}

export function eraseLinePieces(line: Pt[], path: Pt[], radius: number): Pt[][] {
  const out: Pt[][] = [];
  let current: Pt[] = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    if (segmentNearPath(a, b, path, radius)) {
      if (current.length >= 2) out.push(current);
      current = [b];
    } else {
      current.push(b);
    }
  }
  if (current.length >= 2) out.push(current);
  return out;
}

export function eraseWorldPolylines(
  lines: Pt[][],
  path: Pt[],
  mode: "free" | "line",
  radius: number,
): Pt[][] {
  if (mode === "line") return lines.filter((line) => !lineNearPath(line, path, radius));
  return lines.flatMap((line) => eraseLinePieces(line, path, radius));
}

export function samePolylines(a: Pt[][], b: Pt[][]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (line, i) =>
        line.length === b[i].length &&
        line.every((pt, j) => pt[0] === b[i][j][0] && pt[1] === b[i][j][1]),
    )
  );
}
