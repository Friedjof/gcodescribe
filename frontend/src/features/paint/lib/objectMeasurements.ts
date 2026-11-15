import type { Calibration, SceneObject } from "../../../api";
import { IDENTITY, localBounds, objectWorldBounds, type Transform, type Pt } from "./geometry";
import { clampedTransform } from "./canvasTransforms";
import { basePolylines } from "./sceneObjects";
import { sourcePageFrame } from "./sourcePage";
import { displayDeg } from "./viewTransform";

export function measurementFrame(object: SceneObject) {
  return sourcePageFrame(object) ?? (object.cachedPolylines as Pt[][] | undefined) ?? basePolylines(object);
}

export function objectMeasurements(object: SceneObject) {
  const frame = measurementFrame(object);
  if (!frame.length) return null;
  const transform = object.transform ?? IDENTITY;
  const [x0, y0, x1, y1] = localBounds(frame);
  const bounds = objectWorldBounds(frame, transform);
  return { x: bounds[0], y: bounds[1], width: (x1 - x0) * Math.abs(transform.scaleX ?? transform.scale),
    height: (y1 - y0) * Math.abs(transform.scaleY ?? transform.scale), localWidth: x1 - x0, localHeight: y1 - y0,
    rotation: displayDeg(transform.rotation), bounds };
}
export type ObjectMeasurements = NonNullable<ReturnType<typeof objectMeasurements>>;
export type MeasurementEdit = { kind: "position"; axis: "x" | "y"; value: number }
  | { kind: "size"; axis: "width" | "height"; value: number; linked: boolean }
  | { kind: "rotation"; value: number };

/** Preserve the requested dimension exactly; reject sizes that cannot fit. */
export function measurementTransform(object: SceneObject, edit: MeasurementEdit, calibration: Calibration | null): Transform | null {
  const size = objectMeasurements(object);
  if (!size || !Number.isFinite(edit.value)) return null;
  const original = object.transform ?? IDENTITY;
  let next = original;
  if (edit.kind === "position") next = { ...original, [edit.axis]: original[edit.axis] + edit.value - size[edit.axis] };
  if (edit.kind === "rotation") {
    const rotation = ((edit.value % 360 + 360) % 360) * Math.PI / 180;
    if (Math.abs(Math.sin(rotation) - Math.sin(original.rotation)) > 1e-10 ||
        Math.abs(Math.cos(rotation) - Math.cos(original.rotation)) > 1e-10) next = { ...original, rotation };
  }
  if (edit.kind === "size") {
    if (edit.value <= 0) return null;
    const linked = edit.linked || !!sourcePageFrame(object);
    const current = size[edit.axis], base = edit.axis === "width" ? size.localWidth : size.localHeight;
    if (current <= 0 || base <= 0) return null;
    const sx = original.scaleX ?? original.scale, sy = original.scaleY ?? original.scale;
    const factor = edit.value / current;
    const scaleX = linked ? sx * factor : edit.axis === "width" ? Math.sign(sx || 1) * edit.value / base : sx;
    const scaleY = linked ? sy * factor : edit.axis === "height" ? Math.sign(sy || 1) * edit.value / base : sy;
    next = { ...original, scaleX, scaleY, scale: Math.max(Math.abs(scaleX), Math.abs(scaleY)) };
  }
  if (!calibration) return next;
  const frame = measurementFrame(object), width = calibration.plot_width, height = calibration.plot_height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const bounds = objectWorldBounds(frame, next);
  if (edit.kind === "position") return bounds[0] < -1e-8 || bounds[1] < -1e-8 || bounds[2] > width + 1e-8 || bounds[3] > height + 1e-8 ? null : next;
  const bounded = clampedTransform(next, frame, width, height);
  if (Math.abs((bounded.scaleX ?? bounded.scale) - (next.scaleX ?? next.scale)) > 1e-8 ||
      Math.abs((bounded.scaleY ?? bounded.scale) - (next.scaleY ?? next.scale)) > 1e-8) return null;
  return bounded;
}
