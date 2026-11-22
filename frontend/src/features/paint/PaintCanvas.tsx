import { displayStrokeWorld } from "../../lib/displayStroke";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  worldPoint,
  resizeLocals,
} from "./lib/viewTransform";
import { boundedSelectionTransforms, clampedTransform, gestureRotation, moveSelection, resizeTransform, sameTransform } from "./lib/canvasTransforms";
import { useCanvasSize } from "./hooks/useCanvasSize";
import CanvasGestureReadout from "./components/canvas/CanvasGestureReadout";
import type { GestureFeedback, RotationHint } from "./components/canvas/CanvasGestureReadout";
import { geometryTask } from "./lib/geometryTasks";
import { canvasUnitsPerPixel } from "./lib/canvasTransforms";
import { useCanvasViewport } from "./hooks/useCanvasViewport";
import CanvasRulers from "./components/canvas/CanvasRulers";
import CanvasGrid from "./components/canvas/CanvasGrid";
import ObjectsLayer from "./components/canvas/ObjectsLayer";
import BacksideLayer from "./components/canvas/BacksideLayer";
import type { TurnEdge } from "./lib/backside";
import OverlayLayer from "./components/canvas/OverlayLayer";
import SelectionLayer from "./components/canvas/SelectionLayer";
import { objectPlacementFrame, sourcePageFrame } from "./lib/sourcePage";
import { useI18n } from "../../i18n";

export type Tool = "select" | "pen" | "line" | "rect" | "maskRect" | "maskCircle" | "circle" | "semicircle" | "text" | "erase" | "eraseLine" | "bucketFill" | "areaFill";
export type { ViewRotation } from "./lib/viewTransform";

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
  | { mode: "resize"; id: string; edge: ResizeEdge; startTransform: Transform; startLocalBounds: [number, number, number, number]; anchorLocal: Pt; handleLocal: Pt; anchorWorld: Pt; pointerOffset: Pt }
  | { mode: "groupScale"; ids: string[]; center: Pt; startDist: number; startTs: Map<string, Transform> }
  | { mode: "groupRotate"; ids: string[]; center: Pt; startAngle: number; startTs: Map<string, Transform> }
  | { mode: "rotate"; id: string; center: Pt; startAngle: number; startRotation: number };

const zValue = (obj: SceneObject, index: number) => obj.zOrder ?? index;
const PEN_SIMPLIFY_EPS = 0.4;
const PEN_MIN_LENGTH = 0.08;
const ERASER_RADIUS = 2.5;

