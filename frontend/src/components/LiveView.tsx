import { useRef, useState, useEffect } from "react";
import type { Calibration, GcodePreview, Obstacle, Position } from "../api";

const CORNER_LABELS: Record<string, string> = {
  bl: "↙",
  br: "↘",
  tr: "↗",
  tl: "↖",
};

const CORNER_ORDER = ["tl", "tr", "br", "bl"] as const;
const SNAP_THRESHOLD = 8; // mm

function snapTo90(
  corners: Record<string, [number, number]>,
  moving: string,
  x: number,
  y: number
): [number, number] | null {
  const others = CORNER_ORDER.filter((c) => c !== moving && corners[c]);
  if (others.length !== 3) return null;
  const adj: Record<string, [string, string]> = {
    tl: ["tr", "bl"], tr: ["tl", "br"], br: ["tr", "bl"], bl: ["tl", "br"],
  };
  const diag: Record<string, string> = { tl: "br", tr: "bl", br: "tl", bl: "tr" };
  const [a1, a2] = adj[moving];
  const d = diag[moving];
  const pa1 = corners[a1], pa2 = corners[a2], pd = corners[d];
  if (!pa1 || !pa2 || !pd) return null;
  const sx = pa1[0] + pa2[0] - pd[0];
  const sy = pa1[1] + pa2[1] - pd[1];
  const dist = Math.hypot(sx - x, sy - y);
  return dist <= SNAP_THRESHOLD ? [sx, sy] : null;
}

