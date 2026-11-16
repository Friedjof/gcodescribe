import { DISPLAY_INK_PX } from "../../../lib/displayStroke";
import { useMemo } from "react";
import type { Calibration } from "../../../api";
import { toPath, type Pt } from "../../paint/lib/geometry";

export default function GamePreviewSvg({ cal, lines, solutionLines, strokeWidth, className = "" }: {
  cal: Calibration;
  lines: Pt[][];
  solutionLines?: Pt[][];
  strokeWidth?: number;
  className?: string;
}) {
  const W = cal.plot_width;
  const H = cal.plot_height;
  const pad = Math.max(W, H) * 0.04 + 4;
  const stroke = strokeWidth ?? DISPLAY_INK_PX;
  // Independent subpaths can share one SVG element. A city with tens of
  // thousands of roads should not need tens of thousands of DOM nodes.
  const paths = useMemo(() => {
    const batches: string[] = [];
    for (let i = 0; i < lines.length; i += 256) {
      batches.push(lines.slice(i, i + 256).map(toPath).join(" "));
    }
    return batches;
  }, [lines]);
  const grid = Math.max(10, Math.round(Math.min(W, H) / 10 / 5) * 5);
  const major = grid * 5;
  return (
    <div className={`games-preview ${className}`.trim()}>
      <svg viewBox={`${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <pattern id="games-grid-minor" width={grid} height={grid} patternUnits="userSpaceOnUse">
            <path d={`M ${grid} 0 L 0 0 L 0 ${grid}`} fill="none" stroke="var(--paper-grid-minor)" strokeWidth={0.25} />
          </pattern>
          <pattern id="games-grid-major" width={major} height={major} patternUnits="userSpaceOnUse">
            <rect width={major} height={major} fill="url(#games-grid-minor)" />
            <path d={`M ${major} 0 L 0 0 L 0 ${major}`} fill="none" stroke="var(--paper-grid-major)" strokeWidth={0.4} />
          </pattern>
        </defs>

        <rect x={0} y={0} width={W} height={H} rx={1.5} fill="var(--paper)" stroke="var(--paper-border)" strokeWidth={0.6} />
        <rect x={0} y={0} width={W} height={H} fill="url(#games-grid-major)" />

        {paths.map((path, index) => (
          <path
            key={index}
            d={path}
            fill="none"
            stroke="var(--ink)"
            strokeWidth={stroke}
            vectorEffect={strokeWidth === undefined ? "non-scaling-stroke" : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {solutionLines?.map((line, index) => (
          <path
            key={`sol-${index}`}
            d={toPath(line)}
            fill="none"
            stroke="rgba(255, 80, 80, 0.85)"
            strokeWidth={stroke * 1.5}
            vectorEffect={strokeWidth === undefined ? "non-scaling-stroke" : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        <text x={W / 2} y={H + pad * 0.7} fontSize={Math.max(W, H) * 0.022} fill="var(--muted)" textAnchor="middle">
          {W.toFixed(0)} x {H.toFixed(0)} mm
        </text>
      </svg>
    </div>
  );
}