function PaintCanvas({
  visible = true,
  statusContent,
  backsideReference,
  gridVisible = true,
  showRulers = true,
  padding = 32,
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
  statusContent?: ReactNode;
  backsideReference?: { page: Page; edge: TurnEdge; opacity: number };
  gridVisible?: boolean;
  showRulers?: boolean;
  padding?: number;
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
  const pad = padding / 32 * (Math.max(W, H) * 0.04 + 4);
  const S = Math.max(W, H);
  const viewBounds = rotatedBounds(W, H, viewRotation);
  const size = useCanvasSize(svgRef, () => cancelGesture());
  const { view, setView, zoom, zoomAt, clampView, fitPage } = useCanvasViewport(viewBounds, size, padding + (showRulers ? 20 : 0), viewRotation);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [stylusErasing, setStylusErasing] = useState(false);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [feedback, setFeedback] = useState<GestureFeedback | null>(null);
  const [rotationHint, setRotationHint] = useState<RotationHint | null>(null);
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
  const activePointer = useRef<number | null>(null);
  const drafting = useRef(false); drafting.current = !!(draft || marquee);
  const visibleRef = useRef(visible); visibleRef.current = visible;
  const cancelGesture = () => {
    queuedPointer.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    pendingTransforms.current.clear();
    drag.current = null; pan.current = null;
    setPreviewTransforms(new Map()); setDraft(null); setMarquee(null);
    setRotationHint(null); setFeedback(null); setGuides([]); setPanning(false); setSpaceDown(false);
    const pointer = activePointer.current; activePointer.current = null;
    if (pointer !== null && svgRef.current?.hasPointerCapture?.(pointer)) svgRef.current.releasePointerCapture(pointer);
  };
  useEffect(() => {
    cancelGesture();
    return () => {
      queuedPointer.current = null;
      pendingTransforms.current.clear(); drag.current = null; pan.current = null;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      clearTimeout(zoomTimer.current);
    };
  }, [page.id, visible, tool, viewRotation, W, H, padding, showRulers]);
  const displayObjects = useMemo(() => page.objects.map((obj) => {
    const transform = previewTransforms.get(obj.id);
    return transform ? { ...obj, transform } : obj;
  }), [page.objects, previewTransforms]);
  // Stylus eraser tip or barrel eraser button overrides the active tool.
  const effectiveTool: Tool = stylusErasing ? "erase" : tool;
  const pixel = canvasUnitsPerPixel(view, size);
  const STROKE = pixel * 1.3;
  const LINE_STROKE = displayStrokeWorld(pixel);
  const HANDLE = pixel * 11;
  // Effective eraser radius: point mode = cursor-tip size (zoom-adaptive, ~1 strokewidth)
  // Keep the edit radius independent of the cosmetic display width.
  const effRadius = eraserIsPoint ? (S * 0.0045 / zoom) * 1.2 : (eraserRadiusProp ?? ERASER_RADIUS);

  // How close (mm) a moving edge/center must come to a reference before it
  // snaps. Scaled to the plot area so it feels the same regardless of size.
  const SNAP_TOL = pixel * 8;

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!visibleRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target instanceof Element && target.closest("input, textarea, select, button, a, [contenteditable='true']")) return;
      if (e.key === "Escape" && (drag.current || pan.current || drafting.current)) {
        e.preventDefault(); e.stopImmediatePropagation(); cancelGesture(); return;
      }
      if (e.code === "Space") { e.preventDefault(); setSpaceDown(true); }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("blur", cancelGesture);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("blur", cancelGesture);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const placementFrames = useMemo(() => new Map(page.objects.map(object => [object.id, objectPlacementFrame(object)])), [page.objects]);
  // Wrappers that enforce the hard plot-area boundary before every transform write.
  const updateSafe = (id: string, t: Transform) => {
    const obj = page.objects.find((o) => o.id === id);
    if (!obj) return false;
    const bounded = clampedTransform(t, placementFrames.get(id) ?? [], W, H);
    const updates = new Map(pendingTransforms.current);
    if (sameTransform(bounded, obj.transform ?? IDENTITY)) updates.delete(id);
    else updates.set(id, bounded);
    pendingTransforms.current = updates; setPreviewTransforms(updates);
    return !sameTransform(t, bounded);
  };
  const updateManySafe = (updates: Map<string, Transform>) => {
    const result = boundedSelectionTransforms(updates, placementFrames, W, H);
    const changed = new Map([...result.updates].filter(([id, transform]) => {
      const original = page.objects.find(object => object.id === id);
      return original && !sameTransform(original.transform ?? IDENTITY, transform);
    }));
    pendingTransforms.current = changed; setPreviewTransforms(changed);
    return result.constrained;
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
      activePointer.current = e.pointerId;
    svgRef.current!.setPointerCapture(e.pointerId);
      setPanning(true);
      return;
    }

    const activeTool: Tool = penEraser ? "erase" : tool;

    if (activeTool === "select") {
      if (e.button !== 0) return;
      const p = toMM(e);
      setMarquee({ start: p, current: p, additive: e.ctrlKey || e.metaKey || e.shiftKey });
      activePointer.current = e.pointerId;
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
    activePointer.current = e.pointerId;
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
      const result = moveSelection(d, m, { width: W, height: H,
        gridStep: step, grid: snapOn, free: e.altKey, tolerance: SNAP_TOL });
      if (!result) return;
      setGuides(result.guides);
      setFeedback({ at: m, mode: "move", snap: result.snap, constrained: result.constrained });
      updateManySafe(result.updates);

    } else if (d.mode === "resize") {
      const obj = page.objects.find((o) => o.id === d.id);
      if (!obj) return;
      const linked = !!sourcePageFrame(obj) || e.shiftKey || e.ctrlKey || e.metaKey;
      const wanted = resizeTransform(d, m, linked);
      const bounded = clampedTransform(wanted, objectPlacementFrame(obj), W, H);
      setFeedback({ at: m, mode: "resize", snap: "free", linked,
        constrained: Math.abs(wanted.x - bounded.x) > .001 || Math.abs(wanted.y - bounded.y) > .001 || Math.abs(wanted.scale - bounded.scale) > .001 });
      updateSafe(d.id, wanted);

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
          x: nx,
          y: ny,
          scale: t.scale * factor,
        };
        // Objects resized individually carry per-axis scales that the renderer
        // prefers over `scale` — keep them in sync or they won't grow/shrink.
        if (t.scaleX != null) next.scaleX = t.scaleX * factor;
        if (t.scaleY != null) next.scaleY = t.scaleY * factor;
        updates.set(id, next);
      }
      const constrained = updateManySafe(updates);
      setFeedback({ at: m, mode: "groupScale", snap: "free", constrained, linked: true });

    } else if (d.mode === "groupRotate") {
      const angle = Math.atan2(m[1] - d.center[1], m[0] - d.center[0]);
      const rawDelta = angle - d.startAngle;
      const snappedDelta = gestureRotation(rawDelta, e.shiftKey, e.altKey);
      const snapped = !e.altKey && (e.shiftKey || Math.abs(Math.sin(2 * snappedDelta)) < .0001);
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
          x: d.center[0] + dx * cos - dy * sin,
          y: d.center[1] + dx * sin + dy * cos,
          rotation: t.rotation + snappedDelta,
        });
      }
      const constrained = updateManySafe(groupUpdates);
      setRotationHint({
        at: [d.center[0], d.center[1] - HANDLE * 2.2],
        currentDeg: displayDeg(snappedDelta),
        deltaDeg: signedDeg(snappedDelta),
        snapped, constrained,
      });

    } else {
      const angle = Math.atan2(m[1] - d.center[1], m[0] - d.center[0]);
      const obj = page.objects.find((o) => o.id === d.id);
      const rawRotation = d.startRotation + angle - d.startAngle;
      const rotation = gestureRotation(rawRotation, e.shiftKey, e.altKey);
      const snapped = !e.altKey && (e.shiftKey || Math.abs(Math.sin(2 * rotation)) < .0001);
      const constrained = obj ? updateSafe(d.id, { ...(obj.transform ?? IDENTITY), rotation }) : false;
      setRotationHint({
        at: [d.center[0], d.center[1] - HANDLE * 2.2],
        currentDeg: displayDeg(rotation),
        deltaDeg: signedDeg(rotation - d.startRotation),
        snapped, constrained,
      });
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
      onEditStart();
      onUpdateMany(pendingTransforms.current);
      pendingTransforms.current = new Map(); setPreviewTransforms(new Map());
    }
    if (e.pointerType === "pen" && stylusErasing && (e.buttons & 32) === 0) setStylusErasing(false);
    activePointer.current = null;
    if (svgRef.current?.hasPointerCapture?.(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
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
    setFeedback(null);
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
    activePointer.current = e.pointerId;
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
    activePointer.current = e.pointerId;
    svgRef.current!.setPointerCapture(e.pointerId);
    const t = obj.transform ?? IDENTITY;
    const localLines = objectPlacementFrame(obj);
    const startLocalBounds = localBounds(localLines);
    const { anchor, handle } = resizeLocals(edge, startLocalBounds);
    const pointer = toMM(e), handleWorld = worldPoint(handle, t);
    drag.current = {
      mode: "resize",
      id: obj.id,
      edge,
      startTransform: { ...t },
      startLocalBounds,
      anchorLocal: anchor,
      handleLocal: handle,
      anchorWorld: worldPoint(anchor, t),
      pointerOffset: [pointer[0] - handleWorld[0], pointer[1] - handleWorld[1]],
    };
  };

  const startGroupScale = (e: React.PointerEvent, ids: string[], center: Pt) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    activePointer.current = e.pointerId;
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
    activePointer.current = e.pointerId;
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
    activePointer.current = e.pointerId;
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
        {statusContent}
        <button className="ghost tiny" type="button" onClick={() => { cancelGesture(); fitPage(); }} title={t("interface.fitPage")}>{t("interface.fitPage")}</button>
        <button className="ghost tiny" type="button" aria-label={t("paint.zoomOut")} title={t("paint.zoomOut")} onClick={() => zoomAt(1 / 1.2)}>−</button>
        <span>{t("paint.zoomLevel", { pct: String(Math.round(zoom * 100)) })}</span>
        <button className="ghost tiny" type="button" aria-label={t("paint.zoomIn")} title={t("paint.zoomIn")} onClick={() => zoomAt(1.2)}>+</button>
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
        onPointerCancel={cancelGesture}
        onLostPointerCapture={() => { if (activePointer.current !== null) cancelGesture(); }}
        onPointerLeave={() => { setStylusErasing(false); onCursorMove?.({ x: 0, y: 0, inside: false, tool }); }}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <g transform={canvasRotationTransform}>
        <CanvasGrid W={W} H={H} S={S} pad={pad} step={step} major={major} gridVisible={gridVisible} pixel={pixel} />

        {backsideReference && <BacksideLayer {...backsideReference} cal={cal} stroke={LINE_STROKE}
          active={visible} interactive={panning || zooming}/>}

        <ObjectsLayer objects={objectsByZ} selectedIds={selectedIds} stroke={LINE_STROKE} active={visible} interactive={previewTransforms.size > 0 || panning || zooming} />

        <OverlayLayer
          draftTool={draft?.tool ?? null}
          draftWorld={draftWorld as Pt[][]}
          lineErasePreview={lineErasePreview}
          marqueeRect={marquee ? marqueeBounds(marquee) : null}
          guides={guides}
          stroke={STROKE}
          lineStroke={LINE_STROKE}
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
        {showRulers && <CanvasRulers view={view} pixel={pixel} rotation={viewRotation} width={W} height={H} />}
        <CanvasGestureReadout objects={displayObjects.filter(obj => selectedIds.includes(obj.id))}
          feedback={feedback} rotationHint={rotationHint} draft={draft}
          pixel={pixel} view={view} width={W} height={H} viewRotation={viewRotation} />
      </svg>
    </div>
  );
}

export default memo(PaintCanvas);
