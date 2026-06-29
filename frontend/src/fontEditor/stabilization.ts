import type { StrokePoint } from "../api";

// Pure stroke stabilization — no React/DOM. Turns raw pointer samples into
// calmer, plotter-friendly points while keeping the stroke ending where the user
// intended. Inspired by Xournal++ (inertia follower + smoothing). The applied
// parameters are stored on the stroke (`processing`) so a stroke can later be
// re-processed reproducibly. Coordinates are in em units.

export type StabilizationPreset = "off" | "light" | "medium" | "strong";

export interface StabilizationParams {
  preset: StabilizationPreset;
  /** Gaussian smoothing std-dev, in samples (0 = off). */
  sigma: number;
  /** Inertia follower mass — higher = smoother/laggier (0 = off). */
  mass: number;
  /** Velocity retention of the inertia follower, 0..0.95. */
  drag: number;
  /** Drop this many leading samples (touchpad/stylus start artifacts). */
  ignoreStartEvents: number;
  /** Force the last point to the true raw end. */
  closeStrokeEnd: boolean;
  /** Ramer–Douglas–Peucker tolerance in em (0 = no simplification). */
  simplifyTolerance: number;
}

export const STABILIZATION_PRESETS: Record<StabilizationPreset, StabilizationParams> = {
  off: {
    preset: "off",
    sigma: 0,
    mass: 0,
    drag: 0,
    ignoreStartEvents: 0,
    closeStrokeEnd: false,
    simplifyTolerance: 0,
  },
  light: {
    preset: "light",
    sigma: 1.0,
    mass: 0,
    drag: 0,
    ignoreStartEvents: 1,
    closeStrokeEnd: true,
    simplifyTolerance: 3,
  },
  medium: {
    preset: "medium",
    sigma: 1.8,
    mass: 1.6,
    drag: 0.4,
    ignoreStartEvents: 2,
    closeStrokeEnd: true,
    simplifyTolerance: 5,
  },
  strong: {
    preset: "strong",
    sigma: 2.8,
    mass: 3.0,
    drag: 0.5,
    ignoreStartEvents: 4,
    closeStrokeEnd: true,
    simplifyTolerance: 8,
  },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function gaussianKernel(sigma: number): number[] {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel: number[] = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i += 1) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(w);
    sum += w;
  }
  return kernel.map((w) => w / sum);
}

/** Gaussian smoothing of x/y with clamped borders; preserves point count. */
function smoothGaussian(pts: StrokePoint[], sigma: number): StrokePoint[] {
  if (sigma <= 0 || pts.length < 3) return pts;
  const kernel = gaussianKernel(sigma);
  const radius = (kernel.length - 1) / 2;
  const n = pts.length;
  return pts.map((p, i) => {
    let x = 0;
    let y = 0;
    for (let k = -radius; k <= radius; k += 1) {
      const j = clamp(i + k, 0, n - 1);
      const w = kernel[k + radius];
      x += pts[j].x * w;
      y += pts[j].y * w;
    }
    return { ...p, x, y };
  });
}

/** Inertia follower: a virtual point of `mass` chases the input with `drag`. */
function inertiaFollow(pts: StrokePoint[], mass: number, drag: number): StrokePoint[] {
  if (mass <= 0 || pts.length < 2) return pts;
  const alpha = 1 / (1 + mass);
  const retain = clamp(drag, 0, 0.95);
  let px = pts[0].x;
  let py = pts[0].y;
  let vx = 0;
  let vy = 0;
  const out: StrokePoint[] = [{ ...pts[0] }];
  for (let i = 1; i < pts.length; i += 1) {
    vx = vx * retain + (pts[i].x - px) * alpha;
    vy = vy * retain + (pts[i].y - py) * alpha;
    px += vx;
    py += vy;
    out.push({ ...pts[i], x: px, y: py });
  }
  return out;
}

function perpDistance(p: StrokePoint, a: StrokePoint, b: StrokePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/** Ramer–Douglas–Peucker: drops points within `tolerance`, keeps endpoints. */
export function rdp(pts: StrokePoint[], tolerance: number): StrokePoint[] {
  if (tolerance <= 0 || pts.length < 3) return pts;
  let maxDist = 0;
  let index = 0;
  const end = pts.length - 1;
  for (let i = 1; i < end; i += 1) {
    const d = perpDistance(pts[i], pts[0], pts[end]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist <= tolerance) return [pts[0], pts[end]];
  const left = rdp(pts.slice(0, index + 1), tolerance);
  const right = rdp(pts.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

const isNoop = (p: StabilizationParams) =>
  p.preset === "off" ||
  (p.sigma <= 0 &&
    p.mass <= 0 &&
    p.simplifyTolerance <= 0 &&
    p.ignoreStartEvents <= 0 &&
    !p.closeStrokeEnd);

/** Stabilize raw points into processed points using `params`. Pure. */
export function stabilize(raw: StrokePoint[], params: StabilizationParams): StrokePoint[] {
  if (raw.length === 0) return [];
  if (isNoop(params) || raw.length < 2) return raw.map((p) => ({ ...p }));

  let pts = raw.map((p) => ({ ...p }));
  if (params.ignoreStartEvents > 0 && pts.length > params.ignoreStartEvents + 2) {
    pts = pts.slice(params.ignoreStartEvents);
  }

  const trueEnd = raw[raw.length - 1];

  if (params.mass > 0) pts = inertiaFollow(pts, params.mass, params.drag);
  if (params.sigma > 0) pts = smoothGaussian(pts, params.sigma);

  // Correct the stroke end so smoothing/inertia lag doesn't pull it short of
  // where the pen lifted. The start is intentionally *not* hard-anchored —
  // dropped start artifacts shouldn't be reintroduced — smoothing keeps it close.
  if (params.closeStrokeEnd) {
    pts[pts.length - 1] = { ...pts[pts.length - 1], x: trueEnd.x, y: trueEnd.y };
  }

  if (params.simplifyTolerance > 0 && pts.length > 2) {
    pts = rdp(pts, params.simplifyTolerance);
  }
  return pts;
}
