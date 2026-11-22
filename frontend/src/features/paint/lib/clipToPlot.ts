import { transformPolylines, type Pt, type Transform } from "./geometry";
import type { SegmentPressures } from "./pressure";

export interface ClipResult { lines: Pt[][]; changed: boolean; pressures?: SegmentPressures; feeds?: number[][] }

/** Liang–Barsky clipping keeps crossings exactly on the boundary, without joining gaps. */
export function clipToPlot(lines: Pt[][], transform: Transform, width: number, height: number,
  pressures?: SegmentPressures, feeds?: number[][]): ClipResult {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) throw new Error("Invalid plot area");
  const world = transformPolylines(lines, transform);
  const result: ClipResult = { lines: [], changed: false,
    pressures: pressures ? [] : undefined, feeds: feeds ? [] : undefined };
  world.forEach((line, index) => {
    if (line.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) throw new Error("Invalid drawing coordinates");
    if (line.some(([x, y]) => x < 0 || y < 0 || x > width || y > height)) result.changed = true;
    let current: Pt[] = [], samples: number[] = [], speeds: number[] = [];
    const flush = () => {
      if (current.length > 1) {
        result.lines.push(current);
        result.pressures?.push(pressures?.[index] ? samples : null);
        result.feeds?.push(speeds);
      }
      current = []; samples = []; speeds = [];
    };
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i], dx = b[0] - a[0], dy = b[1] - a[1];
      let from = 0, to = 1, outside = false;
      for (const [p, q] of [[-dx, a[0]], [dx, width - a[0]], [-dy, a[1]], [dy, height - a[1]]]) {
        if (p === 0) { if (q < 0) outside = true; continue; }
        const t = q / p;
        if (p < 0) from = Math.max(from, t); else to = Math.min(to, t);
      }
      if (outside || from >= to || Math.hypot(dx, dy) < 1e-12) { flush(); continue; }
      const point = (t: number): Pt => [Math.max(0, Math.min(width, a[0] + dx * t)), Math.max(0, Math.min(height, a[1] + dy * t))];
      const start = point(from), end = point(to);
      if (current.length && Math.hypot(current[current.length - 1][0] - start[0], current[current.length - 1][1] - start[1]) > 1e-9) flush();
      const speed = (t: number) => {
        const first = feeds?.[index]?.[i - 1] ?? 1, last = feeds?.[index]?.[i] ?? first;
        return first + (last - first) * t;
      };
      if (!current.length) { current.push(start); speeds.push(speed(from)); }
      current.push(end); speeds.push(speed(to)); samples.push(pressures?.[index]?.[i - 1] ?? 0);
      if (to < 1) flush();
    }
    flush();
  });
  return result;
}
