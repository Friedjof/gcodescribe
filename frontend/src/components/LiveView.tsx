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

// ── Obstacle drag state ────────────────────────────────────────────────────
type ObsDrag =
  | { mode: "create"; x0: number; y0: number; x1: number; y1: number }
  | { mode: "move"; id: string; startBedX: number; startBedY: number; origX: number; origY: number }
  | { mode: "resize"; id: string; handle: "tl" | "tr" | "br" | "bl"; orig: Obstacle };

function newObstacleId() {
  return `obs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function obsFromDrag(drag: Extract<ObsDrag, { mode: "create" }>): Obstacle {
  const x = Math.min(drag.x0, drag.x1);
  const y = Math.min(drag.y0, drag.y1);
  const w = Math.max(1, Math.abs(drag.x1 - drag.x0));
  const h = Math.max(1, Math.abs(drag.y1 - drag.y0));
  return { id: newObstacleId(), x, y, w, h };
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

  // Obstacle edit state
  const [localObs, setLocalObs] = useState<Obstacle[]>(obstacles ?? []);
  const [selectedObsId, setSelectedObsId] = useState<string | null>(null);
  const [obsDrag, setObsDrag] = useState<ObsDrag | null>(null);

  useEffect(() => { setLocalObs(obstacles ?? []); }, [obstacles]);

  // Deselect when leaving edit mode
  useEffect(() => {
    if (!editingObstacles) {
      setSelectedObsId(null);
      setObsDrag(null);
    }
  }, [editingObstacles]);

  const svgBedCoords = (
    e: { clientX: number; clientY: number },
    snap: boolean
  ): [number, number] | null => {
    if (!svgRef.current) return null;
    const pt = svgRef.current.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return null;
    const p = pt.matrixTransform(ctm.inverse());
    const bx = Math.max(0, Math.min(W, snap ? Math.round(p.x * 10) / 10 : p.x));
    const by = Math.max(0, Math.min(H, snap ? Math.round(ty(p.y) * 10) / 10 : ty(p.y)));
    return [bx, by];
  };

  const svgCoords = (e: React.PointerEvent<SVGSVGElement>) => svgBedCoords(e, true);
  const svgCoordsRaw = (e: { clientX: number; clientY: number }) => svgBedCoords(e, false);

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (editingObstacles) {
      // Clicking on SVG background deselects
      setSelectedObsId(null);
      return;
    }
    if (!onMoveTo || dragging || !svgRef.current) return;
    const pt = svgRef.current.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return;
    const p = pt.matrixTransform(ctm.inverse());
    if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) return;
    onMoveTo(Math.round(p.x * 10) / 10, Math.round(ty(p.y) * 10) / 10);
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

  // ── Obstacle drag handlers ─────────────────────────────────────────────
  const handleObsBodyPointerDown = (
    e: React.PointerEvent<SVGRectElement>,
    obs: Obstacle
  ) => {
    if (!editingObstacles) return;
    e.stopPropagation();
    (e.target as SVGRectElement).setPointerCapture(e.pointerId);
    setSelectedObsId(obs.id);
    const coords = svgCoordsRaw(e);
    if (!coords) return;
    setObsDrag({ mode: "move", id: obs.id, startBedX: coords[0], startBedY: coords[1], origX: obs.x, origY: obs.y });
  };

  const handleObsHandlePointerDown = (
    e: React.PointerEvent<SVGRectElement>,
    obs: Obstacle,
    handle: "tl" | "tr" | "br" | "bl"
  ) => {
    if (!editingObstacles) return;
    e.stopPropagation();
    (e.target as SVGRectElement).setPointerCapture(e.pointerId);
    setObsDrag({ mode: "resize", id: obs.id, handle, orig: { ...obs } });
  };

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!editingObstacles || dragging) return;
    // Only start creating if clicking on background (not on an obstacle)
    if ((e.target as Element).closest(".obs-body, .obs-handle")) return;
    const coords = svgCoordsRaw(e);
    if (!coords) return;
    setSelectedObsId(null);
    setObsDrag({ mode: "create", x0: coords[0], y0: coords[1], x1: coords[0], y1: coords[1] });
    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    // Paper corner drag
    if (dragging) {
      const coords = svgCoords(e);
      if (!coords) return;
      const [x, y] = coords;
      const snap = snapTo90(
        cal.paper_corners as Record<string, [number, number]>,
        dragging.corner, x, y
      );
      setSnapTarget(snap);
      const finalX = snap ? snap[0] : x;
      const finalY = snap ? snap[1] : y;
      onDragCorner?.(dragging.corner, finalX, finalY);
      return;
    }

    // Obstacle drag
    if (!obsDrag) return;
    const coords = svgCoordsRaw(e);
    if (!coords) return;
    const [bx, by] = coords;

    if (obsDrag.mode === "create") {
      setObsDrag({ ...obsDrag, x1: bx, y1: by });
    } else if (obsDrag.mode === "move") {
      const dx = bx - obsDrag.startBedX;
      const dy = by - obsDrag.startBedY;
      setLocalObs((prev) =>
        prev.map((o) =>
          o.id !== obsDrag.id ? o : {
            ...o,
            x: Math.max(0, Math.round((obsDrag.origX + dx) * 10) / 10),
            y: Math.max(0, Math.round((obsDrag.origY + dy) * 10) / 10),
          }
        )
      );
    } else if (obsDrag.mode === "resize") {
      const orig = obsDrag.orig;
      setLocalObs((prev) =>
        prev.map((o) => {
          if (o.id !== obsDrag.id) return o;
          const handle = obsDrag.handle;
          let nx = orig.x, ny = orig.y, nw = orig.w, nh = orig.h;
          // Each corner handle moves that corner; opposite corner stays fixed
          if (handle === "bl") {
            nx = Math.min(bx, orig.x + orig.w - 1);
            ny = Math.min(by, orig.y + orig.h - 1);
            nw = orig.x + orig.w - nx;
            nh = orig.y + orig.h - ny;
          } else if (handle === "br") {
            ny = Math.min(by, orig.y + orig.h - 1);
            nw = Math.max(1, bx - orig.x);
            nh = orig.y + orig.h - ny;
            nx = orig.x;
          } else if (handle === "tr") {
            nw = Math.max(1, bx - orig.x);
            nh = Math.max(1, by - orig.y);
            nx = orig.x; ny = orig.y;
          } else { // tl
            nx = Math.min(bx, orig.x + orig.w - 1);
            nh = Math.max(1, by - orig.y);
            nw = orig.x + orig.w - nx;
            ny = orig.y;
          }
          return { ...o, x: Math.round(nx * 10) / 10, y: Math.round(ny * 10) / 10, w: Math.round(nw * 10) / 10, h: Math.round(nh * 10) / 10 };
        })
      );
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    // Paper corner drop
    if (dragging) {
      const coords = svgCoords(e);
      if (coords) {
        const [x, y] = coords;
        const snap = snapTo90(
          cal.paper_corners as Record<string, [number, number]>,
          dragging.corner, x, y
        );
        const finalX = snap ? snap[0] : x;
        const finalY = snap ? snap[1] : y;
        onDropCorner?.(dragging.corner, finalX, finalY);
      }
      setDragging(null);
      setSnapTarget(null);
      return;
    }

    // Obstacle drop
    if (!obsDrag) return;
    let nextObs = localObs;

    if (obsDrag.mode === "create") {
      const coords = svgCoordsRaw(e);
      if (coords) {
        const finalDrag = { ...obsDrag, x1: coords[0], y1: coords[1] };
        const w = Math.abs(finalDrag.x1 - finalDrag.x0);
        const h = Math.abs(finalDrag.y1 - finalDrag.y0);
        if (w >= 3 && h >= 3) {
          const newObs = obsFromDrag(finalDrag);
          nextObs = [...localObs, newObs];
          setLocalObs(nextObs);
          setSelectedObsId(newObs.id);
        }
      }
    }
    // move / resize: localObs already updated during pointermove

    setObsDrag(null);
    onObstaclesChange?.(nextObs);
  };

  // Obstacle creation rubber-band preview
  const createPreview = obsDrag?.mode === "create" ? (() => {
    const x = Math.min(obsDrag.x0, obsDrag.x1);
    const y = Math.min(obsDrag.y0, obsDrag.y1);
    const w = Math.abs(obsDrag.x1 - obsDrag.x0);
    const h = Math.abs(obsDrag.y1 - obsDrag.y0);
    if (w < 1 || h < 1) return null;
    return { x, y, w, h };
  })() : null;

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

  const displayObs = obsDrag?.mode === "create" ? localObs : localObs;
  const HANDLE_SIZE = Math.max(3, Math.min(W, H) * 0.02);

  return (
    <div className="liveview">
      <svg
        ref={svgRef}
        viewBox={`-8 -8 ${W + 16} ${H + 16}`}
        onClick={handleClick}
        onPointerDown={editingObstacles ? handleSvgPointerDown : undefined}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          cursor: obsDrag?.mode === "create"
            ? "crosshair"
            : obsDrag
            ? "grabbing"
            : dragging ? "grabbing"
            : editingObstacles ? "crosshair"
            : onMoveTo ? "crosshair" : "default",
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
              {/* body */}
              <rect
                className="obs-body"
                x={sx} y={sy} width={sw} height={sh}
                fill={isSelected ? "rgba(255,59,48,0.25)" : "rgba(255,59,48,0.18)"}
                stroke="rgb(255,59,48)"
                strokeWidth={isSelected ? 1.2 : 0.8}
                strokeDasharray={editingObstacles ? undefined : "3 2"}
                style={{ cursor: editingObstacles ? "move" : "default" }}
                onPointerDown={editingObstacles ? (e) => handleObsBodyPointerDown(e, obs) : undefined}
                onClick={(e) => { e.stopPropagation(); if (editingObstacles) setSelectedObsId(obs.id); }}
              />
              {/* label */}
              <text
                x={sx + sw / 2} y={sy + sh / 2}
                fontSize={Math.max(4, Math.min(8, sw * 0.3, sh * 0.4))}
                fill="rgba(255,59,48,0.9)"
                textAnchor="middle" dominantBaseline="middle"
                pointerEvents="none"
              >
                {obs.w.toFixed(0)}×{obs.h.toFixed(0)}
              </text>
              {/* resize handles (only when selected) */}
              {isSelected && ([
                ["tl", sx, sy] as const,
                ["tr", sx + sw, sy] as const,
                ["br", sx + sw, sy + sh] as const,
                ["bl", sx, sy + sh] as const,
              ]).map(([handle, hx, hy]) => (
                <rect
                  key={handle}
                  className="obs-handle"
                  x={hx - HANDLE_SIZE / 2} y={hy - HANDLE_SIZE / 2}
                  width={HANDLE_SIZE} height={HANDLE_SIZE}
                  fill="white"
                  stroke="rgb(255,59,48)"
                  strokeWidth={0.8}
                  style={{ cursor: "nwse-resize" }}
                  onPointerDown={(e) => handleObsHandlePointerDown(e, obs, handle)}
                  onClick={(e) => e.stopPropagation()}
                />
              ))}
            </g>
          );
        })}

        {/* Obstacle creation rubber-band */}
        {createPreview && (
          <rect
            x={createPreview.x}
            y={ty(createPreview.y + createPreview.h)}
            width={createPreview.w}
            height={createPreview.h}
            fill="rgba(255,59,48,0.12)"
            stroke="rgb(255,59,48)"
            strokeWidth={0.8}
            strokeDasharray="3 2"
            pointerEvents="none"
          />
        )}

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
