import { useEffect, useRef, useState } from "react";
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
  bounds,
  snapPt,
  toPath,
  toMultiPath,
  alignmentCandidates,
  snapToGuides,
  type Bounds,
  type GuideCandidate,
  type Guide,
} from "../paint/geometry";
import { useI18n } from "../i18n";

export type Tool = "select" | "pen" | "line" | "rect" | "circle" | "semicircle" | "text";

/**
 * Clamp a transform so the object's world bounding box stays within [0,W]×[0,H].
 * First scales down if the object is larger than the canvas, then shifts to fit.
 */
function clampedTransform(t: Transform, local: Pt[][], W: number, H: number): Transform {
  if (!local.length) return t;
  const [bx0, by0, bx1, by1] = objectWorldBounds(local, t);
  // Fast path — already in bounds.
  if (bx0 >= 0 && by0 >= 0 && bx1 <= W && by1 <= H) return t;

  const bw = bx1 - bx0, bh = by1 - by0;
  const sx = t.scaleX ?? t.scale;
  const sy = t.scaleY ?? t.scale;

  // If the object is larger than the canvas, scale it down uniformly to fit.
  const shrink = Math.min(bw > W ? W / bw : 1, bh > H ? H / bh : 1);
  const nsx = sx * shrink;
  const nsy = sy * shrink;
  const shrunken: Transform = shrink < 1
    ? { ...t, x: W / 2, y: H / 2, scaleX: nsx, scaleY: nsy, scale: Math.max(nsx, nsy) }
    : t;

  // After potential shrink, get the new bounds and shift into the canvas.
  const [nx0, ny0, nx1, ny1] = objectWorldBounds(local, shrunken);
  let dx = 0, dy = 0;
  if (nx0 < 0) dx = -nx0; else if (nx1 > W) dx = W - nx1;
  if (ny0 < 0) dy = -ny0; else if (ny1 > H) dy = H - ny1;
  return { ...shrunken, x: shrunken.x + dx, y: shrunken.y + dy };
}

type ResizeEdge = "tl" | "tc" | "tr" | "ml" | "mr" | "bl" | "bc" | "br";
export type ViewRotation = 0 | 90 | 180 | 270;

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
type ViewBox = { x: number; y: number; w: number; h: number };
type Drag =
  | { mode: "move"; ids: string[]; primaryId: string; startMouse: Pt; startTs: Map<string, Transform>; startBoundsAll: [number, number, number, number]; vGuides: GuideCandidate[]; hGuides: GuideCandidate[] }
  | { mode: "resize"; id: string; edge: ResizeEdge; startBounds: [number, number, number, number]; startLocalBounds: [number, number, number, number] }
  | { mode: "groupScale"; ids: string[]; center: Pt; startDist: number; startTs: Map<string, Transform> }
  | { mode: "rotate"; id: string; center: Pt; startAngle: number; startRotation: number };

const cl = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const zValue = (obj: SceneObject, index: number) => obj.zOrder ?? index;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 12;

function rotatePoint([x, y]: Pt, W: number, H: number, deg: ViewRotation): Pt {
  const cx = W / 2;
  const cy = H / 2;
  const dx = x - cx;
  const dy = y - cy;
  if (deg === 90) return [cx - dy, cy + dx];
  if (deg === 180) return [cx - dx, cy - dy];
  if (deg === 270) return [cx + dy, cy - dx];
  return [x, y];
}

