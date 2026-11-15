import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Calibration, Page, SceneObject } from "../../api";
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
  localBounds,
  snapPt,
  alignmentCandidates,
  snapToGuides,
  type Bounds,
  type GuideCandidate,
  type Guide,
} from "./lib/geometry";
import {
  type ViewRotation,
  type ResizeEdge,
  rotatePoint,
  rotatedBounds,
  signedDeg,
  displayDeg,
  snapRotation,
  worldPoint,
  screenVectorToRotatedLocal,
  resizeLocals,
} from "./lib/viewTransform";
import { geometryTask } from "./lib/geometryTasks";
import CanvasGrid from "./components/canvas/CanvasGrid";
import ObjectsLayer from "./components/canvas/ObjectsLayer";
import OverlayLayer from "./components/canvas/OverlayLayer";
import SelectionLayer from "./components/canvas/SelectionLayer";
import { objectPlacementFrame, sourcePageFrame } from "./lib/sourcePage";
import { useI18n } from "../../i18n";

export type Tool = "select" | "pen" | "line" | "rect" | "maskRect" | "maskCircle" | "circle" | "semicircle" | "text" | "erase" | "eraseLine" | "bucketFill" | "areaFill";
export type { ViewRotation } from "./lib/viewTransform";

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
    ? { ...t, scaleX: nsx, scaleY: nsy, scale: Math.max(nsx, nsy) }
    : t;

  // After potential shrink, get the new bounds and shift into the canvas.
  const [nx0, ny0, nx1, ny1] = objectWorldBounds(local, shrunken);
  let dx = 0, dy = 0;
  if (nx0 < 0) dx = -nx0; else if (nx1 > W) dx = W - nx1;
  if (ny0 < 0) dy = -ny0; else if (ny1 > H) dy = H - ny1;
  return { ...shrunken, x: shrunken.x + dx, y: shrunken.y + dy };
}

function shapeWorld(tool: Tool, pts: Pt[]): Pt[][] {
  if (tool === "pen" || tool === "areaFill") return pts.length > 1 ? [pts] : [];
  const [a, b] = pts;
  if (!b) return [];
  if (tool === "line") return [lineWorld(a, b)];
  if (tool === "rect" || tool === "maskRect") return [rectWorld(a, b)];
  if (tool === "circle" || tool === "maskCircle") return [ellipseWorld(a, b)];
  if (tool === "semicircle") return [semicircleWorld(a, b)];
  return [];
}

type Draft = { tool: Tool; points: Pt[] };
type Marquee = { start: Pt; current: Pt; additive: boolean };
type ViewBox = { x: number; y: number; w: number; h: number };
type Drag =
  | { mode: "move"; ids: string[]; primaryId: string; startMouse: Pt; startTs: Map<string, Transform>; startBoundsAll: [number, number, number, number]; vGuides: GuideCandidate[]; hGuides: GuideCandidate[] }
  | { mode: "resize"; id: string; edge: ResizeEdge; startTransform: Transform; startLocalBounds: [number, number, number, number]; anchorLocal: Pt; handleLocal: Pt; anchorWorld: Pt }
  | { mode: "groupScale"; ids: string[]; center: Pt; startDist: number; startTs: Map<string, Transform> }
  | { mode: "groupRotate"; ids: string[]; center: Pt; startAngle: number; startTs: Map<string, Transform> }
  | { mode: "rotate"; id: string; center: Pt; startAngle: number; startRotation: number };

const cl = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const zValue = (obj: SceneObject, index: number) => obj.zOrder ?? index;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 48;
const PEN_SIMPLIFY_EPS = 0.4;
const PEN_MIN_LENGTH = 0.08;
const ERASER_RADIUS = 2.5;

