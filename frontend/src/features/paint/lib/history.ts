import type { SceneObject } from "../../../api";
const bytes = new WeakMap<object, number>();
export function trimHistory(undo: SceneObject[][], redo: SceneObject[][], limit = 64 * 1024 * 1024) {
  const size = () => {
    const seen = new Set<object>();
    let total = 0;
    for (const frame of [...undo, ...redo]) for (const object of frame) {
      total += 256;
      for (const geometry of [object.cachedPolylines, object.data?.basePolylines, object.cachedFeeds,
        object.data?.baseSegmentPressures, object.data?.cachedSegmentPressures]) {
        if (!geometry || seen.has(geometry)) continue;
        seen.add(geometry);
        let count = bytes.get(geometry);
        if (count === undefined) {
          count = geometry.reduce((n: number, line: unknown[] | null) => n + 32 + (line?.length ?? 0) * 48, 0);
          bytes.set(geometry, count!);
        }
        total += count!;
      }
    }
    return total;
  };
  while (undo.length + redo.length > 100 || size() > limit) {
    if (undo.length) undo.shift(); else if (redo.length) redo.shift(); else break;
  }
}