function rotatedBounds(W: number, H: number, deg: ViewRotation): [number, number, number, number] {
  const pts = [[0, 0], [W, 0], [W, H], [0, H]].map((p) => rotatePoint(p as Pt, W, H, deg));
  return [
    Math.min(...pts.map((p) => p[0])),
    Math.min(...pts.map((p) => p[1])),
    Math.max(...pts.map((p) => p[0])),
    Math.max(...pts.map((p) => p[1])),
  ];
}

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
  onCursorMove,
  onCursorClick,
  viewRotation,
  onViewRotationChange,
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
  onCursorMove?: (cursor: { x: number; y: number; inside: boolean; tool: Tool }) => void;
  onCursorClick?: (click: { x: number; y: number; tool: Tool }) => void;
  viewRotation: ViewRotation;
  onViewRotationChange: (rotation: ViewRotation) => void;
}) {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const W = cal.plot_width;
  const H = cal.plot_height;
  const step = page.grid?.step ?? 10;
  const snapOn = page.grid?.snap ?? false;
  const major = step * 5;
  const pad = Math.max(W, H) * 0.04 + 4;
  const S = Math.max(W, H);
  const viewBounds = rotatedBounds(W, H, viewRotation);
  const baseView: ViewBox = {
    x: viewBounds[0] - pad,
    y: viewBounds[1] - pad,
    w: viewBounds[2] - viewBounds[0] + 2 * pad,
    h: viewBounds[3] - viewBounds[1] + 2 * pad,
  };

  const [draft, setDraft] = useState<Draft | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [view, setView] = useState<ViewBox>(baseView);
  const [spaceDown, setSpaceDown] = useState(false);
  const drag = useRef<Drag | null>(null);
  const pan = useRef<{ pointerId: number; startClient: Pt; startView: ViewBox } | null>(null);
  const zoom = baseView.w / view.w;
  const STROKE = (S * 0.0045) / zoom;
  const HANDLE = (S * 0.016) / zoom;

  // How close (mm) a moving edge/center must come to a reference before it
  // snaps. Scaled to the plot area so it feels the same regardless of size.
  const SNAP_TOL = S * 0.008;

  useEffect(() => {
    setView(baseView);
  }, [baseView.x, baseView.y, baseView.w, baseView.h]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const clampView = (next: ViewBox): ViewBox => {
    const x = next.w >= baseView.w
      ? baseView.x + (baseView.w - next.w) / 2
      : cl(next.x, baseView.x, baseView.x + baseView.w - next.w);
    const y = next.h >= baseView.h
      ? baseView.y + (baseView.h - next.h) / 2
      : cl(next.y, baseView.y, baseView.y + baseView.h - next.h);
    return { ...next, x, y };
  };

  const zoomAt = (factor: number, anchor?: Pt) => {
    setView((current) => {
      const currentZoom = baseView.w / current.w;
      const nextZoom = cl(currentZoom * factor, MIN_ZOOM, MAX_ZOOM);
      const nextW = baseView.w / nextZoom;
      const nextH = baseView.h / nextZoom;
      const a = anchor ?? [current.x + current.w / 2, current.y + current.h / 2];
      return clampView({
        x: a[0] - (a[0] - current.x) * (nextW / current.w),
        y: a[1] - (a[1] - current.y) * (nextH / current.h),
        w: nextW,
        h: nextH,
      });
    });
  };

  const resetZoom = () => setView(baseView);

  // Wrappers that enforce the hard plot-area boundary before every transform write.
  const updateSafe = (id: string, t: Transform) => {
    const obj = page.objects.find((o) => o.id === id);
    const local = (obj?.cachedPolylines ?? []) as Pt[][];
    onUpdate(id, clampedTransform(t, local, W, H));
  };
  const updateManySafe = (updates: Map<string, Transform>) => {
    const out = new Map<string, Transform>();
    for (const [id, t] of updates) {
      const obj = page.objects.find((o) => o.id === id);
      const local = (obj?.cachedPolylines ?? []) as Pt[][];
      out.set(id, clampedTransform(t, local, W, H));
    }
    onUpdateMany(out);
  };

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
    return rotatePoint([p.x, p.y], W, H, ((360 - viewRotation) % 360) as ViewRotation);
  };

  const emitCursor = (e: React.PointerEvent) => {
    if (!onCursorMove) return;
    const [x, y] = toMM(e);
    onCursorMove({
      x: W > 0 ? Math.max(0, Math.min(1, x / W)) : 0,
      y: H > 0 ? Math.max(0, Math.min(1, y / H)) : 0,
      inside: x >= 0 && x <= W && y >= 0 && y <= H,
      tool,
    });
  };

  const emitClick = (e: React.PointerEvent) => {
    if (!onCursorClick || e.button !== 0) return;
    const [x, y] = toMM(e);
    if (x < 0 || x > W || y < 0 || y > H) return;
    onCursorClick({ x: W > 0 ? x / W : 0, y: H > 0 ? y / H : 0, tool });
  };

  const clientToMM = (clientX: number, clientY: number): Pt => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return rotatePoint([p.x, p.y], W, H, ((360 - viewRotation) % 360) as ViewRotation);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
    if (!file) return;
    onImageDrop(file, snapPt(clientToMM(e.clientX, e.clientY), step, snapOn));
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    zoomAt(factor, rotatePoint(clientToMM(e.clientX, e.clientY), W, H, viewRotation));
  };

  const onSvgDown = (e: React.PointerEvent) => {
    if (e.button === 0 && spaceDown) {
      e.preventDefault();
      pan.current = { pointerId: e.pointerId, startClient: [e.clientX, e.clientY], startView: view };
      svgRef.current!.setPointerCapture(e.pointerId);
      return;
    }
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
    emitCursor(e);
    if (pan.current) {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const dx = ((e.clientX - pan.current.startClient[0]) / rect.width) * pan.current.startView.w;
      const dy = ((e.clientY - pan.current.startClient[1]) / rect.height) * pan.current.startView.h;
      setView(clampView({ ...pan.current.startView, x: pan.current.startView.x - dx, y: pan.current.startView.y - dy }));
      return;
    }
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
          pts.push(rotatePoint([p.x, p.y], W, H, ((360 - viewRotation) % 360) as ViewRotation));
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
      // Alignment guides override the grid per axis when something is in reach.
      // Hold Alt to bypass snapping entirely for free placement.
      if (!e.altKey) {
        const snapped = snapToGuides(d.startBoundsAll, dx, dy, d.vGuides, d.hGuides, SNAP_TOL);
        dx = snapped.dx;
        dy = snapped.dy;
        setGuides(snapped.guides);
      } else if (guides.length) {
        setGuides([]);
      }
      // Clamp so no part of any selected object leaves the plot area.
      dx = cl(dx, -d.startBoundsAll[0], W - d.startBoundsAll[2]);
      dy = cl(dy, -d.startBoundsAll[1], H - d.startBoundsAll[3]);
      const updates = new Map<string, Transform>();
      for (const id of d.ids) {
        const t = d.startTs.get(id);
        if (t) updates.set(id, { ...t, x: t.x + dx, y: t.y + dy });
      }
      updateManySafe(updates);

    } else if (d.mode === "resize") {
      const obj = page.objects.find((o) => o.id === d.id);
      if (!obj) return;
      const [sbx0, sby0, sbx1, sby1] = d.startBounds;
      const [slx0, sly0, slx1, sly1] = d.startLocalBounds;
      const localW = Math.max(slx1 - slx0, 0.001);
      const localH = Math.max(sly1 - sly0, 0.001);
      const minPx = 2; // mm

      const movesLeft  = d.edge === "tl" || d.edge === "ml" || d.edge === "bl";
      const movesRight = d.edge === "tr" || d.edge === "mr" || d.edge === "br";
      const movesTop   = d.edge === "tl" || d.edge === "tc" || d.edge === "tr";
      const movesBot   = d.edge === "bl" || d.edge === "bc" || d.edge === "br";
      const isCorner   = (movesLeft || movesRight) && (movesTop || movesBot);

      let wx0 = sbx0, wy0 = sby0, wx1 = sbx1, wy1 = sby1;
      if (movesLeft)  wx0 = cl(m[0], 0,            sbx1 - minPx);
      if (movesRight) wx1 = cl(m[0], sbx0 + minPx, W);
      if (movesTop)   wy0 = cl(m[1], 0,            sby1 - minPx);
      if (movesBot)   wy1 = cl(m[1], sby0 + minPx, H);

      // Ctrl: lock aspect ratio (corners only)
      if ((e.ctrlKey || e.metaKey) && isCorner) {
        const origW = Math.max(sbx1 - sbx0, 0.001);
        const origH = Math.max(sby1 - sby0, 0.001);
        const ar = origW / origH;
        let nw = wx1 - wx0;
        let nh = wy1 - wy0;
        // Drive by whichever axis changed proportionally more
        if (nw / origW >= nh / origH) {
          nh = nw / ar;
        } else {
          nw = nh * ar;
        }
        // Anchor to the fixed corner of this handle
        if      (d.edge === "br") { wx1 = sbx0 + nw; wy1 = sby0 + nh; }
        else if (d.edge === "tl") { wx0 = sbx1 - nw; wy0 = sby1 - nh; }
        else if (d.edge === "tr") { wx1 = sbx0 + nw; wy0 = sby1 - nh; }
        else                      { wx0 = sbx1 - nw; wy1 = sby0 + nh; } // bl
        // Re-clamp to hard border
        wx0 = cl(wx0, 0, W - minPx);
        wy0 = cl(wy0, 0, H - minPx);
        wx1 = cl(wx1, minPx, W);
        wy1 = cl(wy1, minPx, H);
      }

      // Hard-clamp all four edges to the plot area — catches floating-point drift
      // and any case where fixed edges were already outside the boundary.
      wx0 = Math.max(0, wx0);
      wy0 = Math.max(0, wy0);
      wx1 = Math.min(W, wx1);
      wy1 = Math.min(H, wy1);
      if (wx1 - wx0 < minPx) { if (movesLeft) wx0 = wx1 - minPx; else wx1 = Math.min(wx0 + minPx, W); }
      if (wy1 - wy0 < minPx) { if (movesTop)  wy0 = wy1 - minPx; else wy1 = Math.min(wy0 + minPx, H); }

      const newScaleX = (wx1 - wx0) / localW;
      const newScaleY = (wy1 - wy0) / localH;
      const t = obj.transform ?? IDENTITY;
      updateSafe(d.id, {
        ...t,
        x: (wx0 + wx1) / 2,
        y: (wy0 + wy1) / 2,
        scaleX: newScaleX,
        scaleY: newScaleY,
        scale: Math.max(newScaleX, newScaleY),
      });

    } else if (d.mode === "groupScale") {
      const dist = Math.hypot(m[0] - d.center[0], m[1] - d.center[1]);
      const factor = Math.max(0.05, dist / (d.startDist || 1));
      const updates = new Map<string, Transform>();
      for (const id of d.ids) {
        const t = d.startTs.get(id);
        if (!t) continue;
        const nx = d.center[0] + (t.x - d.center[0]) * factor;
        const ny = d.center[1] + (t.y - d.center[1]) * factor;
        updates.set(id, {
          ...t,
          x: cl(nx, 0, W),
          y: cl(ny, 0, H),
          scale: Math.max(0.05, t.scale * factor),
        });
      }
      updateManySafe(updates);

    } else {
      const angle = Math.atan2(m[1] - d.center[1], m[0] - d.center[0]);
      const obj = page.objects.find((o) => o.id === d.id);
      if (obj) updateSafe(d.id, { ...(obj.transform ?? IDENTITY), rotation: d.startRotation + angle - d.startAngle });
    }
  };

  const onSvgUp = (e: React.PointerEvent) => {
    svgRef.current!.releasePointerCapture?.(e.pointerId);
    if (pan.current?.pointerId === e.pointerId) {
      pan.current = null;
      return;
    }
    if (marquee) {
      const mb = marqueeBounds(marquee);
      const isClick = Math.hypot(mb[2] - mb[0], mb[3] - mb[1]) < 1;
      if (isClick) {
        if (!marquee.additive) onSelect([]);
      } else {
        const picked = objectsByZ.flatMap((obj) => {
          if (obj.plotted) return [];
          const ob = objectWorldBounds((obj.cachedPolylines ?? []) as Pt[][], obj.transform ?? IDENTITY);
          return intersects(mb, ob) ? objectSelectionIds(obj) : [];
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
    if (guides.length) setGuides([]);
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
    const movingObjs = page.objects.filter((o) => ids.includes(o.id));
    const startBoundsAll = movingObjs.reduce<[number, number, number, number]>(
      (acc, o) => {
        const b = objectWorldBounds((o.cachedPolylines ?? []) as Pt[][], o.transform ?? IDENTITY);
        return [Math.min(acc[0], b[0]), Math.min(acc[1], b[1]), Math.max(acc[2], b[2]), Math.max(acc[3], b[3])];
      },
      [Infinity, Infinity, -Infinity, -Infinity]
    );
    // Alignment references: bounds of every visible object NOT being moved.
    const staticBounds: Bounds[] = page.objects
      .filter((o) => !o.plotted && !ids.includes(o.id))
      .map((o) => objectWorldBounds((o.cachedPolylines ?? []) as Pt[][], o.transform ?? IDENTITY));
    const { vertical, horizontal } = alignmentCandidates(staticBounds, W, H);
    drag.current = {
      mode: "move",
      ids,
      primaryId: obj.id,
      startMouse: toMM(e),
      startBoundsAll,
      vGuides: vertical,
      hGuides: horizontal,
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

  const startResize = (e: React.PointerEvent, obj: SceneObject, edge: ResizeEdge) => {
    e.stopPropagation();
    onEditStart();
    svgRef.current!.setPointerCapture(e.pointerId);
    const t = obj.transform ?? IDENTITY;
    const localLines = (obj.cachedPolylines ?? []) as Pt[][];
    drag.current = {
      mode: "resize",
      id: obj.id,
      edge,
      startBounds: objectWorldBounds(localLines, t),
      startLocalBounds: bounds(localLines.flat()),
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

  const objTransform = (t: Transform) => {
    const sx = t.scaleX ?? t.scale;
    const sy = t.scaleY ?? t.scale;
    return `translate(${t.x} ${t.y}) rotate(${(t.rotation * 180) / Math.PI}) scale(${sx},${sy})`;
  };

  const canvasRotationTransform = `rotate(${viewRotation} ${W / 2} ${H / 2})`;

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

  // Resize handle descriptors for single-selection
  const resizeHandles: { edge: ResizeEdge; cursor: string; dx: number; dy: number }[] = [
    { edge: "tl", cursor: "nwse-resize", dx: 0, dy: 0 },
    { edge: "tc", cursor: "ns-resize",   dx: 0.5, dy: 0 },
    { edge: "tr", cursor: "nesw-resize", dx: 1, dy: 0 },
    { edge: "ml", cursor: "ew-resize",   dx: 0, dy: 0.5 },
    { edge: "mr", cursor: "ew-resize",   dx: 1, dy: 0.5 },
    { edge: "bl", cursor: "nesw-resize", dx: 0, dy: 1 },
    { edge: "bc", cursor: "ns-resize",   dx: 0.5, dy: 1 },
    { edge: "br", cursor: "nwse-resize", dx: 1, dy: 1 },
  ];

  return (
    <div className="paint-canvas">
      <button
        className="canvas-rotate-button"
        type="button"
        onClick={() => onViewRotationChange(((viewRotation + 90) % 360) as ViewRotation)}
        title="Canvas-Ansicht drehen (Plot-Koordinaten bleiben unverändert)"
      >
        ↻ {viewRotation}°
      </button>
      <div className="paint-zoom-controls">
        <button className="ghost tiny" type="button" title={t("paint.zoomOut")} onClick={() => zoomAt(1 / 1.2)}>−</button>
        <span>{t("paint.zoomLevel", { pct: String(Math.round(zoom * 100)) })}</span>
        <button className="ghost tiny" type="button" title={t("paint.zoomIn")} onClick={() => zoomAt(1.2)}>+</button>
        <button className="ghost tiny" type="button" title={t("paint.zoomReset")} onClick={resetZoom}>↺</button>
      </div>
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ cursor: spaceDown ? "grab" : tool === "select" ? "default" : "crosshair", touchAction: "none" }}
        onWheel={onWheel}
        onPointerDownCapture={emitClick}
        onPointerDown={onSvgDown}
        onPointerMove={onSvgMove}
        onPointerUp={onSvgUp}
        onPointerLeave={() => onCursorMove?.({ x: 0, y: 0, inside: false, tool })}
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

        <g transform={canvasRotationTransform}>
        <rect x={0} y={0} width={W} height={H} rx={1.5} fill="#101013"
          stroke="var(--accent)" strokeWidth={0.6} />
        <rect x={0} y={0} width={W} height={H} fill="url(#pc-grid-major)" />
        <g className="canvas-orientation-marker">
          <path d={`M ${W / 2 - S * 0.055} ${-pad * 0.45} L ${W / 2} ${-pad * 0.7} L ${W / 2 + S * 0.055} ${-pad * 0.45}`} />
          <text x={W / 2} y={-pad * 0.14} textAnchor="middle">OBEN</text>
        </g>

        {/* objects */}
        {objectsByZ.map((obj) => {
          const t = obj.transform ?? IDENTITY;
          const strokeScale = Math.max(t.scaleX ?? t.scale, t.scaleY ?? t.scale);
          return (
            <g
              key={obj.id}
              transform={objTransform(t)}
              opacity={obj.plotted ? 0.25 : 1}
              style={{ pointerEvents: "none" }}
            >
              {/* One merged path per object — all lines share the same stroke. */}
              <path d={toMultiPath((obj.cachedPolylines ?? []) as Pt[][])} fill="none"
                stroke={obj.plotted ? "var(--muted)" : "var(--busy)"}
                strokeWidth={STROKE / strokeScale} strokeLinejoin="round" strokeLinecap="round" />
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

        {/* selection hit areas + handles */}
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
            const bw = bx1 - bx0;
            const bh = by1 - by0;
            const rcx = (bx0 + bx1) / 2;
            const rcy = by0 - HANDLE * 1.2;
            return (
              <g key={`s${obj.id}`}>
                {/* hit + selection outline */}
                <rect
                  x={bx0 - m} y={by0 - m} width={bw + 2 * m} height={bh + 2 * m}
                  fill="transparent"
                  stroke={sel ? "var(--accent)" : "transparent"}
                  strokeWidth={STROKE} strokeDasharray={`${STROKE * 2} ${STROKE}`}
                  style={{ cursor: "move" }}
                  onPointerDown={(e) => startMove(e, obj)}
                  onContextMenu={(e) => openContextMenu(e, obj)}
                />
                {singleSel && (
                  <>
                    {/* rotate tether + handle */}
                    <line x1={rcx} y1={by0} x2={rcx} y2={rcy}
                      stroke="var(--accent)" strokeWidth={STROKE} strokeDasharray={`${STROKE} ${STROKE}`}
                      pointerEvents="none" />
                    <circle
                      cx={rcx} cy={rcy} r={HANDLE / 2}
                      fill="var(--panel)" stroke="var(--accent)" strokeWidth={STROKE}
                      style={{ cursor: "grab" }}
                      onPointerDown={(e) => startRotate(e, obj, [cx, cy])}
                    />
                    {/* 8 resize handles */}
                    {resizeHandles.map(({ edge, cursor, dx, dy }) => {
                      const hx = bx0 + bw * dx;
                      const hy = by0 + bh * dy;
                      const hs = HANDLE * 0.85;
                      return (
                        <rect
                          key={edge}
                          x={hx - hs / 2} y={hy - hs / 2}
                          width={hs} height={hs}
                          rx={hs * 0.18}
                          fill="var(--accent)" stroke="#fff" strokeWidth={STROKE / 2}
                          style={{ cursor }}
                          onPointerDown={(e) => startResize(e, obj, edge)}
                        />
                      );
                    })}
                  </>
                )}
              </g>
            );
          })}

        {/* group selection outline + single scale handle */}
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
              <rect
                x={bx1 + m - HANDLE * 0.425} y={by1 + m - HANDLE * 0.425}
                width={HANDLE * 0.85} height={HANDLE * 0.85}
                rx={HANDLE * 0.15}
                fill="var(--accent)" stroke="#fff" strokeWidth={STROKE / 2}
                style={{ cursor: "nwse-resize" }}
                onPointerDown={(e) => startGroupScale(e, selectedObjects.map((obj) => obj.id), [cx, cy])}
              />
            </g>
          );
        })()}

        {/* alignment guides while dragging */}
        {guides.map((g, i) =>
          g.axis === "x" ? (
            <line key={`g${i}`} x1={g.pos} y1={g.from} x2={g.pos} y2={g.to}
              stroke="var(--accent)" strokeWidth={STROKE} strokeDasharray={`${STROKE * 3} ${STROKE * 2}`}
              pointerEvents="none" />
          ) : (
            <line key={`g${i}`} x1={g.from} y1={g.pos} x2={g.to} y2={g.pos}
              stroke="var(--accent)" strokeWidth={STROKE} strokeDasharray={`${STROKE * 3} ${STROKE * 2}`}
              pointerEvents="none" />
          )
        )}

        <text x={W / 2} y={H + pad * 0.7} fontSize={S * 0.022}
          fill="var(--muted)" textAnchor="middle">
          {W.toFixed(0)} × {H.toFixed(0)} mm
        </text>
        </g>
      </svg>
    </div>
  );
}
