import type { Pt, Transform } from "./geometry";

export type ViewRotation = 0 | 90 | 180 | 270;
export type ResizeEdge = "tl" | "tc" | "tr" | "ml" | "mr" | "bl" | "bc" | "br";

const ROTATION_SNAP_DEG = 4;

export function rotatePoint([x, y]: Pt, W: number, H: number, deg: ViewRotation): Pt {
  const cx = W / 2;
  const cy = H / 2;
  const dx = x - cx;
  const dy = y - cy;
  if (deg === 90) return [cx - dy, cy + dx];
  if (deg === 180) return [cx - dx, cy - dy];
  if (deg === 270) return [cx + dy, cy - dx];
  return [x, y];
}

export function rotatedBounds(W: number, H: number, deg: ViewRotation): [number, number, number, number] {
  const pts = [[0, 0], [W, 0], [W, H], [0, H]].map((p) => rotatePoint(p as Pt, W, H, deg));
  return [
    Math.min(...pts.map((p) => p[0])),
    Math.min(...pts.map((p) => p[1])),
    Math.max(...pts.map((p) => p[0])),
    Math.max(...pts.map((p) => p[1])),
  ];
}

export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function signedDeg(rad: number): number {
  const deg = (rad * 180) / Math.PI;
  return ((deg + 180) % 360 + 360) % 360 - 180;
}

export function displayDeg(rad: number): number {
  const raw = (rad * 180) / Math.PI;
  const normalized = normalizeDeg(raw);
  return normalized === 0 && raw > 0.0001 ? 360 : normalized;
}

export function snapRotation(rad: number): number {
  const deg = normalizeDeg((rad * 180) / Math.PI);
  const snapTargets = [0, 90, 180, 270, 360];
  const target = snapTargets.find((a) => Math.abs(deg - a) <= ROTATION_SNAP_DEG);
  return target == null ? rad : (target * Math.PI) / 180;
}

export function worldPoint(local: Pt, t: Transform): Pt {
  const cos = Math.cos(t.rotation), sin = Math.sin(t.rotation);
  const sx = t.scaleX ?? t.scale;
  const sy = t.scaleY ?? t.scale;
  const x = local[0] * sx;
  const y = local[1] * sy;
  return [t.x + x * cos - y * sin, t.y + x * sin + y * cos];
}

export function screenVectorToRotatedLocal(delta: Pt, rotation: number): Pt {
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  return [delta[0] * cos + delta[1] * sin, -delta[0] * sin + delta[1] * cos];
}

export function resizeLocals(
  edge: ResizeEdge,
  b: [number, number, number, number],
): { anchor: Pt; handle: Pt } {
  const [x0, y0, x1, y1] = b;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const map: Record<ResizeEdge, { anchor: Pt; handle: Pt }> = {
    tl: { anchor: [x1, y1], handle: [x0, y0] },
    tc: { anchor: [cx, y1], handle: [cx, y0] },
    tr: { anchor: [x0, y1], handle: [x1, y0] },
    ml: { anchor: [x1, cy], handle: [x0, cy] },
    mr: { anchor: [x0, cy], handle: [x1, cy] },
    bl: { anchor: [x1, y0], handle: [x0, y1] },
    bc: { anchor: [cx, y0], handle: [cx, y1] },
    br: { anchor: [x0, y0], handle: [x1, y1] },
  };
  return map[edge];
}
