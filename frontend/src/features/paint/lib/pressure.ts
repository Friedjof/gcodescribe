import type { SceneObject } from "../../../api";
import type { Pt } from "./geometry";

export type SegmentPressures = (number[] | null)[];

/** Only complete, finite samples belong to a pressure-bearing stroke. */
export function validSegmentPressures(lines: Pt[][], value: unknown): SegmentPressures | undefined {
  if (!Array.isArray(value) || value.length !== lines.length) return undefined;
  const valid = value.every((samples, i) => samples === null ||
    (Array.isArray(samples) && samples.length === Math.max(0, lines[i].length - 1) &&
      samples.every((p) => typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1)));
  return valid ? value as SegmentPressures : undefined;
}

export function hasPressureSamples(value: SegmentPressures | undefined): boolean {
  return !!value?.some((line) => line !== null && line.length > 0);
}

export function isPressureObject(obj: SceneObject): boolean {
  return hasPressureSamples(validSegmentPressures(obj.data?.basePolylines ?? obj.cachedPolylines ?? [], obj.data?.baseSegmentPressures)) ||
    (obj.type === "image" && obj.data?.strokeOrder === "source" && !!obj.data?.sourcePage && !!obj.data?.galleryId);
}

/** Eight SVG paths keep the preview inexpensive even for thousands of samples.
 * Opacity indicates relative pressure; it is not a prediction of pen width. */
export function pressurePreviewPaths(lines: Pt[][], value: unknown): string[] | undefined {
  const pressure = validSegmentPressures(lines, value);
  if (!hasPressureSamples(pressure)) return undefined;
  const buckets = Array.from({ length: 8 }, () => [] as string[]);
  for (let i = 0; i < lines.length; i++) for (let j = 1; j < lines[i].length; j++) {
    const a = lines[i][j - 1], b = lines[i][j];
    const bucket = Math.round((pressure![i]?.[j - 1] ?? 0) * 7);
    buckets[bucket].push(`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`);
  }
  return buckets.map((segments) => segments.join(""));
}

/** Match surviving clipped segments to their original segment. A spatial
 * index avoids comparing every handwriting segment with every other segment.
 * Newly created geometry receives normal pressure rather than an invented value. */
export function remapSegmentPressures(source: Pt[][], pressures: SegmentPressures | undefined, target: Pt[][]): SegmentPressures | undefined {
  if (!pressures || !hasPressureSamples(pressures)) return undefined;
  if (source === target) return pressures;
  if (source.length === target.length && source.every((line, i) => line.length === target[i].length &&
    line.every(([x, y], j) => x === target[i][j][0] && y === target[i][j][1]))) return pressures;
  type Segment = { a: Pt; b: Pt; pressure: number | null };
  const segments: Segment[] = [];
  const cells = new Map<string, Segment[]>();
  const long: Segment[] = [];
  const cellSize = 2;
  const key = (x: number, y: number) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
  for (let i = 0; i < source.length; i++) for (let j = 1; j < source[i].length; j++) {
    const segment = { a: source[i][j - 1], b: source[i][j], pressure: pressures[i]?.[j - 1] ?? null };
    segments.push(segment);
    const steps = Math.ceil(Math.max(Math.abs(segment.b[0] - segment.a[0]), Math.abs(segment.b[1] - segment.a[1])) / cellSize * 2);
    if (steps > 2048) { long.push(segment); continue; }
    const seen = new Set<string>();
    for (let n = 0; n <= Math.max(1, steps); n++) {
      const t = n / Math.max(1, steps);
      const x = Math.floor((segment.a[0] + (segment.b[0] - segment.a[0]) * t) / cellSize);
      const y = Math.floor((segment.a[1] + (segment.b[1] - segment.a[1]) * t) / cellSize);
      // Include neighbours for points lying exactly on a tile boundary.
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const tile = `${x + dx},${y + dy}`;
        if (seen.has(tile)) continue;
        seen.add(tile);
        const bucket = cells.get(tile);
        if (bucket) bucket.push(segment); else cells.set(tile, [segment]);
      }
    }
  }
  if (!segments.length) return undefined;
  const error = (p: Pt, s: Segment) => {
    const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1];
    const length2 = dx * dx + dy * dy;
    const t = length2 ? Math.max(0, Math.min(1, ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dy) / length2)) : 0;
    return Math.hypot(p[0] - s.a[0] - dx * t, p[1] - s.a[1] - dy * t);
  };
  return target.map((line) => {
    let dynamic = false;
    const result: number[] = [];
    for (let j = 1; j < line.length; j++) {
      const a = line[j - 1], b = line[j];
      const candidates = [...(cells.get(key((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) ?? []), ...long];
      let match: Segment | undefined, best = 1e-5;
      for (const s of candidates) {
        const distance = error(a, s) + error(b, s);
        if (distance < best) { best = distance; match = s; }
      }
      if (match?.pressure != null) dynamic = true;
      result.push(match?.pressure ?? 0);
    }
    return dynamic ? result : null;
  });
}
