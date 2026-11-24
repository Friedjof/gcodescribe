/** Wheel deltas can describe pixels, lines or pages, depending on the device. */
export function wheelZoomFactor(delta: number, mode: number, viewportHeight: number) {
  const pixels = delta * (mode === 1 ? 40 : mode === 2 ? viewportHeight : 1);
  return Number.isFinite(pixels) ? Math.exp(-Math.max(-1000, Math.min(1000, pixels)) * 0.0015) : 1;
}
