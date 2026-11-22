import type { Calibration } from "../../../api";

export type TurnEdge = "long" | "short";
export interface BacksideSettings {
  sourceId: string;
  edge: TurnEdge;
  opacity: number;
  enabled: boolean;
}
export interface PaperFrame { x: number; y: number; width: number; height: number }

/** Mirror about the physical paper, including asymmetric plot margins. */
export function backsideFrame(cal: Calibration): PaperFrame {
  const points = Object.values(cal.paper_corners ?? {}).filter(point =>
    point?.length === 2 && point.every(Number.isFinite));
  if (points.length >= 2) {
    const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
    const left = Math.min(...xs), right = Math.max(...xs);
    const bottom = Math.min(...ys), top = Math.max(...ys);
    if (right - left >= 1 && top - bottom >= 1) return {
      x: left - cal.origin_x,
      y: cal.flip_y ? cal.plot_height + cal.origin_y - top : bottom - cal.origin_y,
      width: right - left, height: top - bottom,
    };
  }
  return { x: 0, y: 0, width: cal.plot_width, height: cal.plot_height };
}

export function backsideFlip(cal: Calibration, edge: TurnEdge) {
  const frame = backsideFrame(cal);
  const xy = (point: [number, number]) => [point[0] - cal.origin_x,
    cal.flip_y ? cal.plot_height + cal.origin_y - point[1] : point[1] - cal.origin_y] as [number, number];
  const keys = ["tl", "tr", "br", "bl"];
  const complete = keys.every(key => cal.paper_corners?.[key]?.length === 2
    && cal.paper_corners[key].every(Number.isFinite));
  const paper = complete ? keys.map(key => xy(cal.paper_corners[key])) : [
    [frame.x, frame.y], [frame.x + frame.width, frame.y],
    [frame.x + frame.width, frame.y + frame.height], [frame.x, frame.y + frame.height],
  ] as [number, number][];
  const [tl, tr, br, bl] = paper;
  const length = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const width = (length(tl, tr) + length(bl, br)) / 2;
  const height = (length(tl, bl) + length(tr, br)) / 2;
  const verticalHinge = edge === "long" ? height >= width : height < width;
  // Midpoints define the paper's fold axis, including rotated calibrated sheets.
  const from = verticalHinge ? [(bl[0] + br[0]) / 2, (bl[1] + br[1]) / 2]
    : [(tl[0] + bl[0]) / 2, (tl[1] + bl[1]) / 2];
  const to = verticalHinge ? [(tl[0] + tr[0]) / 2, (tl[1] + tr[1]) / 2]
    : [(tr[0] + br[0]) / 2, (tr[1] + br[1]) / 2];
  const d = length(from, to);
  const ux = d > 0 ? (to[0] - from[0]) / d : verticalHinge ? 0 : 1;
  const uy = d > 0 ? (to[1] - from[1]) / d : verticalHinge ? 1 : 0;
  const cx = (from[0] + to[0]) / 2, cy = (from[1] + to[1]) / 2;
  const a = 2 * ux * ux - 1, b = 2 * ux * uy, e = 2 * uy * uy - 1;
  const matrix = [a, b, b, e, cx - a * cx - b * cy, cy - b * cx - e * cy]
    .map(value => Math.abs(value) < 1e-10 ? 0 : Math.round(value * 1e9) / 1e9);
  return { frame, paper, verticalHinge, transform: `matrix(${matrix.join(" ")})` };
}

export function readBacksideSettings(key: string): BacksideSettings | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!value || typeof value.sourceId !== "string" || !value.sourceId
      || !["long", "short"].includes(value.edge) || !Number.isFinite(value.opacity)) return null;
    return { sourceId: value.sourceId, edge: value.edge,
      opacity: Math.max(.05, Math.min(.4, value.opacity)), enabled: value.enabled !== false };
  } catch { return null; }
}
