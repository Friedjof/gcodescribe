import { useRef, useState, useEffect } from "react";
import type { Calibration, GcodePreview, Obstacle, Position, PositionKind } from "../../api";
import { useI18n } from "../../i18n";
import { SPECIAL_POSITIONS, positionDefinition, type PositionTarget } from "./specialPositions";
import { formatSize, paperCornerAngles, plotArea, plotAreaBase, type PaperFormat } from "./paperLayout";

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
  preview,
  onMoveTo,
  onDragCorner,
  onDropCorner,
  formatPreview,
  obstacles,
  editingObstacles,
  onObstaclesChange,
  selectedPosition = null,
  target = null,
}: {
  cal: Calibration;
  position: Position | null;
  rect: [number, number, number, number] | null;
  preview: GcodePreview | null;
  onMoveTo?: (x: number, y: number) => void;
  onDragCorner?: (corner: string, x: number, y: number) => void;
  onDropCorner?: (corner: string, x: number, y: number) => void;
  formatPreview?: { format: PaperFormat; landscape: boolean };
  obstacles?: Obstacle[];
  editingObstacles?: boolean;
  onObstaclesChange?: (obstacles: Obstacle[]) => void;
  selectedPosition?: PositionKind | null;
  target?: PositionTarget | null;
}) {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const W = cal.bed_width;
  const H = cal.bed_height;
  const ty = (y: number) => H - y;

  const [dragging, setDragging] = useState<{ corner: string; pointerId: number } | null>(null);
  const [snapTarget, setSnapTarget] = useState<[number, number] | null>(null);
  const suppressClick = useRef(false);

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
    if (dragging || !svgRef.current) return;
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (!onMoveTo) return;
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
    suppressClick.current = true;
    setDragging({ corner, pointerId: e.pointerId });
    setSnapTarget(null);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging) return;
    const coords = svgBedCoords(e);
    if (!coords) return;
    const [x, y] = coords;
    const snap = snapTo90(cal.paper_corners, dragging.corner, x, y);
    setSnapTarget(snap);
    onDragCorner?.(dragging.corner, snap ? snap[0] : x, snap ? snap[1] : y);
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging) return;
    const coords = svgBedCoords(e);
    if (coords) {
      const [x, y] = coords;
      const snap = snapTo90(cal.paper_corners, dragging.corner, x, y);
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
  const angles = paperCornerAngles(cornersMap);
  const drawingArea = plotArea(cal);
  const area = plotAreaBase(cal);
  const format = formatPreview ? formatSize(formatPreview.format, formatPreview.landscape) : null;
  const formatX = format ? area.x + (area.w - format.w) / 2 : 0;
  const formatY = format ? area.y + (area.h - format.h) / 2 : 0;
  const viewLeft = Math.min(0, formatX, area.x, drawingArea.x) - 8;
  const viewRight = Math.max(W, formatX + (format?.w ?? 0), area.x + area.w, drawingArea.x + drawingArea.w) + 8;
  const viewBottom = Math.min(0, formatY, area.y, drawingArea.y) - 8;
  const viewTop = Math.max(H, formatY + (format?.h ?? 0), area.y + area.h, drawingArea.y + drawingArea.h) + 8;
  const capturedCorners = CORNER_ORDER.filter((c) => cornersMap[c] != null);
  const isDraggable = !!(onDragCorner || onDropCorner);

  const polyPoints = capturedCorners
    .map((c) => {
      const [cx, cy] = cornersMap[c];
      return `${cx},${ty(cy)}`;
    })
    .join(" ");

  const displayObs = obstacles ?? [];
  return (
    <div className="liveview">
      <svg
        ref={svgRef}
        viewBox={`${viewLeft} ${H - viewTop} ${viewRight - viewLeft} ${viewTop - viewBottom}`}
        onClick={handleClick}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          setDragging(null); setSnapTarget(null); suppressClick.current = false;
        }}
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
              fill="var(--paper)"
              stroke="var(--paper-border)"
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
        {format && formatPreview && (
          <g pointerEvents="none" role="img" aria-label={`${formatPreview.format.id} ${format.w} × ${format.h} mm`}>
            <title>{t("paper.formatPassive")}</title>
            <rect x={formatX} y={ty(formatY + format.h)} width={format.w} height={format.h}
              fill="rgba(160,165,175,0.08)" stroke="#aab0bb" strokeWidth={1.2} strokeDasharray="5 2" />
            <text x={formatX + format.w / 2} y={ty(formatY + format.h / 2)}
              fontSize={Math.min(11, Math.max(6, format.w * 0.07))}
              fill="#aab0bb" fontWeight="bold"
              textAnchor="middle" dominantBaseline="middle">{formatPreview.format.id}</text>
          </g>
        )}
        <g pointerEvents="none" role="img" aria-label={t("paper.drawingArea")}>
          <rect x={drawingArea.x} y={ty(drawingArea.y + drawingArea.h)}
            width={drawingArea.w} height={drawingArea.h}
            fill="none" stroke="var(--muted)" strokeWidth={0.6} strokeDasharray="3 2" />
        </g>

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
          const angle = angles?.[name];
          const angleOk = angle != null && Math.abs(angle - 90) <= 1;
          const color = angle == null || angleOk ? "var(--ok)" : "var(--warn)";
          const rightSide = name === "tr" || name === "br";
          const topSide = name === "tl" || name === "tr";
          return (
            <g key={name}>
              {isDraggable && (
                <circle
                  cx={cx} cy={ty(cy)} r={8}
                  fill="transparent"
                  style={{
                    cursor: dragging?.corner === name ? "grabbing" : "grab",
                  }}
                  onPointerDown={(e) => handleCornerPointerDown(e, name)}
                />
              )}
              <circle cx={cx} cy={ty(cy)} r={3} fill={color} />
              <text x={cx + (rightSide ? -5 : 5)} y={ty(cy) + (topSide ? 9 : -5)}
                textAnchor={rightSide ? "end" : "start"} fontSize={7} fill={color} pointerEvents="none">
                {CORNER_LABELS[name] ?? name}{angle == null ? "" : ` ${angle.toFixed(1)}°`}
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

        {/* Saved markers never intercept clicks or save by dragging. */}
        {SPECIAL_POSITIONS.map((point) => (
          <PositionMarker key={point.kind} x={cal[point.x]} y={ty(cal[point.y])} width={W}
            label={point.marker} color={point.color} selected={selectedPosition === point.kind} />
        ))}
        {target && (
          <PositionMarker x={target.x} y={ty(target.y)} width={W} draft
            label={`${positionDefinition(target.kind).marker} · ${t("paper.positions.target")}`}
            color={positionDefinition(target.kind).color} />
        )}

        {/* head position */}
        {position && position.homed && (
          <g pointerEvents="none">
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

function PositionMarker({ x, y, width, label, color, selected = false, draft = false }: {
  x: number; y: number; width: number; label: string; color: string; selected?: boolean; draft?: boolean;
}) {
  const leftLabel = x > width - 25;
  return (
    <g pointerEvents="none" role="img" aria-label={label} className={draft ? "position-marker-draft" : "position-marker-saved"}>
      {selected && <circle cx={x} cy={y} r={7} fill="none" stroke={color} strokeWidth={0.35} opacity={0.65} />}
      <circle cx={x} cy={y} r={draft ? 6 : 4.5} fill="none" stroke={color}
        strokeWidth={0.75} strokeDasharray={draft ? "1.5 1.2" : undefined} />
      <path d={`M${x - 2} ${y - 2}L${x + 2} ${y + 2}M${x - 2} ${y + 2}L${x + 2} ${y - 2}`}
        fill="none" stroke={color} strokeWidth={0.65} />
      <text x={x + (leftLabel ? -8 : 8)} y={Math.max(5, y - (draft ? 9 : 4))} fontSize={5.5}
        textAnchor={leftLabel ? "end" : "start"} fill={color} fontWeight="bold">{label}</text>
    </g>
  );
}
