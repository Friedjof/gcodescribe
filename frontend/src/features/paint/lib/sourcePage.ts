import type { SceneObject } from "../../../api";
import type { Pt } from "./geometry";

/** The paper frame is part of an imported Xournal++ object's placement, not its plot path. */
export function sourcePageFrame(obj: SceneObject): Pt[][] | null {
  const page = obj.data?.sourcePage as { width?: unknown; height?: unknown; trim?: unknown } | undefined;
  const width = page?.width;
  const height = page?.height;
  if (typeof width !== "number" || typeof height !== "number" ||
      !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const full: [number, number, number, number] = [-width / 2, -height / 2, width / 2, height / 2];
  const trim = page?.trim;
  const [x0, y0, x1, y1] = Array.isArray(trim) && trim.length === 4 &&
    trim.every((value) => typeof value === "number" && Number.isFinite(value)) &&
    trim[0] >= full[0] && trim[1] >= full[1] && trim[2] <= full[2] && trim[3] <= full[3] &&
    trim[2] > trim[0] && trim[3] > trim[1]
    ? trim as [number, number, number, number] : full;
  return [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]];
}

export function objectPlacementFrame(obj: SceneObject): Pt[][] {
  return sourcePageFrame(obj) ?? (obj.cachedPolylines ?? []) as Pt[][];
}
