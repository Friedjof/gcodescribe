import { useEffect, useState } from "react";
import { cachedGeometryPath, toMultiPath, type Pt } from "../lib/geometry";
import { preparePath, previewPath } from "../lib/geometryTasks";
export function useGeometryPath(lines: Pt[][], interactive = false, active = true, sampled = false) {
  const [, invalidate] = useState(0);
  const [failed, setFailed] = useState<Pt[][]>();
  useEffect(() => {
    let alive = true;
    if (active && cachedGeometryPath(lines) === undefined) {
      preparePath(lines).then(() => { if (alive) invalidate((v) => v + 1); }).catch(() => { if (alive) setFailed(lines); });
    }
    return () => { alive = false; };
  }, [lines, active]);
  if (failed === lines && !interactive && !sampled && active) return toMultiPath(lines);
  return (interactive || sampled ? undefined : cachedGeometryPath(lines)) ?? previewPath(lines);
}
