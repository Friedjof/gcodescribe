import type { Calibration } from "../api/types/calibration";

/** Paper outline derived from the same calibration snapshot as the editor. */
export function paperRect(cal: Calibration): [number, number, number, number] | null {
  const points = Object.values(cal.paper_corners ?? {}).filter(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite));
  if (points.length < 2) return null;
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
  return w >= 1 && h >= 1 ? [x, y, w, h] : null;
}