export default function LiveView({
  cal,
  position,
  rect,
  preview,
  onMoveTo,
  onDragCorner,
  onDropCorner,
  obstacles,
  editingObstacles,
  onObstaclesChange,
}: {
  cal: Calibration;
  position: Position | null;
  rect: [number, number, number, number] | null;
  preview: GcodePreview | null;
  onMoveTo?: (x: number, y: number) => void;
  onDragCorner?: (corner: string, x: number, y: number) => void;
  onDropCorner?: (corner: string, x: number, y: number) => void;
  obstacles?: Obstacle[];
  editingObstacles?: boolean;
  onObstaclesChange?: (obstacles: Obstacle[]) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const W = cal.bed_width;
  const H = cal.bed_height;
  const ty = (y: number) => H - y;

  // Paper-corner drag state
  const [dragging, setDragging] = useState<{ corner: string; pointerId: number } | null>(null);
  const [snapTarget, setSnapTarget] = useState<[number, number] | null>(null);

  // Obstacle selection (for keyboard delete)
  const [selectedObsId, setSelectedObsId] = useState<string | null>(null);

  // Deselect when leaving edit mode
  useEffect(() => {
    if (!editingObstacles) setSelectedObsId(null);
  }, [editingObstacles]);

  // Delete selected obstacle via keyboard
  useEffect(() => {
    if (!editingObstacles || !selectedObsId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const tgt = e.target as HTMLElement | null;
      if (tgt?.tagName === "INPUT" || tgt?.tagName === "TEXTAREA" || tgt?.isContentEditable) return;
      e.preventDefault();
      const next = (obstacles ?? []).filter((o) => o.id !== selectedObsId);
      setSelectedObsId(null);
      onObstaclesChange?.(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingObstacles, selectedObsId, obstacles, onObstaclesChange]);

  const svgBedCoords = (
    e: { clientX: number; clientY: number }
  ): [number, number] | null => {
    if (!svgRef.current) return null;
    const pt = svgRef.current.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return null;
    const p = pt.matrixTransform(ctm.inverse());
    const bx = Math.max(0, Math.min(W, Math.round(p.x * 10) / 10));
    const by = Math.max(0, Math.min(H, Math.round(ty(p.y) * 10) / 10));
    return [bx, by];
  };

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onMoveTo || dragging || !svgRef.current) return;
    const pt = svgRef.current.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return;
    const p = pt.matrixTransform(ctm.inverse());
    if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) return;
    const bx = Math.round(p.x * 10) / 10;
    const by = Math.round(ty(p.y) * 10) / 10;
    // Block click if target is inside any obstacle
    if ((obstacles ?? []).some((o) => bx >= o.x && bx <= o.x + o.w && by >= o.y && by <= o.y + o.h)) return;
    onMoveTo(bx, by);
  };

  // ── Paper corner drag ──────────────────────────────────────────────────
  const handleCornerPointerDown = (
    e: React.PointerEvent<SVGCircleElement>,
    corner: string
  ) => {
    if (!onDragCorner && !onDropCorner) return;
    e.stopPropagation();
    (e.target as SVGCircleElement).setPointerCapture(e.pointerId);
    setDragging({ corner, pointerId: e.pointerId });
    setSnapTarget(null);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging) return;
    const coords = svgBedCoords(e);
    if (!coords) return;
    const [x, y] = coords;
    const snap = snapTo90(
      cal.paper_corners as Record<string, [number, number]>,
      dragging.corner, x, y
    );
    setSnapTarget(snap);
    onDragCorner?.(dragging.corner, snap ? snap[0] : x, snap ? snap[1] : y);
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging) return;
    const coords = svgBedCoords(e);
    if (coords) {
      const [x, y] = coords;
      const snap = snapTo90(
        cal.paper_corners as Record<string, [number, number]>,
        dragging.corner, x, y
      );
      onDropCorner?.(dragging.corner, snap ? snap[0] : x, snap ? snap[1] : y);
    }
    setDragging(null);
    setSnapTarget(null);
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

  const cornersMap = (cal.paper_corners ?? {}) as Record<string, [number, number]>;
  const capturedCorners = CORNER_ORDER.filter((c) => cornersMap[c] != null);
  const margin = cal.paper_margin ?? 0;
  const isDraggable = !!(onDragCorner || onDropCorner);

  const polyPoints = capturedCorners
    .map((c) => {
      const [cx, cy] = cornersMap[c];
      return `${cx},${ty(cy)}`;
    })
    .join(" ");

  let marginPolyPoints: string | null = null;
  if (capturedCorners.length === 4 && margin > 0) {
    const cx = capturedCorners.reduce((s, c) => s + cornersMap[c][0], 0) / 4;
    const cy = capturedCorners.reduce((s, c) => s + cornersMap[c][1], 0) / 4;
    marginPolyPoints = capturedCorners
      .map((c) => {
        const [px, py] = cornersMap[c];
        const dx = px - cx;
        const dy = py - cy;
        const len = Math.hypot(dx, dy);
        if (len < 1e-9) return `${px},${ty(py)}`;
        const scale = Math.max(0, (len - margin)) / len;
        return `${cx + dx * scale},${ty(cy + dy * scale)}`;
      })
      .join(" ");
  }

  const displayObs = obstacles ?? [];

  return (
    <div className="liveview">
      <svg
        ref={svgRef}
        viewBox={`-8 -8 ${W + 16} ${H + 16}`}
        onClick={handleClick}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          cursor: dragging ? "grabbing" : onMoveTo ? "crosshair" : "default",
        }}
      >
        {/* bed */}
        <rect x={0} y={0} width={W} height={H} rx={2}
          fill="var(--panel-2)" stroke="var(--border)" strokeWidth={1} />
        {grid}

        {/* paper polygon */}
        {capturedCorners.length >= 2 && (
          <g>
            <polygon
              points={polyPoints}
              fill="rgba(255,255,255,0.08)"
              stroke="#e5e5ea"
              strokeWidth={0.8}
            />
            {capturedCorners.length === 4 && (() => {
              const avgX = capturedCorners.reduce((s, c) => s + cornersMap[c][0], 0) / 4;
              const avgY = capturedCorners.reduce((s, c) => s + cornersMap[c][1], 0) / 4;
              const [x0, y0] = cornersMap["tl"] ?? cornersMap[capturedCorners[0]];
              const [x1, y1] = cornersMap["br"] ?? cornersMap[capturedCorners[2]];
              const w = Math.abs(x1 - x0).toFixed(0);
              const h = Math.abs(y1 - y0).toFixed(0);
              return (
                <text
                  x={avgX} y={ty(avgY)}
                  fontSize={6} fill="var(--muted)" textAnchor="middle" dominantBaseline="middle"
                >
                  {w} × {h} mm
                </text>
              );
            })()}
          </g>
        )}
        {/* margin polygon */}
        {marginPolyPoints && (
          <polygon
            points={marginPolyPoints}
            fill="none"
            stroke="#cfd6e4"
            strokeWidth={0.4}
            strokeDasharray="2 2"
          />
        )}
        {!marginPolyPoints && rect && margin > 0 && rect[2] - 2 * margin > 0 && rect[3] - 2 * margin > 0 && (
          <rect
            x={rect[0] + margin} y={ty(rect[1] + rect[3] - margin)}
            width={rect[2] - 2 * margin} height={rect[3] - 2 * margin}
            fill="none" stroke="#cfd6e4" strokeWidth={0.4} strokeDasharray="2 2"
          />
        )}

        {/* active plot area */}
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

        {/* ── Obstacles ──────────────────────────────────────────────────── */}
        {displayObs.map((obs) => {
          const sx = obs.x;
          const sy = ty(obs.y + obs.h);
          const sw = obs.w;
          const sh = obs.h;
          const isSelected = editingObstacles && selectedObsId === obs.id;
          return (
            <g key={obs.id}>
              <rect
                className="obs-body"
                x={sx} y={sy} width={sw} height={sh}
                fill={isSelected ? "rgba(255,59,48,0.28)" : "rgba(255,59,48,0.18)"}
                stroke="rgb(255,59,48)"
                strokeWidth={isSelected ? 1.2 : 0.8}
                strokeDasharray={editingObstacles ? undefined : "3 2"}
                style={{ cursor: editingObstacles ? "pointer" : "default" }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (editingObstacles) setSelectedObsId(isSelected ? null : obs.id);
                }}
              />
              <text
                x={sx + sw / 2} y={sy + sh / 2}
                fontSize={Math.max(4, Math.min(8, sw * 0.3, sh * 0.4))}
                fill="rgba(255,59,48,0.9)"
                textAnchor="middle" dominantBaseline="middle"
                pointerEvents="none"
              >
                {obs.w.toFixed(0)}×{obs.h.toFixed(0)}
              </text>
            </g>
          );
        })}

        {/* corner handles */}
        {CORNER_ORDER.map((name) => {
          const pos = cornersMap[name];
          if (!pos) return null;
          const [cx, cy] = pos;
          return (
            <g key={name}>
              {isDraggable && (
                <circle
                  cx={cx} cy={ty(cy)} r={8}
                  fill="transparent"
                  style={{ cursor: dragging?.corner === name ? "grabbing" : "grab" }}
                  onPointerDown={(e) => handleCornerPointerDown(e, name)}
                />
              )}
              <circle cx={cx} cy={ty(cy)} r={3} fill="var(--ok)" />
              <text x={cx + 4} y={ty(cy) - 3} fontSize={7} fill="var(--ok)">
                {CORNER_LABELS[name] ?? name}
              </text>
            </g>
          );
        })}

        {/* snap indicator */}
        {snapTarget && (
          <circle
            cx={snapTarget[0]} cy={ty(snapTarget[1])} r={5}
            fill="none" stroke="#007aff" strokeWidth={0.8} strokeDasharray="2 1"
          />
        )}

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
