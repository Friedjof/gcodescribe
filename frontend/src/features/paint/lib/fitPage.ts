import type { SceneObject } from "../../../api";
import { IDENTITY, objectWorldBounds, type Pt } from "./geometry";
import { isMaskObject } from "./masks";

/** Fit the remaining drawing as one group, preserving each object's orientation.
 * Masks move with the drawing but never enlarge its bounds. Nothing is enlarged.
 */
export function fitPageObjects(objects: SceneObject[], width: number, height: number): SceneObject[] | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const object of objects) {
    if (object.plotted || isMaskObject(object)) continue;
    const lines = (object.cachedPolylines ?? []).filter((line) => line.length >= 2) as Pt[][];
    if (!lines.length) continue;
    const b = objectWorldBounds(lines, object.transform ?? IDENTITY);
    x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]);
    x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
  }
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  const epsilon = 1e-9;
  if (x0 >= -epsilon && y0 >= -epsilon && x1 <= width + epsilon && y1 <= height + epsilon) return null;

  const factor = Math.min(1, width / (x1 - x0), height / (y1 - y0));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const scaledX0 = cx + (x0 - cx) * factor, scaledX1 = cx + (x1 - cx) * factor;
  const scaledY0 = cy + (y0 - cy) * factor, scaledY1 = cy + (y1 - cy) * factor;
  const dx = scaledX0 < 0 ? -scaledX0 : scaledX1 > width ? width - scaledX1 : 0;
  const dy = scaledY0 < 0 ? -scaledY0 : scaledY1 > height ? height - scaledY1 : 0;
  const offsetX = cx * (1 - factor) + dx, offsetY = cy * (1 - factor) + dy;

  return objects.map((object) => {
    if (object.plotted && !isMaskObject(object)) return object;
    const t = object.transform ?? IDENTITY;
    return { ...object, transform: {
      ...t,
      x: t.x * factor + offsetX,
      y: t.y * factor + offsetY,
      scale: t.scale * factor,
      ...(t.scaleX !== undefined ? { scaleX: t.scaleX * factor } : {}),
      ...(t.scaleY !== undefined ? { scaleY: t.scaleY * factor } : {}),
    } };
  });
}
