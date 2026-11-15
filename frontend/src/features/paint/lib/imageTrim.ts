import type { SceneObject } from "../../../api";
import { IDENTITY, localBounds, type Pt } from "./geometry";
import { sourcePageFrame } from "./sourcePage";

export type TrimSide = "left" | "right" | "top" | "bottom";
export type BlankMargins = Record<TrimSide, number>;

function keepVisibleAxis(low: number, high: number, fullLow: number, fullHigh: number): [number, number] {
  const minSize = Math.min(0.1, fullHigh - fullLow);
  if (high - low >= minSize) return [low, high];
  const center = (low + high) / 2;
  const start = Math.max(fullLow, Math.min(center - minSize / 2, fullHigh - minSize));
  return [start, start + minSize];
}

function imageBounds(obj: SceneObject): { frame: [number, number, number, number]; content: [number, number, number, number] } | null {
  if (obj.type !== "image") return null;
  const frame = sourcePageFrame(obj);
  const lines = (obj.cachedPolylines ?? []) as Pt[][];
  const plotted = lines.filter((line) => line.length > 0);
  if (!frame || !plotted.length) return null;
  const content = localBounds(plotted);
  if (!content.every(Number.isFinite)) return null;
  return { frame: localBounds(frame), content };
}

/** Empty margins in canvas millimetres, measured from the selected image frame
 * to its actual plot lines. Other imported images already use tight bounds. */
export function imageBlankMargins(obj: SceneObject): BlankMargins | null {
  const bounds = imageBounds(obj);
  if (!bounds) return null;
  const { frame: [x0, y0, x1, y1], content: [cx0, cy0, cx1, cy1] } = bounds;
  const t = obj.transform ?? IDENTITY;
  return {
    left: Math.max(0, cx0 - x0) * Math.abs(t.scaleX ?? t.scale),
    right: Math.max(0, x1 - cx1) * Math.abs(t.scaleX ?? t.scale),
    top: Math.max(0, cy0 - y0) * Math.abs(t.scaleY ?? t.scale),
    bottom: Math.max(0, y1 - cy1) * Math.abs(t.scaleY ?? t.scale),
  };
}

/** Tighten only selected empty sides. Geometry and world placement stay put,
 * so the rendered lines and generated G-code remain identical. */
export function trimImageBlankEdges(obj: SceneObject, sides: TrimSide[]): SceneObject | null {
  const bounds = imageBounds(obj);
  if (!bounds || !sides.length) return null;
  const { frame, content } = bounds;
  const selected = new Set(sides);
  const next = [...frame] as [number, number, number, number];
  if (selected.has("left")) next[0] = Math.max(frame[0], content[0]);
  if (selected.has("top")) next[1] = Math.max(frame[1], content[1]);
  if (selected.has("right")) next[2] = Math.min(frame[2], content[2]);
  if (selected.has("bottom")) next[3] = Math.min(frame[3], content[3]);
  [next[0], next[2]] = keepVisibleAxis(next[0], next[2], frame[0], frame[2]);
  [next[1], next[3]] = keepVisibleAxis(next[1], next[3], frame[1], frame[3]);
  if (next.every((value, i) => Math.abs(value - frame[i]) < 1e-6)) return null;
  return { ...obj, data: {
    ...obj.data, sourcePage: { ...obj.data.sourcePage, trim: next },
  } };
}

export function resetImageBlankEdges(obj: SceneObject): SceneObject | null {
  if (obj.type !== "image" || !obj.data?.sourcePage?.trim) return null;
  const { trim: _trim, ...sourcePage } = obj.data.sourcePage;
  return { ...obj, data: { ...obj.data, sourcePage } };
}
