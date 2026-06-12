import { useMemo } from "react";
import type { GallerySvg } from "../api";

/** Render extracted polylines (mm, y down) as a single SVG path — the safe
 * way to show uploaded artwork without ever embedding the original SVG. */
export default function PolylinePreview({
  data,
  className = "",
  stroke = "var(--text)",
}: {
  data: GallerySvg;
  className?: string;
  stroke?: string;
}) {
  const d = useMemo(
    () =>
      data.polylines
        .map((line) => "M" + line.map(([x, y]) => `${x},${y}`).join("L"))
        .join(""),
    [data.polylines]
  );
  const w = Math.max(data.width, 1);
  const h = Math.max(data.height, 1);
  const strokeWidth = Math.max(w, h) / 350;

  return (
    <svg
      className={`poly-preview ${className}`.trim()}
      viewBox={`${-w * 0.02} ${-h * 0.02} ${w * 1.04} ${h * 1.04}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <path d={d} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
