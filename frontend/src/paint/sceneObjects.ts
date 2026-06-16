import { api, type SceneObject } from "../api";
import { localize, type Pt } from "./geometry";
import { isServerFont, textWorld, type TextFont } from "./text";
import { buildStyledPolylines, normalizeStyle, type VectorStyle } from "./styling";

/** Pure scene-object helpers shared by the paint editor. */

export const zValue = (obj: SceneObject, index: number) => obj.zOrder ?? index;

export const cloneObjects = (objects: SceneObject[]) =>
  objects.map((obj) => ({
    ...obj,
    data: obj.data ? { ...obj.data } : undefined,
    transform: obj.transform ? { ...obj.transform } : undefined,
    cachedPolylines: obj.cachedPolylines?.map((line) => line.map((pt) => [...pt])),
  }));

export function basePolylines(obj: SceneObject): Pt[][] {
  return ((obj.data?.basePolylines ?? obj.cachedPolylines ?? []) as Pt[][]).map((line) =>
    line.map((p) => [p[0], p[1]] as Pt)
  );
}

export function objectStyle(obj: SceneObject): VectorStyle {
  return normalizeStyle(obj.data?.style);
}

export function withStyledCache(obj: SceneObject): SceneObject {
  const base = basePolylines(obj);
  const style = objectStyle(obj);
  return {
    ...obj,
    data: { ...(obj.data ?? {}), basePolylines: base, style },
    cachedPolylines: buildStyledPolylines(base, style),
  };
}

export function textGeometry(text: string, size: number, _font: TextFont, fallbackText = "Text") {
  return localize(textWorld(text || fallbackText, [0, 0], size));
}

// Single-line server fonts are rendered by the backend; the local 5x7 "block"
// font stays client-side. Either way the caller gets localized polylines.
export async function textGeometryAsync(
  text: string,
  size: number,
  font: TextFont,
  fallbackText = "Text",
  connectSpaces = false
) {
  if (!isServerFont(font)) return textGeometry(text, size, font, fallbackText);
  const res = await api.textPolylines(text || fallbackText, font, size, connectSpaces);
  return localize(res.polylines as Pt[][]);
}
