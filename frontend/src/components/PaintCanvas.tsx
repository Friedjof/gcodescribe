import { useRef, useState } from "react";
import type { Calibration, Page, SceneObject } from "../api";
import {
  type Pt,
  type Transform,
  IDENTITY,
  lineWorld,
  rectWorld,
  ellipseWorld,
  semicircleWorld,
  simplify,
  localize,
  objectWorldBounds,
  snapPt,
  toPath,
} from "../paint/geometry";

export type Tool = "select" | "pen" | "line" | "rect" | "circle" | "semicircle" | "text";

function shapeWorld(tool: Tool, pts: Pt[]): Pt[][] {
  if (tool === "pen") return pts.length > 1 ? [pts] : [];
  const [a, b] = pts;
  if (!b) return [];
  if (tool === "line") return [lineWorld(a, b)];
  if (tool === "rect") return [rectWorld(a, b)];
  if (tool === "circle") return [ellipseWorld(a, b)];
  if (tool === "semicircle") return [semicircleWorld(a, b)];
  return [];
}

type Draft = { tool: Tool; points: Pt[] };
type Marquee = { start: Pt; current: Pt; additive: boolean };
type Drag =
  | { mode: "move"; ids: string[]; primaryId: string; startMouse: Pt; startTs: Map<string, Transform> }
  | { mode: "scale"; id: string; center: Pt; startDist: number; startScale: number }
  | { mode: "groupScale"; ids: string[]; center: Pt; startDist: number; startTs: Map<string, Transform> }
  | { mode: "rotate"; id: string; center: Pt; startAngle: number; startRotation: number };

const zValue = (obj: SceneObject, index: number) => obj.zOrder ?? index;