function PaintCanvas({
  visible = true,
  cal,
  page,
  tool,
  selectedIds,
  onSelect,
  onAdd,
  onUpdateMany,
  onEditStart,
  onContextMenuSelection,
  onImageDrop,
  onTextAdd,
  onBucketFill,
  onAreaFill,
  onErase,
  onCursorMove,
  onCursorClick,
  viewRotation,
  onViewRotationChange,
  eraserRadius: eraserRadiusProp,
  eraserIsPoint = false,
}: {
  visible?: boolean;
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
  onBucketFill?: (at: Pt) => void;
  onAreaFill?: (polygonWorld: Pt[]) => void;
  onErase: (points: Pt[], mode: "free" | "line", radius: number) => void;
  onCursorMove?: (cursor: { x: number; y: number; inside: boolean; tool: Tool }) => void;
  onCursorClick?: (click: { x: number; y: number; tool: Tool }) => void;
  viewRotation: ViewRotation;
  onViewRotationChange: (rotation: ViewRotation) => void;
  eraserRadius?: number;
  eraserIsPoint?: boolean;
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
  const [stylusErasing, setStylusErasing] = useState(false);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [rotationHint, setRotationHint] = useState<{ at: Pt; currentDeg: number; deltaDeg: number; snapped: boolean } | null>(null);
  const [view, setView] = useState<ViewBox>(baseView);
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const drag = useRef<Drag | null>(null);
  const pan = useRef<{ pointerId: number; startClient: Pt; startView: ViewBox } | null>(null);
  // Tracks whether the current right-drag actually moved — used to tell a pan
  // apart from a plain right-click (which should still open the context menu).
  const panMoved = useRef(false);
  const [previewTransforms, setPreviewTransforms] = useState<Map<string, Transform>>(new Map());
  const pendingTransforms = useRef(new Map<string, Transform>());
  const frame = useRef<number | null>(null);
  const queuedPointer = useRef<React.PointerEvent | null>(null);
  const [zooming, setZooming] = useState(false);
  const zoomTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    clearTimeout(zoomTimer.current);
  }, []);
  useEffect(() => { pendingTransforms.current.clear(); setPreviewTransforms(new Map()); }, [page.id]);
  const displayObjects = useMemo(() => page.objects.map((obj) => {
    const transform = previewTransforms.get(obj.id);
    return transform ? { ...obj, transform } : obj;
  }), [page.objects, previewTransforms]);
  const zoom = baseView.w / view.w;
  // Stylus eraser tip or barrel eraser button overrides the active tool.
  const effectiveTool: Tool = stylusErasing ? "erase" : tool;
  const STROKE = (S * 0.0045) / zoom;
  const HANDLE = (S * 0.016) / zoom;
  // Effective eraser radius: point mode = cursor-tip size (zoom-adaptive, ~1 strokewidth)
  const effRadius = eraserIsPoint ? STROKE * 1.2 : (eraserRadiusProp ?? ERASER_RADIUS);

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

  // Wrappers that enforce the hard plot-area boundary before every transform write.
  const updateSafe = (id: string, t: Transform) => {
    const obj = page.objects.find((o) => o.id === id);
    const local = obj ? objectPlacementFrame(obj) : [];
    const updates = new Map(pendingTransforms.current);
    updates.set(id, clampedTransform(t, local, W, H));
    pendingTransforms.current = updates; setPreviewTransforms(updates);
  };
  const updateManySafe = (updates: Map<string, Transform>) => {
    const out = new Map<string, Transform>();
    for (const [id, t] of updates) {
      const obj = page.objects.find((o) => o.id === id);
      const local = obj ? objectPlacementFrame(obj) : [];
      out.set(id, clampedTransform(t, local, W, H));
    }
    pendingTransforms.current = out; setPreviewTransforms(out);
  };

  const objectSelectionIds = (obj: SceneObject) =>
    obj.groupId
      ? page.objects.filter((o) => o.groupId === obj.groupId).map((o) => o.id)
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
    const reportTool: Tool = (e.pointerType === "pen" && (e.buttons & 32) !== 0) ? "erase" : tool;
    onCursorMove({
      x: W > 0 ? Math.max(0, Math.min(1, x / W)) : 0,
      y: H > 0 ? Math.max(0, Math.min(1, y / H)) : 0,
      inside: x >= 0 && x <= W && y >= 0 && y <= H,
      tool: reportTool,
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
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    zoomAt(factor, rotatePoint(clientToMM(e.clientX, e.clientY), W, H, viewRotation));
  };

  const onSvgDown = (e: React.PointerEvent) => {
    // Detect stylus eraser tip (buttons bit 5 = 0x20).
    const penEraser = e.pointerType === "pen" && (e.buttons & 32) !== 0;
    if (penEraser !== stylusErasing) setStylusErasing(penEraser);

    // Touch pans (palm rejection); right-button or space+left also pans.
    if (e.pointerType === "touch" || e.button === 2 || (e.button === 0 && spaceDown)) {
      if (pan.current) return; // ignore second finger while already panning
      e.preventDefault();
      panMoved.current = false;
      pan.current = { pointerId: e.pointerId, startClient: [e.clientX, e.clientY], startView: view };
      svgRef.current!.setPointerCapture(e.pointerId);
      setPanning(true);
      return;
    }

    const activeTool: Tool = penEraser ? "erase" : tool;

    if (activeTool === "select") {
      if (e.button !== 0) return;
      const p = toMM(e);
      setMarquee({ start: p, current: p, additive: e.ctrlKey || e.metaKey || e.shiftKey });
      svgRef.current!.setPointerCapture(e.pointerId);
      return;
    }
    if (activeTool === "text") {
      const p = snapPt(toMM(e), step, snapOn);
      onTextAdd(p);
      return;
    }
    if (activeTool === "bucketFill") {
      if (e.button !== 0) return;
      onBucketFill?.(toMM(e));
      return;
    }
    svgRef.current!.setPointerCapture(e.pointerId);
    const freehand = activeTool === "pen" || activeTool === "areaFill" || activeTool === "erase" || activeTool === "eraseLine";
    const p = freehand ? toMM(e) : snapPt(toMM(e), step, snapOn);
    setDraft({ tool: activeTool, points: [p, p] });
  };

  const onSvgMove = (e: React.PointerEvent) => {
    if (e.pointerType === "pen") {
      const erasing = (e.buttons & 32) !== 0;
      if (erasing !== stylusErasing) setStylusErasing(erasing);
    }
    emitCursor(e);
    if (pan.current) {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const dxPx = e.clientX - pan.current.startClient[0];
      const dyPx = e.clientY - pan.current.startClient[1];
      if (Math.hypot(dxPx, dyPx) > 3) panMoved.current = true;
      const dx = (dxPx / rect.width) * pan.current.startView.w;
      const dy = (dyPx / rect.height) * pan.current.startView.h;
      setView(clampView({ ...pan.current.startView, x: pan.current.startView.x - dx, y: pan.current.startView.y - dy }));
      return;
    }
    if (marquee) {
      setMarquee({ ...marquee, current: toMM(e) });
      return;
    }
    if (draft) {
      if (draft.tool === "pen" || draft.tool === "areaFill" || draft.tool === "erase" || draft.tool === "eraseLine") {
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
      const [slx0, sly0, slx1, sly1] = d.startLocalBounds;
      const localW = Math.max(slx1 - slx0, 0.001);
      const localH = Math.max(sly1 - sly0, 0.001);
      const start = d.startTransform;
      const startSx = start.scaleX ?? start.scale;
      const startSy = start.scaleY ?? start.scale;
      const localDelta = screenVectorToRotatedLocal([m[0] - d.anchorWorld[0], m[1] - d.anchorWorld[1]], start.rotation);
      const handleDx = d.handleLocal[0] - d.anchorLocal[0];
      const handleDy = d.handleLocal[1] - d.anchorLocal[1];
      const movesX = Math.abs(handleDx) > 0.0001;
      const movesY = Math.abs(handleDy) > 0.0001;
      let newScaleX = movesX ? localDelta[0] / handleDx : startSx;
      let newScaleY = movesY ? localDelta[1] / handleDy : startSy;
      const minScaleX = 2 / localW;
      const minScaleY = 2 / localH;
      newScaleX = Math.max(minScaleX, Math.abs(newScaleX)) * Math.sign(startSx || 1);
      newScaleY = Math.max(minScaleY, Math.abs(newScaleY)) * Math.sign(startSy || 1);

      if (sourcePageFrame(obj)) {
        const factorX = Math.abs(newScaleX / (startSx || 1));
        const factorY = Math.abs(newScaleY / (startSy || 1));
        const factor = movesX && movesY
          ? (Math.abs(factorX - 1) >= Math.abs(factorY - 1) ? factorX : factorY)
          : (movesX ? factorX : factorY);
        const bounded = Math.max(factor, minScaleX / Math.abs(startSx || 1), minScaleY / Math.abs(startSy || 1));
        newScaleX = startSx * bounded;
        newScaleY = startSy * bounded;
      } else if ((e.ctrlKey || e.metaKey) && movesX && movesY) {
        const factor = Math.max(Math.abs(newScaleX / startSx), Math.abs(newScaleY / startSy));
        newScaleX = Math.sign(startSx || 1) * Math.max(minScaleX, Math.abs(startSx) * factor);
        newScaleY = Math.sign(startSy || 1) * Math.max(minScaleY, Math.abs(startSy) * factor);
      }

      const cos = Math.cos(start.rotation), sin = Math.sin(start.rotation);
      const ax = d.anchorLocal[0] * newScaleX;
      const ay = d.anchorLocal[1] * newScaleY;
      updateSafe(d.id, {
        ...start,
        x: d.anchorWorld[0] - (ax * cos - ay * sin),
        y: d.anchorWorld[1] - (ax * sin + ay * cos),
        scaleX: newScaleX,
        scaleY: newScaleY,
        scale: Math.max(Math.abs(newScaleX), Math.abs(newScaleY)),
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
        const next: Transform = {
          ...t,
          x: cl(nx, 0, W),
          y: cl(ny, 0, H),
          scale: Math.max(0.05, t.scale * factor),
        };
        // Objects resized individually carry per-axis scales that the renderer
        // prefers over `scale` — keep them in sync or they won't grow/shrink.
        if (t.scaleX != null) next.scaleX = t.scaleX * factor;
        if (t.scaleY != null) next.scaleY = t.scaleY * factor;
        updates.set(id, next);
      }
      updateManySafe(updates);

    } else if (d.mode === "groupRotate") {
      const angle = Math.atan2(m[1] - d.center[1], m[0] - d.center[0]);
      const rawDelta = angle - d.startAngle;
      const snappedDelta = snapRotation(rawDelta);
      const snapped = Math.abs(snappedDelta - rawDelta) > 0.0001;
      const cos = Math.cos(snappedDelta);
      const sin = Math.sin(snappedDelta);
      const groupUpdates = new Map<string, Transform>();
      for (const id of d.ids) {
        const t = d.startTs.get(id);
        if (!t) continue;
        const dx = t.x - d.center[0];
        const dy = t.y - d.center[1];
        groupUpdates.set(id, {
          ...t,
          x: cl(d.center[0] + dx * cos - dy * sin, 0, W),
          y: cl(d.center[1] + dx * sin + dy * cos, 0, H),
          rotation: t.rotation + snappedDelta,
        });
      }
      updateManySafe(groupUpdates);
      setRotationHint({
        at: [d.center[0], d.center[1] - HANDLE * 2.2],
        currentDeg: displayDeg(snappedDelta),
        deltaDeg: signedDeg(snappedDelta),
        snapped,
      });

    } else {
      const angle = Math.atan2(m[1] - d.center[1], m[0] - d.center[0]);
      const obj = page.objects.find((o) => o.id === d.id);
      const rawRotation = d.startRotation + angle - d.startAngle;
      const rotation = snapRotation(rawRotation);
      const snapped = Math.abs(rotation - rawRotation) > 0.0001;
      setRotationHint({
        at: [d.center[0], d.center[1] - HANDLE * 2.2],
        currentDeg: displayDeg(rotation),
        deltaDeg: signedDeg(rotation - d.startRotation),
        snapped,
      });
      if (obj) updateSafe(d.id, { ...(obj.transform ?? IDENTITY), rotation });
    }
  };

  const flushPointer = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const event = queuedPointer.current; queuedPointer.current = null;
    if (event) onSvgMove(event);
  };
  const schedulePointer = (e: React.PointerEvent) => {
    if (draft) { onSvgMove(e); return; }
    queuedPointer.current = e;
    if (frame.current === null) frame.current = requestAnimationFrame(flushPointer);
  };
  const onSvgUp = (e: React.PointerEvent) => {
    flushPointer();
    if (pendingTransforms.current.size) {
      onUpdateMany(pendingTransforms.current);
      pendingTransforms.current = new Map(); setPreviewTransforms(new Map());
    }
    if (e.pointerType === "pen" && stylusErasing && (e.buttons & 32) === 0) setStylusErasing(false);
    svgRef.current!.releasePointerCapture?.(e.pointerId);
    if (pan.current?.pointerId === e.pointerId) {
      pan.current = null;
      setPanning(false);
      return;
    }
    if (marquee) {
      const mb = marqueeBounds(marquee);
      const isClick = Math.hypot(mb[2] - mb[0], mb[3] - mb[1]) < 1;
      if (isClick) {
        if (!marquee.additive) onSelect([]);
      } else {
        const picked = objectsByZ.flatMap((obj) => {
          const ob = objectWorldBounds(objectPlacementFrame(obj), obj.transform ?? IDENTITY);
          return intersects(mb, ob) ? objectSelectionIds(obj) : [];
        });
        const next = marquee.additive ? Array.from(new Set([...selectedIds, ...picked])) : Array.from(new Set(picked));
        onSelect(next);
      }
      setMarquee(null);
      return;
    }
    if (draft) {
      if (draft.tool === "erase" || draft.tool === "eraseLine") {
        const pts = simplify(draft.points, effRadius / Math.max(zoom, 1));
        if (pts.length >= 2) onErase(pts, draft.tool === "erase" ? "free" : "line", effRadius);
        setDraft(null);
        return;
      }
      if (draft.tool === "areaFill") {
        const pts = simplify(draft.points, PEN_SIMPLIFY_EPS / zoom);
        if (pts.length >= 3) onAreaFill?.([...pts, pts[0]]); // explicitly close so closedLine() detects it
        setDraft(null);
        return;
      }
      const world =
        draft.tool === "pen" ? [simplify(draft.points, PEN_SIMPLIFY_EPS / zoom)] : shapeWorld(draft.tool, draft.points);
      const flat = world.flat();
      if (flat.length >= 2) {
        const [x0, y0, x1, y1] = [
          Math.min(...flat.map((p) => p[0])),
          Math.min(...flat.map((p) => p[1])),
          Math.max(...flat.map((p) => p[0])),
          Math.max(...flat.map((p) => p[1])),
        ];
        const minLength = draft.tool === "pen" ? PEN_MIN_LENGTH : 1;
        if (Math.hypot(x1 - x0, y1 - y0) > minLength) {
          const { local, cx, cy } = localize(world);
          onAdd({
            id: crypto.randomUUID(),
            type: draft.tool === "maskRect" || draft.tool === "maskCircle" ? "mask" : draft.tool,
            data: draft.tool === "maskRect" || draft.tool === "maskCircle" ? { mask: "erase" } : undefined,
            cachedPolylines: local,
            transform: { x: cx, y: cy, rotation: 0, scale: 1 },
            plotted: false,
          });
        }
      }
      setDraft(null);
    }
    drag.current = null;
    setRotationHint(null);
    if (guides.length) setGuides([]);
  };

  const startMove = (e: React.PointerEvent, obj: SceneObject) => {
    if (e.button !== 0) return;
    e.stopPropagation();
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
        const b = objectWorldBounds(objectPlacementFrame(o), o.transform ?? IDENTITY);
        return [Math.min(acc[0], b[0]), Math.min(acc[1], b[1]), Math.max(acc[2], b[2]), Math.max(acc[3], b[3])];
      },
      [Infinity, Infinity, -Infinity, -Infinity]
    );
    // Alignment references: bounds of every visible object NOT being moved.
    const staticBounds: Bounds[] = page.objects
      .filter((o) => !o.plotted && !ids.includes(o.id))
      .map((o) => objectWorldBounds(objectPlacementFrame(o), o.transform ?? IDENTITY));
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

  const startResize = (e: React.PointerEvent, obj: SceneObject, edge: ResizeEdge) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onEditStart();
    svgRef.current!.setPointerCapture(e.pointerId);
    const t = obj.transform ?? IDENTITY;
    const localLines = objectPlacementFrame(obj);
    const startLocalBounds = localBounds(localLines);
    const { anchor, handle } = resizeLocals(edge, startLocalBounds);
    drag.current = {
      mode: "resize",
      id: obj.id,
      edge,
      startTransform: { ...t },
      startLocalBounds,
      anchorLocal: anchor,
      handleLocal: handle,
      anchorWorld: worldPoint(anchor, t),
    };
  };

  const startGroupScale = (e: React.PointerEvent, ids: string[], center: Pt) => {
    if (e.button !== 0) return;
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

  const startGroupRotate = (e: React.PointerEvent, ids: string[], center: Pt) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onEditStart();
    svgRef.current!.setPointerCapture(e.pointerId);
    const m = toMM(e);
    drag.current = {
      mode: "groupRotate",
      ids,
      center,
      startAngle: Math.atan2(m[1] - center[1], m[0] - center[0]),
      startTs: new Map(
        page.objects
          .filter((o) => ids.includes(o.id))
          .map((o) => [o.id, { ...(o.transform ?? IDENTITY) }])
      ),
    };
    setRotationHint({ at: [center[0], center[1] - HANDLE * 2.2], currentDeg: 0, deltaDeg: 0, snapped: false });
  };

  const startRotate = (e: React.PointerEvent, obj: SceneObject, center: Pt) => {
    if (e.button !== 0) return;
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
    setRotationHint({ at: [center[0], center[1] - HANDLE * 2.2], currentDeg: displayDeg(t.rotation), deltaDeg: 0, snapped: false });
  };

  const canvasRotationTransform = `rotate(${viewRotation} ${W / 2} ${H / 2})`;

  const draftWorld = draft
    ? draft.tool === "pen" || draft.tool === "areaFill" || draft.tool === "erase" || draft.tool === "eraseLine"
      ? [draft.points]
      : shapeWorld(draft.tool, draft.points)
    : [];

  const [lineErasePreview, setLineErasePreview] = useState<{ id: string; line: Pt[] }[]>([]);
  useEffect(() => {
    if (draft?.tool !== "eraseLine" || draft.points.length < 2) { setLineErasePreview([]); return; }
    let current = true;
    const timer = setTimeout(() => {
      Promise.all(page.objects.filter((obj) => !obj.plotted).map(async (obj) => {
        const lines = await geometryTask<Pt[][]>({ kind: "erase", lines: (obj.cachedPolylines ?? []) as Pt[][],
          transform: obj.transform ?? IDENTITY, path: draft.points, mode: "line", radius: effRadius, preview: true });
        return lines.map((line, index) => ({ id: `${obj.id}:${index}`, line }));
      })).then((lines) => { if (current) setLineErasePreview(lines.flat()); }).catch(() => {});
    }, 100);
    return () => { current = false; clearTimeout(timer); };
  }, [draft, page.objects, effRadius]);

  const objectsByZ = useMemo(() => displayObjects
    .map((obj, index) => ({ obj, index }))
    .sort((a, b) => zValue(a.obj, a.index) - zValue(b.obj, b.index))
    .map(({ obj }) => obj), [displayObjects]);

  const selectedObjects = objectsByZ.filter((obj) => selectedIds.includes(obj.id));
  const selectedBounds = selectedObjects.length > 1
    ? selectedObjects.reduce<[number, number, number, number] | null>((acc, obj) => {
        const b = objectWorldBounds(objectPlacementFrame(obj), obj.transform ?? IDENTITY);
        if (!acc) return b;
        return [Math.min(acc[0], b[0]), Math.min(acc[1], b[1]), Math.max(acc[2], b[2]), Math.max(acc[3], b[3])];
      }, null)
    : null;

  return (
    <div className="paint-canvas">
      <div className="paint-zoom-controls">
        <button className="ghost tiny" type="button" title={t("paint.zoomOut")} onClick={() => zoomAt(1 / 1.2)}>−</button>
        <span>{t("paint.zoomLevel", { pct: String(Math.round(zoom * 100)) })}</span>
        <button className="ghost tiny" type="button" title={t("paint.zoomIn")} onClick={() => zoomAt(1.2)}>+</button>
        <button
          className="ghost tiny canvas-rotate-button"
          type="button"
          title={t("paint.rotateView")}
          onClick={() => onViewRotationChange(((viewRotation + 90) % 360) as ViewRotation)}
        >
          ↻ {viewRotation}°
        </button>
      </div>
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ cursor: panning ? "grabbing" : spaceDown ? "grab" : effectiveTool === "select" ? "default" : "crosshair", touchAction: "none" }}
        onWheel={(e) => { setZooming(true); clearTimeout(zoomTimer.current); zoomTimer.current = setTimeout(() => setZooming(false), 120); onWheel(e); }}
        onPointerDownCapture={emitClick}
        onPointerDown={onSvgDown}
        onPointerMove={schedulePointer}
        onPointerUp={onSvgUp}
        onPointerCancel={() => { queuedPointer.current = null; if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; pendingTransforms.current.clear(); setPreviewTransforms(new Map()); drag.current = null; pan.current = null; setPanning(false); setDraft(null); }}
        onPointerLeave={() => { setStylusErasing(false); onCursorMove?.({ x: 0, y: 0, inside: false, tool }); }}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <g transform={canvasRotationTransform}>
        <CanvasGrid W={W} H={H} S={S} pad={pad} step={step} major={major} />

        <ObjectsLayer objects={objectsByZ} selectedIds={selectedIds} stroke={STROKE} active={visible} interactive={previewTransforms.size > 0 || panning || zooming} />

        <OverlayLayer
          draftTool={draft?.tool ?? null}
          draftWorld={draftWorld as Pt[][]}
          lineErasePreview={lineErasePreview}
          marqueeRect={marquee ? marqueeBounds(marquee) : null}
          guides={guides}
          rotationHint={rotationHint}
          stroke={STROKE}
          handleSize={HANDLE}
          effRadius={effRadius}
        />

        {tool === "select" && (
          <SelectionLayer
            objects={objectsByZ}
            selectedIds={selectedIds}
            selectedObjects={selectedObjects}
            selectedBounds={selectedBounds}
            stroke={STROKE}
            handleSize={HANDLE}
            objectSelectionIds={objectSelectionIds}
            onSelect={onSelect}
            onContextMenuSelection={onContextMenuSelection}
            onStartMove={startMove}
            onStartResize={startResize}
            onStartRotate={startRotate}
            onStartGroupRotate={startGroupRotate}
            onStartGroupScale={startGroupScale}
            viewRotation={viewRotation}
          />
        )}

        </g>
      </svg>
    </div>
  );
}

export default memo(PaintCanvas);
