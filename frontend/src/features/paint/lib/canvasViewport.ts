export interface CanvasView {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Fit physical bounds into the viewport with an actual screen-pixel gutter. */
export function fitCanvasView(
  bounds: readonly number[],
  size: { width: number; height: number },
  padding: number,
): CanvasView {
  const width = Math.max(0.001, bounds[2] - bounds[0]),
    height = Math.max(0.001, bounds[3] - bounds[1]);
  const viewportWidth = Math.max(1, size.width),
    viewportHeight = Math.max(1, size.height);
  const inset = Math.max(
    0,
    Math.min(padding, viewportWidth / 3, viewportHeight / 3),
  );
  const scale = Math.min(
    (viewportWidth - 2 * inset) / width,
    (viewportHeight - 2 * inset) / height,
  );
  const w = viewportWidth / scale,
    h = viewportHeight / scale;
  return {
    x: (bounds[0] + bounds[2] - w) / 2,
    y: (bounds[1] + bounds[3] - h) / 2,
    w,
    h,
  };
}
export function rulerStep(unitsPerPixel: number): number {
  const minimum = Math.max(0.00001, unitsPerPixel * 60),
    power = 10 ** Math.floor(Math.log10(minimum));
  return [1, 2, 5, 10]
    .map((factor) => factor * power)
    .find((step) => step >= minimum)!;
}
export function rulerTicks(
  start: number,
  extent: number,
  unitsPerPixel: number,
): number[] {
  const step = rulerStep(unitsPerPixel),
    first = Math.ceil(start / step) * step;
  return Array.from(
    {
      length: Math.min(
        100,
        Math.max(0, Math.floor((start + extent - first) / step) + 1),
      ),
    },
    (_, i) => Number((first + i * step).toPrecision(10)),
  );
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export function clampCanvasView(
  view: CanvasView,
  base: CanvasView,
): CanvasView {
  return {
    ...view,
    x:
      view.w >= base.w
        ? base.x + (base.w - view.w) / 2
        : clamp(view.x, base.x, base.x + base.w - view.w),
    y:
      view.h >= base.h
        ? base.y + (base.h - view.h) / 2
        : clamp(view.y, base.y, base.y + base.h - view.h),
  };
}
export function zoomCanvasView(
  view: CanvasView,
  base: CanvasView,
  factor: number,
  anchor?: readonly number[],
): CanvasView {
  const zoom = clamp((base.w / view.w) * factor, 0.5, 48),
    w = base.w / zoom,
    h = base.h / zoom;
  const [x, y] = anchor ?? [view.x + view.w / 2, view.y + view.h / 2];
  return clampCanvasView(
    {
      x: x - ((x - view.x) * w) / view.w,
      y: y - ((y - view.y) * h) / view.h,
      w,
      h,
    },
    base,
  );
}
export function resizeCanvasView(
  view: CanvasView,
  previousBase: CanvasView,
  base: CanvasView,
  previousSize: { width: number; height: number },
  size: { width: number; height: number },
): CanvasView {
  const fitted =
    Math.abs(view.w - previousBase.w) < 0.00001 &&
    Math.abs(view.h - previousBase.h) < 0.00001;
  if (fitted) return base;
  const pixel = Math.max(
    view.w / previousSize.width,
    view.h / previousSize.height,
  );
  const w = pixel * size.width,
    h = pixel * size.height;
  return clampCanvasView(
    { x: view.x + (view.w - w) / 2, y: view.y + (view.h - h) / 2, w, h },
    base,
  );
}