export default function PaintCanvas({
  cal,
  page,
  tool,
  selectedIds,
  onSelect,
  onAdd,
  onUpdate,
  onUpdateMany,
  onEditStart,
  onContextMenuSelection,
  onImageDrop,
  onTextAdd,
}: {
  cal: Calibration;
  page: Page;
  tool: Tool;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onAdd: (obj: SceneObject) => void;
  onUpdate: (id: string, transform: Transform) => void;
  onUpdateMany: (updates: Map<string, Transform>) => void;
  onEditStart: () => void;
  onContextMenuSelection: (ids: string[], x: number, y: number) => void;
  onImageDrop: (file: File, at: Pt) => void;
  onTextAdd: (at: Pt) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const W = cal.plot_width;
  const H = cal.plot_height;
  const step = page.grid?.step ?? 10;
  const snapOn = page.grid?.snap ?? false;
  const major = step * 5;
  const pad = Math.max(W, H) * 0.04 + 4;
  const S = Math.max(W, H);
  const STROKE = S * 0.0045;
  const HANDLE = S * 0.016;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const drag = useRef<Drag | null>(null);

  const objectSelectionIds = (obj: SceneObject) =>
    obj.groupId
      ? page.objects.filter((o) => !o.plotted && o.groupId === obj.groupId).map((o) => o.id)
      : [obj.id];

  const marqueeBounds = (m: Marquee): [number, number, number, number] => [
    Math.min(m.start[0], m.current[0]),
    Math.min(m.start[1], m.current[1]),
    Math.max(m.start[0], m.current[0]),
    Math.max(m.start[1], m.current[1]),
  ];

  const intersects = (a: [number, number, number, number], b: [number, number, number, number]) =>
    a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

  const toMM = (e: React.PointerEvent): Pt => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return [p.x, p.y];
  };

  const clientToMM = (clientX: number, clientY: number): Pt => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return [p.x, p.y];
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
    if (!file) return;
    onImageDrop(file, snapPt(clientToMM(e.clientX, e.clientY), step, snapOn));
  };

  // --- drawing on the background ---
  const onSvgDown = (e: React.PointerEvent) => {
    if (tool === "select") {
      if (e.button !== 0) return;
      const p = toMM(e);
      setMarquee({ start: p, current: p, additive: e.ctrlKey || e.metaKey || e.shiftKey });
      svgRef.current!.setPointerCapture(e.pointerId);
      return;
    }
    if (tool === "text") {
      const p = snapPt(toMM(e), step, snapOn);
      onTextAdd(p);
      return;
    }
    svgRef.current!.setPointerCapture(e.pointerId);
    const p = tool === "pen" ? toMM(e) : snapPt(toMM(e), step, snapOn);
    setDraft({ tool, points: [p, p] });
  };

  const onSvgMove = (e: React.PointerEvent) => {
    if (marquee) {
      setMarquee({ ...marquee, current: toMM(e) });
      return;
    }
    if (draft) {
      if (draft.tool === "pen") {
        const pts = draft.points.slice();
        const coalesced = (e.nativeEvent as any).getCoalescedEvents?.() ?? [e.nativeEvent];
        for (const ce of coalesced) {
          const svg = svgRef.current!;
          const sp = svg.createSVGPoint();
          sp.x = ce.clientX;
          sp.y = ce.clientY;
          const p = sp.matrixTransform(svg.getScreenCTM()!.inverse());
          pts.push([p.x, p.y]);
        }
        setDraft({ ...draft, points: pts });
      } else {
        setDraft({ ...draft, points: [draft.points[0], snapPt(toMM(e), step, snapOn)] });
      }
      return;
    }
    const d = drag.current;
    if (!d) return;
    const m = toMM(e);
    if (d.mode === "move") {
      const primary = d.startTs.get(d.primaryId);
      if (!primary) return;
      let dx = m[0] - d.startMouse[0];
      let dy = m[1] - d.startMouse[1];
      if (snapOn) {
        const [sx, sy] = snapPt([primary.x + dx, primary.y + dy], step, true);
        dx = sx - primary.x;
        dy = sy - primary.y;
      }
      const updates = new Map<string, Transform>();
      for (const id of d.ids) {
        const t = d.startTs.get(id);
        if (t) updates.set(id, { ...t, x: t.x + dx, y: t.y + dy });
      }
      onUpdateMany(updates);
    } else if (d.mode === "scale") {
      const dist = Math.hypot(m[0] - d.center[0], m[1] - d.center[1]);
      const scale = Math.max(0.05, (d.startScale * dist) / (d.startDist || 1));
      const obj = page.objects.find((o) => o.id === d.id);
      if (obj) onUpdate(d.id, { ...(obj.transform ?? IDENTITY), scale });
    } else if (d.mode === "groupScale") {
      const dist = Math.hypot(m[0] - d.center[0], m[1] - d.center[1]);
      const factor = Math.max(0.05, dist / (d.startDist || 1));
      const updates = new Map<string, Transform>();
      for (const id of d.ids) {
        const t = d.startTs.get(id);
        if (!t) continue;
        updates.set(id, {
          ...t,
          x: d.center[0] + (t.x - d.center[0]) * factor,
          y: d.center[1] + (t.y - d.center[1]) * factor,
          scale: Math.max(0.05, t.scale * factor),
        });
      }
      onUpdateMany(updates);
    } else {
      const angle = Math.atan2(m[1] - d.center[1], m[0] - d.center[0]);
      const obj = page.objects.find((o) => o.id === d.id);
      if (obj) onUpdate(d.id, { ...(obj.transform ?? IDENTITY), rotation: d.startRotation + angle - d.startAngle });
    }
  };

  const onSvgUp = (e: React.PointerEvent) => {
    svgRef.current!.releasePointerCapture?.(e.pointerId);
    if (marquee) {
      const mb = marqueeBounds(marquee);
      const isClick = Math.hypot(mb[2] - mb[0], mb[3] - mb[1]) < 1;
      if (isClick) {
        if (!marquee.additive) onSelect([]);
      } else {
        const picked = objectsByZ.flatMap((obj) => {
          if (obj.plotted) return [];
          const bounds = objectWorldBounds((obj.cachedPolylines ?? []) as Pt[][], obj.transform ?? IDENTITY);
          return intersects(mb, bounds) ? objectSelectionIds(obj) : [];
        });
        const next = marquee.additive ? Array.from(new Set([...selectedIds, ...picked])) : Array.from(new Set(picked));
        onSelect(next);
      }
      setMarquee(null);
      return;
    }
    if (draft) {
      const world =
        draft.tool === "pen" ? [simplify(draft.points, 0.4)] : shapeWorld(draft.tool, draft.points);
      const flat = world.flat();
      if (flat.length >= 2) {
        const [x0, y0, x1, y1] = [
          Math.min(...flat.map((p) => p[0])),
          Math.min(...flat.map((p) => p[1])),
          Math.max(...flat.map((p) => p[0])),
          Math.max(...flat.map((p) => p[1])),
        ];
        if (Math.hypot(x1 - x0, y1 - y0) > 1) {
          const { local, cx, cy } = localize(world);
          onAdd({
            id: crypto.randomUUID(),
            type: draft.tool,
            cachedPolylines: local,
            transform: { x: cx, y: cy, rotation: 0, scale: 1 },
            plotted: false,
          });
        }
      }
      setDraft(null);
    }
    drag.current = null;
  };

  const startMove = (e: React.PointerEvent, obj: SceneObject) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    let ids = selectedIds;
    const targetIds = objectSelectionIds(obj);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (additive) {
      const allSelected = targetIds.every((id) => selectedIds.includes(id));
      ids = allSelected
        ? selectedIds.filter((id) => !targetIds.includes(id))
        : Array.from(new Set([...selectedIds, ...targetIds]));
      onSelect(ids);
      if (!ids.includes(obj.id)) return;
    } else if (!selectedIds.includes(obj.id)) {
      ids = targetIds;
      onSelect(ids);
    }
    onEditStart();
    svgRef.current!.setPointerCapture(e.pointerId);
    drag.current = {
      mode: "move",
      ids,
      primaryId: obj.id,
      startMouse: toMM(e),
      startTs: new Map(
        page.objects
          .filter((o) => ids.includes(o.id))
          .map((o) => [o.id, { ...(o.transform ?? IDENTITY) }])
      ),
    };
  };

  const openContextMenu = (e: React.MouseEvent, obj: SceneObject) => {
    e.preventDefault();
    e.stopPropagation();
    const targetIds = objectSelectionIds(obj);
    const ids = selectedIds.includes(obj.id) ? selectedIds : targetIds;
    if (!selectedIds.includes(obj.id)) onSelect(ids);
    onContextMenuSelection(ids, e.clientX, e.clientY);
  };

  const startScale = (e: React.PointerEvent, obj: SceneObject, center: Pt) => {
    e.stopPropagation();
    onEditStart();
    svgRef.current!.setPointerCapture(e.pointerId);
    const m = toMM(e);
    drag.current = {
      mode: "scale",
      id: obj.id,
      center,
      startDist: Math.hypot(m[0] - center[0], m[1] - center[1]),
      startScale: (obj.transform ?? IDENTITY).scale,
    };
  };

  const startGroupScale = (e: React.PointerEvent, ids: string[], center: Pt) => {
    e.stopPropagation();
    onEditStart();
    svgRef.current!.setPointerCapture(e.pointerId);
    const m = toMM(e);
    drag.current = {
      mode: "groupScale",
      ids,
      center,
      startDist: Math.hypot(m[0] - center[0], m[1] - center[1]),
      startTs: new Map(
        page.objects
          .filter((o) => ids.includes(o.id))
          .map((o) => [o.id, { ...(o.transform ?? IDENTITY) }])
      ),
    };
  };

  const startRotate = (e: React.PointerEvent, obj: SceneObject, center: Pt) => {
    e.stopPropagation();
    onEditStart();
    svgRef.current!.setPointerCapture(e.pointerId);
    const m = toMM(e);
    const t = obj.transform ?? IDENTITY;
    drag.current = {
      mode: "rotate",
      id: obj.id,
      center,
      startAngle: Math.atan2(m[1] - center[1], m[0] - center[0]),
      startRotation: t.rotation,
    };
  };

  const objTransform = (t: Transform) =>
    `translate(${t.x} ${t.y}) rotate(${(t.rotation * 180) / Math.PI}) scale(${t.scale})`;

  const draftWorld = draft
    ? draft.tool === "pen"
      ? [draft.points]
      : shapeWorld(draft.tool, draft.points)
    : [];

  const objectsByZ = page.objects
    .map((obj, index) => ({ obj, index }))
    .sort((a, b) => zValue(a.obj, a.index) - zValue(b.obj, b.index))
    .map(({ obj }) => obj);

  const selectedObjects = objectsByZ.filter((obj) => selectedIds.includes(obj.id) && !obj.plotted);
  const selectedBounds = selectedObjects.length > 1
    ? selectedObjects.reduce<[number, number, number, number] | null>((acc, obj) => {
        const b = objectWorldBounds((obj.cachedPolylines ?? []) as Pt[][], obj.transform ?? IDENTITY);
        if (!acc) return b;
        return [Math.min(acc[0], b[0]), Math.min(acc[1], b[1]), Math.max(acc[2], b[2]), Math.max(acc[3], b[3])];
      }, null)
    : null;

  return (
    <div className="paint-canvas">
      <svg
        ref={svgRef}
        viewBox={`${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ cursor: tool === "select" ? "default" : "crosshair", touchAction: "none" }}
        onPointerDown={onSvgDown}
        onPointerMove={onSvgMove}
        onPointerUp={onSvgUp}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <defs>
          <pattern id="pc-grid-minor" width={step} height={step} patternUnits="userSpaceOnUse">
            <path d={`M ${step} 0 L 0 0 L 0 ${step}`} fill="none"
              stroke="rgba(255,255,255,0.06)" strokeWidth={0.25} />
          </pattern>
          <pattern id="pc-grid-major" width={major} height={major} patternUnits="userSpaceOnUse">
            <rect width={major} height={major} fill="url(#pc-grid-minor)" />
            <path d={`M ${major} 0 L 0 0 L 0 ${major}`} fill="none"
              stroke="rgba(255,255,255,0.13)" strokeWidth={0.4} />
          </pattern>
        </defs>

        <rect x={0} y={0} width={W} height={H} rx={1.5} fill="#101013"
          stroke="var(--accent)" strokeWidth={0.6} />
        <rect x={0} y={0} width={W} height={H} fill="url(#pc-grid-major)" />

        {/* objects */}
        {objectsByZ.map((obj) => {
          const t = obj.transform ?? IDENTITY;
          return (
            <g
              key={obj.id}
              transform={objTransform(t)}
              opacity={obj.plotted ? 0.25 : 1}
              style={{ pointerEvents: "none" }}
            >
              {(obj.cachedPolylines ?? []).map((line, i) => (
                <path key={i} d={toPath(line as Pt[])} fill="none"
                  stroke={obj.plotted ? "var(--muted)" : "var(--busy)"}
                  strokeWidth={STROKE / t.scale} strokeLinejoin="round" strokeLinecap="round" />
              ))}
            </g>
          );
        })}

        {/* live draft preview */}
        {draftWorld.map((line, i) => (
          <path key={`d${i}`} d={toPath(line as Pt[])} fill="none"
            stroke="var(--busy)" strokeWidth={STROKE} strokeDasharray={`${STROKE * 2} ${STROKE}`}
            strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {marquee && (() => {
          const [x0, y0, x1, y1] = marqueeBounds(marquee);
          return (
            <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0}
              fill="rgba(10,132,255,0.12)" stroke="var(--accent)" strokeWidth={STROKE}
              strokeDasharray={`${STROKE * 2} ${STROKE}`} />
          );
        })()}

        {/* selection: hit areas (select tool) + handles for the selected one */}
        {tool === "select" &&
          objectsByZ.map((obj) => {
            if (obj.plotted) return null;
            const t = obj.transform ?? IDENTITY;
            const [bx0, by0, bx1, by1] = objectWorldBounds(
              (obj.cachedPolylines ?? []) as Pt[][], t
            );
            const m = STROKE * 2;
            const sel = selectedIds.includes(obj.id);
            const singleSel = selectedIds.length === 1 && sel;
            const cx = t.x;
            const cy = t.y;
            const rcx = (bx0 + bx1) / 2;
            const rcy = by0 - HANDLE * 1.2;
            return (
              <g key={`s${obj.id}`}>
                <rect
                  x={bx0 - m} y={by0 - m} width={bx1 - bx0 + 2 * m} height={by1 - by0 + 2 * m}
                  fill="transparent"
                  stroke={sel ? "var(--accent)" : "transparent"}
                  strokeWidth={STROKE} strokeDasharray={`${STROKE * 2} ${STROKE}`}
                  style={{ cursor: "move" }}
                  onPointerDown={(e) => startMove(e, obj)}
                  onContextMenu={(e) => openContextMenu(e, obj)}
                />
                {singleSel && (
                  <>
                    <line x1={rcx} y1={by0} x2={rcx} y2={rcy}
                      stroke="var(--accent)" strokeWidth={STROKE} strokeDasharray={`${STROKE} ${STROKE}`} />
                    <circle
                      cx={rcx} cy={rcy} r={HANDLE / 2}
                      fill="var(--panel)" stroke="var(--accent)" strokeWidth={STROKE}
                      style={{ cursor: "grab" }}
                      onPointerDown={(e) => startRotate(e, obj, [cx, cy])}
                    />
                    <circle
                      cx={bx1 + m} cy={by1 + m} r={HANDLE / 2}
                      fill="var(--accent)" stroke="#fff" strokeWidth={STROKE / 2}
                      style={{ cursor: "nwse-resize" }}
                      onPointerDown={(e) => startScale(e, obj, [cx, cy])}
                    />
                  </>
                )}
              </g>
            );
          })}

        {tool === "select" && selectedBounds && (() => {
          const [bx0, by0, bx1, by1] = selectedBounds;
          const m = STROKE * 3;
          const cx = (bx0 + bx1) / 2;
          const cy = (by0 + by1) / 2;
          return (
            <g>
              <rect
                x={bx0 - m} y={by0 - m} width={bx1 - bx0 + 2 * m} height={by1 - by0 + 2 * m}
                fill="none" stroke="var(--accent)" strokeWidth={STROKE * 1.2}
                strokeDasharray={`${STROKE * 3} ${STROKE * 1.5}`}
                pointerEvents="none"
              />
              <circle
                cx={bx1 + m} cy={by1 + m} r={HANDLE / 2}
                fill="var(--accent)" stroke="#fff" strokeWidth={STROKE / 2}
                style={{ cursor: "nwse-resize" }}
                onPointerDown={(e) => startGroupScale(e, selectedObjects.map((obj) => obj.id), [cx, cy])}
              />
            </g>
          );
        })()}

        <text x={W / 2} y={H + pad * 0.7} fontSize={S * 0.022}
          fill="var(--muted)" textAnchor="middle">
          {W.toFixed(0)} × {H.toFixed(0)} mm
        </text>
      </svg>
    </div>
  );
}
