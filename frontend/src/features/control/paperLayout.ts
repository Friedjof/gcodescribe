import type { Calibration } from "../../api";

export const PAPER_FORMATS = [
  { id: "A4", short: 210, long: 297 },
  { id: "A5", short: 148, long: 210 },
  { id: "A6", short: 105, long: 148 },
  { id: "A7", short: 74, long: 105 },
] as const;

export type PlotArea = { x: number; y: number; w: number; h: number };
export type PaperFormat = (typeof PAPER_FORMATS)[number];

export function plotArea(cal: Calibration): PlotArea {
  return { x: cal.origin_x, y: cal.origin_y, w: cal.plot_width, h: cal.plot_height };
}

export function plotAreaBase(cal: Calibration): PlotArea {
  if (cal.plot_area_base) return cal.plot_area_base;
  const margin = Math.max(0, cal.paper_margin ?? 0);
  return { x: cal.origin_x - margin, y: cal.origin_y - margin,
    w: cal.plot_width + 2 * margin, h: cal.plot_height + 2 * margin };
}

export function formatSize(format: PaperFormat, landscape: boolean) {
  return { w: landscape ? format.long : format.short, h: landscape ? format.short : format.long };
}

const ORDER = ["tl", "tr", "br", "bl"] as const;
export function paperCornerAngles(corners: Calibration["paper_corners"]): Record<string, number> | null {
  if (!ORDER.every((name) => corners[name]?.length === 2)) return null;
  const angles: Record<string, number> = {};
  for (let i = 0; i < ORDER.length; i++) {
    const [x, y] = corners[ORDER[i]];
    const [ax, ay] = corners[ORDER[(i + 3) % 4]];
    const [bx, by] = corners[ORDER[(i + 1) % 4]];
    const u: [number, number] = [ax - x, ay - y];
    const v: [number, number] = [bx - x, by - y];
    const lengths = Math.hypot(...u) * Math.hypot(...v);
    if (lengths < 1e-9) return null;
    const cosine = Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / lengths));
    angles[ORDER[i]] = Math.acos(cosine) * 180 / Math.PI;
  }
  return angles;
}
