import type { Calibration } from "../api";
import { toPath, type Pt } from "../paint/geometry";

export default function GamePreviewSvg({ cal, lines, solutionLines, className = "" }: {
  cal: Calibration;
  lines: Pt[][];
  solutionLines?: Pt[][];
  className?: string;
}) {
  const W = cal.plot_width;
  const H = cal.plot_height;
  const pad = Math.max(W, H) * 0.04 + 4;
  const stroke = Math.max(Math.max(W, H) * 0.004, 0.45);
  const grid = Math.max(10, Math.round(Math.min(W, H) / 10 / 5) * 5);
  const major = grid * 5;
  return (
    <div className={`games-preview ${className}`.trim()}>
      <svg viewBox={`${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <pattern id="games-grid-minor" width={grid} height={grid} patternUnits="userSpaceOnUse">
            <path d={`M ${grid} 0 L 0 0 L 0 ${grid}`} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={0.25} />
          </pattern>
          <pattern id="games-grid-major" width={major} height={major} patternUnits="userSpaceOnUse">
            <rect width={major} height={major} fill="url(#games-grid-minor)" />
            <path d={`M ${major} 0 L 0 0 L 0 ${major}`} fill="none" stroke="rgba(255,255,255,0.13)" strokeWidth={0.4} />
          </pattern>
        </defs>

        <rect x={0} y={0} width={W} height={H} rx={1.5} fill="#101013" stroke="var(--accent)" strokeWidth={0.6} />
        <rect x={0} y={0} width={W} height={H} fill="url(#games-grid-major)" />

        {lines.map((line, index) => (
          <path
            key={index}
            d={toPath(line)}
            fill="none"
            stroke="var(--busy)"
            strokeWidth={stroke}
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
            strokeWidth={stroke * 2.2}
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
