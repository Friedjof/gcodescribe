import { useRef } from "react";
import type { Calibration, GcodePreview, Position } from "../api";

const CORNER_LABELS: Record<string, string> = {
  bl: "↙",
  br: "↘",
  tr: "↗",
  tl: "↖",
};

export default function LiveView({
  cal,
  position,
  rect,
  preview,
  onMoveTo,
}: {
  cal: Calibration;
  position: Position | null;
  rect: [number, number, number, number] | null;
  preview: GcodePreview | null;
  onMoveTo?: (x: number, y: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const W = cal.bed_width;
  const H = cal.bed_height;
  // Printer y points up, SVG y points down.
  const ty = (y: number) => H - y;

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onMoveTo || !svgRef.current) return;
    const pt = svgRef.current.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return;
    const p = pt.matrixTransform(ctm.inverse());
    if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) return;
    onMoveTo(Math.round(p.x * 10) / 10, Math.round(ty(p.y) * 10) / 10);
  };

  const grid = [];
  for (let x = 0; x <= W; x += 10) {
    grid.push(
      <line key={`v${x}`} x1={x} y1={0} x2={x} y2={H}
        stroke="var(--border)" strokeWidth={x % 50 === 0 ? 0.5 : 0.2} />
    );
  }
  for (let y = 0; y <= H; y += 10) {
    grid.push(
      <line key={`h${y}`} x1={0} y1={ty(y)} x2={W} y2={ty(y)}
        stroke="var(--border)" strokeWidth={y % 50 === 0 ? 0.5 : 0.2} />
    );
  }

  const corners = Object.entries(cal.paper_corners ?? {});
  const margin = cal.paper_margin ?? 0;

  return (
    <div className="liveview">
      <svg
        ref={svgRef}
        viewBox={`-8 -8 ${W + 16} ${H + 16}`}
        onClick={handleClick}
        style={{ cursor: onMoveTo ? "crosshair" : "default" }}
      >
        {/* bed */}
        <rect x={0} y={0} width={W} height={H} rx={2}
          fill="var(--panel-2)" stroke="var(--border)" strokeWidth={1} />
        {grid}

        {/* paper */}
        {rect && (
          <g>
            <rect
              x={rect[0]} y={ty(rect[1] + rect[3])} width={rect[2]} height={rect[3]}
              fill="rgba(255,255,255,0.08)" stroke="#e5e5ea" strokeWidth={0.8}
            />
            <text
              x={rect[0] + rect[2] / 2} y={ty(rect[1] + rect[3]) - 2.5}
              fontSize={6} fill="var(--muted)" textAnchor="middle"
            >
              {rect[2].toFixed(0)} × {rect[3].toFixed(0)} mm
            </text>
          </g>
        )}
        {/* plot area derived from paper minus margin (live preview of apply) */}
        {rect && margin > 0 && rect[2] - 2 * margin > 0 && rect[3] - 2 * margin > 0 && (
          <rect
            x={rect[0] + margin} y={ty(rect[1] + rect[3] - margin)}
            width={rect[2] - 2 * margin} height={rect[3] - 2 * margin}
            fill="none" stroke="#cfd6e4" strokeWidth={0.4} strokeDasharray="2 2"
          />
        )}

        {/* active plot area from calibration */}
        <rect
          x={cal.origin_x} y={ty(cal.origin_y + cal.plot_height)}
          width={cal.plot_width} height={cal.plot_height}
          fill="none" stroke="var(--accent)" strokeWidth={0.6} strokeDasharray="4 3"
        />

        {/* gcode preview */}
        {preview && (
          <g>
            {preview.travels.map((t, i) => (
              <line key={`t${i}`} x1={t[0][0]} y1={ty(t[0][1])} x2={t[1][0]} y2={ty(t[1][1])}
                stroke="var(--muted)" strokeWidth={0.25} strokeDasharray="1.5 1.5" opacity={0.5} />
            ))}
            {preview.polylines.map((line, i) => (
              <polyline key={`p${i}`}
                points={line.map((p) => `${p[0]},${ty(p[1])}`).join(" ")}
                fill="none" stroke="var(--busy)" strokeWidth={0.6}
                strokeLinejoin="round" strokeLinecap="round" />
            ))}
          </g>
        )}

        {/* captured corners */}
        {corners.map(([name, [cx, cy]]) => (
          <g key={name}>
            <circle cx={cx} cy={ty(cy)} r={2.6} fill="var(--ok)" />
            <text x={cx + 4} y={ty(cy) - 3} fontSize={7} fill="var(--ok)">
              {CORNER_LABELS[name] ?? name}
            </text>
          </g>
        ))}

        {/* head position */}
        {position && position.homed && (
          <g>
            <line x1={position.x - 6} y1={ty(position.y)} x2={position.x + 6} y2={ty(position.y)}
              stroke="var(--err)" strokeWidth={0.6} />
            <line x1={position.x} y1={ty(position.y) - 6} x2={position.x} y2={ty(position.y) + 6}
              stroke="var(--err)" strokeWidth={0.6} />
            <circle cx={position.x} cy={ty(position.y)} r={3}
              fill="none" stroke="var(--err)" strokeWidth={0.8} />
            <text
              x={Math.min(position.x + 5, W - 30)} y={Math.max(ty(position.y) - 5, 6)}
              fontSize={6} fill="var(--err)"
            >
              {position.x.toFixed(1)} / {position.y.toFixed(1)}
            </text>
          </g>
        )}

        {/* origin marker */}
        <text x={1} y={H + 6.5} fontSize={6} fill="var(--muted)">0,0</text>
      </svg>
    </div>
  );
}
