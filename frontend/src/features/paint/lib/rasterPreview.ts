import { DISPLAY_INK_PX } from "../../../lib/displayStroke";

// Resting views use vectors before this resolution is enlarged. Keeping the
// gesture texture bounded also bounds WebKit PNG decoding and texture uploads.
export const RASTER_MAX_EDGE = 2048;

/** Reuse previews across small zoom changes instead of re-encoding a PNG. */
export function rasterStrokeWidth(edge: number, stroke: number, previous?: number) {
  const minimum = Math.max(0.000001, (Number.isFinite(edge) ? edge : 0) * DISPLAY_INK_PX / RASTER_MAX_EDGE);
  const desired = Math.max(minimum, stroke);
  // Hysteresis avoids oscillating between cache buckets at a zoom boundary.
  // Ink remains within 10% of the desired 0.9 CSS pixels (and below one pixel).
  return previous !== undefined && previous >= minimum && previous >= desired / 1.1 && previous <= desired * 1.1
    ? previous : desired;
}
