import type { Pt } from "./geometry";

// Transfer two packed buffers instead of cloning hundreds of thousands of arrays.
export function packLines(lines: Pt[][]) {
  const lengths = new Uint32Array(lines.length);
  const points = new Float64Array(lines.reduce((sum, line) => sum + line.length * 2, 0));
  let cursor = 0;
  lines.forEach((line, i) => { lengths[i] = line.length; for (const p of line) { points[cursor++] = p[0]; points[cursor++] = p[1]; } });
  return { lengths, points };
}
export function unpackLines(packed: ReturnType<typeof packLines>): Pt[][] {
  let cursor = 0;
  return Array.from(packed.lengths, (length) => Array.from({ length }, () => [packed.points[cursor++], packed.points[cursor++]] as Pt));
}
export function convexHull(lines: Pt[][]): Pt[] {
  const points = lines.flat().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (points.length < 3) return points;
  const cross = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = (pts: Pt[]) => {
    const result: Pt[] = [];
    for (const p of pts) { while (result.length >= 2 && cross(result[result.length - 2], result[result.length - 1], p) <= 0) result.pop(); result.push(p); }
    result.pop(); return result;
  };
  return [...half(points), ...half(points.slice().reverse())];
}
