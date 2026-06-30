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
    cachedFeeds: obj.cachedFeeds?.map((line) => [...line]),
  }));

export function basePolylines(obj: SceneObject): Pt[][] {
  return ((obj.data?.basePolylines ?? obj.cachedPolylines ?? []) as Pt[][]).map((line) =>
    line.map((p) => [p[0], p[1]] as Pt)
  );
}

export function objectStyle(obj: SceneObject): VectorStyle {
  return normalizeStyle(obj.data?.style);
}

export function keepsStrokeFeeds(style: VectorStyle): boolean {
  return style.stroke.mode === "solid" && !style.fill.enabled;
}

export function withStyledCache(obj: SceneObject): SceneObject {
  const base = basePolylines(obj);
  const style = objectStyle(obj);
  return {
    ...obj,
    data: { ...(obj.data ?? {}), basePolylines: base, style },
    cachedPolylines: buildStyledPolylines(base, style),
    cachedFeeds: keepsStrokeFeeds(style) ? obj.cachedFeeds : undefined,
  };
}

// A stable per-text-object seed: stroke fonts pick a random (weighted) variant
// per letter, so the same text would otherwise look identical every render. The
// seed is stored on the object's `data`, keeping preview and plot in sync while
// giving each text its own random mix.
export function randomTextSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

export function textGeometry(text: string, size: number, _font: TextFont, fallbackText = "Text") {
  return { ...localize(textWorld(text || fallbackText, [0, 0], size)), feeds: undefined, missing: undefined };
}

// Single-line server fonts are rendered by the backend; the local 5x7 "block"
// font stays client-side. Either way the caller gets localized polylines.
export async function textGeometryAsync(
  text: string,
  size: number,
  font: TextFont,
  fallbackText = "Text",
  connectSpaces = false,
  seed = 0
) {
  if (!isServerFont(font)) return textGeometry(text, size, font, fallbackText);
  const res = await api.textPolylines(text || fallbackText, font, size, connectSpaces, seed);
  return { ...localize(res.polylines as Pt[][]), feeds: res.feeds, missing: res.missing };
}
