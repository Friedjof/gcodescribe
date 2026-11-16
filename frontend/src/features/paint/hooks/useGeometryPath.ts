import { useEffect, useState } from "react";
import { cachedGeometryPath, toMultiPath, type Pt } from "../lib/geometry";
import { preparePath, previewPath } from "../lib/geometryTasks";
export function useGeometryPath(lines: Pt[][], interactive = false, active = true) {
  const [, invalidate] = useState(0);
  const [failed, setFailed] = useState<Pt[][]>();
  useEffect(() => {
    let alive = true;
    if (active && cachedGeometryPath(lines) === undefined) {
      preparePath(lines).then(() => { if (alive) invalidate((v) => v + 1); }).catch(() => { if (alive) setFailed(lines); });
    }
    return () => { alive = false; };
  }, [lines, active]);
  // Navigation must never replace a prepared drawing with a subset of its lines.
  const prepared = cachedGeometryPath(lines);
  if (prepared !== undefined) return prepared;
  // If a gesture starts before the worker finishes, prepare the complete path
  // once. toMultiPath caches it, so subsequent wheel/pan frames only reuse it.
  if (active && (interactive || failed === lines)) return toMultiPath(lines);
  return previewPath(lines);
}
