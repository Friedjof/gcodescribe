export interface CanvasView { x: number; y: number; w: number; h: number }
/** Fit physical bounds into the viewport with an actual screen-pixel gutter. */
export function fitCanvasView(bounds: readonly number[], size: { width: number; height: number }, padding: number): CanvasView {
  const width = Math.max(.001, bounds[2] - bounds[0]), height = Math.max(.001, bounds[3] - bounds[1]);
  const viewportWidth = Math.max(1, size.width), viewportHeight = Math.max(1, size.height);
  const inset = Math.max(0, Math.min(padding, viewportWidth / 3, viewportHeight / 3));
  const scale = Math.min((viewportWidth - 2 * inset) / width, (viewportHeight - 2 * inset) / height);
  const w = viewportWidth / scale, h = viewportHeight / scale;
  return { x: (bounds[0] + bounds[2] - w) / 2, y: (bounds[1] + bounds[3] - h) / 2, w, h };
}
export function rulerStep(unitsPerPixel: number): number {
  const minimum = Math.max(.00001, unitsPerPixel * 60), power = 10 ** Math.floor(Math.log10(minimum));
  return [1, 2, 5, 10].map(factor => factor * power).find(step => step >= minimum)!;
}
export function rulerTicks(start: number, extent: number, unitsPerPixel: number): number[] {
  const step = rulerStep(unitsPerPixel), first = Math.ceil(start / step) * step;
  return Array.from({ length: Math.min(100, Math.max(0, Math.floor((start + extent - first) / step) + 1)) }, (_, i) => Number((first + i * step).toPrecision(10)));
}
