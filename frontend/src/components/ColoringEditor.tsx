import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Calibration, ColoringApiItem, ColoringColor, GalleryMetrics, GalleryScore, Job, Page, PageColoring, ProfileRef, SceneObject,
} from "../api";
import { api } from "../api";
import { fmtDuration } from "../format";
import { useI18n } from "../i18n";
import Segmented from "./Segmented";
import ScoreBadge from "./ScoreBadge";
import { useToasts } from "./Toasts";
import { useConfirm } from "./dialogs";
import { IDENTITY, toPath, transformPolylines, type Pt } from "../paint/geometry";
import { colourRuns, densify, distToSeg, lineKey, strokesForColor } from "../paint/coloring";
import { isMaskObject, maskPolygon, subtractPolygon } from "../paint/masks";

const ALL_COLORS: ColoringColor[] = ["black", "red", "blue", "green"];
const COLOR_HEX: Record<ColoringColor, string> = {
  black: "#111111",
  red: "#ff453a",
  blue: "#0a84ff",
  green: "#30d158",
};
const COLOR_LABEL_KEY: Record<ColoringColor, string> = {
  black: "paint.coloringColorBlack",
  red: "paint.coloringColorRed",
  blue: "paint.coloringColorBlue",
  green: "paint.coloringColorGreen",
};
const UNASSIGNED = "#7a7f87";
const SEG_MM = 2.5;
const IDENTITY_TRANSFORM = { x: 0, y: 0, rotation: 0, scale: 1 };

type Tool = "brush" | "rect" | "circle" | "inspect";
type Granularity = "whole" | "segment";
type BrushSize = "point" | "small" | "medium" | "large";
type PaintColor = ColoringColor | "none"; // "none" erases the assignment
type Rotation = 0 | 90 | 180 | 270;
type ViewBox = { x: number; y: number; w: number; h: number };
type SegMap = Record<string, (ColoringColor | null)[]>;
const BRUSH_FACTOR: Record<"small" | "medium" | "large", number> = { small: 0.02, medium: 0.04, large: 0.08 };

interface ColoringLine {
  id: string;
  key: string; // stable geometry hash — used to persist colours per page
  world: Pt[]; // masked + densified, world (plot mm) — display, hit-test, slice
  segs: number; // world.length - 1
  length: number; // total stroke length in plot mm
  bbox: [number, number, number, number];
}

type Detail = "simple" | "normal" | "detail";
type Filter = "all" | "unassigned" | "active";
// Detail level hides strokes shorter than this many plot mm (kept in data).
const DETAIL_MIN_MM: Record<Detail, number> = { simple: 6, normal: 0.5, detail: 0 };

function lineLength(pts: Pt[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return total;
}

// Length-based heat colour: short = red, long = green.
function heatColor(length: number, maxLen: number): string {
  const hue = Math.max(0, Math.min(1, length / (maxLen || 1))) * 120;
  return `hsl(${hue}, 80%, 55%)`;
}

interface Props {
  cal: Calibration;
  page: Page;
  activeProfile?: ProfileRef | null;
  onClose: () => void;
  onCreated: (jobs: Job[]) => void;
  onColoringChange?: (coloring: PageColoring) => void;
}

export default function ColoringEditor({ cal, page, activeProfile, onClose, onCreated, onColoringChange }: Props) {
  const { t } = useI18n();
  const toast = useToasts();
  const { confirm, ConfirmNode } = useConfirm();
  const svgRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  const colorGroupId = useRef(crypto.randomUUID()).current;

  const W = cal.plot_width;
  const H = cal.plot_height;
  function fitView(rot: Rotation): ViewBox {
    const margin = Math.max(W, H) * 0.06 + 6;
    const turned = rot === 90 || rot === 270;
    const w = (turned ? H : W) + 2 * margin;
    const h = (turned ? W : H) + 2 * margin;
    return { x: W / 2 - w / 2, y: H / 2 - h / 2, w, h };
  }

  const [rotation, setRotation] = useState<Rotation>(0);
  const [view, setView] = useState<ViewBox>(() => fitView(0));

  // Plotted geometry with the designer's erase-masks applied, just like the
  // backend — so the editor shows and slices what actually plots.
  const lines = useMemo<ColoringLine[]>(() => {
    const sorted = page.objects.filter((o) => !o.plotted).sort((a, b) => (a.zOrder ?? 0) - (b.zOrder ?? 0));
    let acc: Pt[][] = [];
    for (const obj of sorted) {
      if (isMaskObject(obj)) {
        const poly = maskPolygon(obj);
        if (poly) acc = acc.flatMap((l) => subtractPolygon(l, poly));
        continue;
      }
      const transform = obj.transform ?? IDENTITY;
      for (const raw of obj.cachedPolylines ?? []) {
        if ((raw as Pt[]).length < 2) continue;
        acc.push(transformPolylines([(raw as Pt[]).map((p) => [p[0], p[1]] as Pt)], transform)[0]);
      }
    }
    const out: ColoringLine[] = [];
    acc.forEach((world, idx) => {
      if (world.length < 2) return;
      const dense = densify(world, SEG_MM);
      const xs = dense.map((p) => p[0]);
      const ys = dense.map((p) => p[1]);
      out.push({ id: `l${idx}`, key: lineKey(dense), world: dense, segs: dense.length - 1, length: lineLength(dense), bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
    });
    return out;
  }, [page]);

  const maxLen = useMemo(() => lines.reduce((m, l) => Math.max(m, l.length), 0), [lines]);

  // Restore the persisted coloring: match stored colours by line geometry hash,
  // so unchanged lines come back coloured and designer-edited lines start blank.
  const [segColors, setSegColors] = useState<SegMap>(() => {
    const stored = page.coloring?.assignments ?? {};
    const map: SegMap = {};
    for (const line of lines) {
      const saved = stored[line.key];
      if (saved && saved.length === line.segs) map[line.id] = saved;
    }
    return map;
  });
  const [past, setPast] = useState<SegMap[]>([]);
  const [future, setFuture] = useState<SegMap[]>([]);
  const [order, setOrder] = useState<ColoringColor[]>(() => {
    const saved = page.coloring?.order;
    return saved && ALL_COLORS.every((c) => saved.includes(c)) ? saved : [...ALL_COLORS];
  });
  const [activeColor, setActiveColor] = useState<PaintColor>("black");
  const [tool, setTool] = useState<Tool>("brush");
  const [granularity, setGranularity] = useState<Granularity>("whole");
  const [brush, setBrush] = useState<BrushSize>("point");
  const [paper, setPaper] = useState(92);
  const [detail, setDetail] = useState<Detail>("detail");
  const [filter, setFilter] = useState<Filter>("all");
  const [heatmap, setHeatmap] = useState(false);
  const [isolate, setIsolate] = useState<ColoringColor | null>(null);
  const [inspected, setInspected] = useState<string | null>(null);
  const [scores, setScores] = useState<Partial<Record<ColoringColor, GalleryScore | null>>>({});
  const [durations, setDurations] = useState<Partial<Record<ColoringColor, number>>>({});
  const [hover, setHover] = useState<string | null>(null);
  const [rectCur, setRectCur] = useState<Pt | null>(null);
  const [slicing, setSlicing] = useState(false);
  const [createdJobs, setCreatedJobs] = useState<Job[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const S = Math.max(W, H);
  const zoom = view.w / (W + 2 * (S * 0.06 + 6));
  const strokeW = S * 0.004 * zoom;
  // "Point" hits only what the cursor directly touches (a small, zoom-stable
  // tolerance); S/M/L are real brush radii in plot mm.
  const lineHitRadius = Math.max(S * 0.004, S * 0.012 * zoom);
  const brushRadius = brush === "point" ? lineHitRadius : S * BRUSH_FACTOR[brush];

  const resolveColor = (): ColoringColor | null => (activeColor === "none" ? null : activeColor);

  const counts = useMemo(() => {
    const c: Record<ColoringColor, number> = { black: 0, red: 0, blue: 0, green: 0 };
    let assigned = 0;
    for (const line of lines) {
      const arr = segColors[line.id];
      if (!arr) continue;
      const seen = new Set<ColoringColor>();
      for (const v of arr) if (v) seen.add(v);
      if (seen.size) assigned++;
      seen.forEach((color) => c[color]++);
    }
    return { perColor: c, assigned };
  }, [segColors, lines]);

  // Lines actually shown / editable, after the detail level and filter. Hidden
  // lines keep their assignment and are still sliced — they are only out of the
  // way visually so dense imports stay workable.
  const visibleLines = useMemo(() => {
    const minLen = DETAIL_MIN_MM[detail];
    return lines.filter((line) => {
      if (line.length < minLen) return false;
      if (filter === "unassigned") return !segColors[line.id]?.some((c) => c);
      if (filter === "active") {
        if (activeColor === "none") return !segColors[line.id]?.some((c) => c);
        return segColors[line.id]?.some((c) => c === activeColor);
      }
      return true;
    });
  }, [lines, detail, filter, segColors, activeColor]);

  const hiddenCount = lines.length - visibleLines.length;

  const touch = () => { if (createdJobs) setDirty(true); };
  const snapshot = () => { setPast((p) => [...p.slice(-49), segColors]); setFuture([]); };
  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [...f, segColors]);
    setSegColors(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    touch();
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, segColors]);
    setSegColors(future[future.length - 1]);
    setFuture((f) => f.slice(0, -1));
    touch();
  };
  // Keep refs to the latest undo/redo so the keyboard listener stays stable.
  const undoRef = useRef(undo); undoRef.current = undo;
  const redoRef = useRef(redo); redoRef.current = redo;

  const objectsForColor = (color: ColoringColor): SceneObject[] => {
    const objects: SceneObject[] = [];
    for (const line of lines) {
      const arr = segColors[line.id];
      if (!arr) continue;
      strokesForColor(line.world, arr, color).forEach((pts, run) => {
        objects.push({ id: `${line.id}:${color}:${run}`, type: "line", transform: IDENTITY_TRANSFORM, plotted: false, cachedPolylines: [pts] });
      });
    }
    return objects;
  };

  // --- painting ---------------------------------------------------------

  const brushAt = (p: Pt) => {
    const color = resolveColor();
    setSegColors((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const line of visibleLines) {
        const [x0, y0, x1, y1] = line.bbox;
        if (p[0] < x0 - brushRadius || p[0] > x1 + brushRadius || p[1] < y0 - brushRadius || p[1] > y1 + brushRadius) continue;
        if (granularity === "whole") {
          let hit = false;
          for (let i = 0; i < line.segs; i++) if (distToSeg(p, line.world[i], line.world[i + 1]) <= brushRadius) { hit = true; break; }
          if (!hit) continue;
          if (color === null) { if (next[line.id]) { delete next[line.id]; changed = true; } }
          else { const cur = next[line.id]; if (cur && cur.every((c) => c === color)) continue; next[line.id] = new Array(line.segs).fill(color); changed = true; }
        } else {
          let arr: (ColoringColor | null)[] | null = null;
          for (let i = 0; i < line.segs; i++) {
            if (distToSeg(p, line.world[i], line.world[i + 1]) <= brushRadius) {
              if (!arr) arr = next[line.id] ? [...next[line.id]] : new Array(line.segs).fill(null);
              if (arr[i] !== color) { arr[i] = color; changed = true; }
            }
          }
          if (arr) next[line.id] = arr;
        }
      }
      return changed ? next : prev;
    });
    touch();
  };

  // Colour every line/segment inside a region (rectangle or ellipse).
  const applyRegion = (rminx: number, rminy: number, rmaxx: number, rmaxy: number, inside: (pt: Pt) => boolean) => {
    const color = resolveColor();
    setSegColors((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const line of visibleLines) {
        const [x0, y0, x1, y1] = line.bbox;
        if (x1 < rminx || x0 > rmaxx || y1 < rminy || y0 > rmaxy) continue;
        if (granularity === "whole") {
          if (!line.world.some(inside)) continue;
          if (color === null) { if (next[line.id]) { delete next[line.id]; changed = true; } }
          else { const cur = next[line.id]; if (cur && cur.every((c) => c === color)) continue; next[line.id] = new Array(line.segs).fill(color); changed = true; }
        } else {
          let arr: (ColoringColor | null)[] | null = null;
          for (let i = 0; i < line.segs; i++) {
            const mid: Pt = [(line.world[i][0] + line.world[i + 1][0]) / 2, (line.world[i][1] + line.world[i + 1][1]) / 2];
            if (inside(mid) || inside(line.world[i]) || inside(line.world[i + 1])) {
              if (!arr) arr = next[line.id] ? [...next[line.id]] : new Array(line.segs).fill(null);
              if (arr[i] !== color) { arr[i] = color; changed = true; }
            }
          }
          if (arr) next[line.id] = arr;
        }
      }
      return changed ? next : prev;
    });
    touch();
  };

  const applyRect = (a: Pt, b: Pt) => {
    const minx = Math.min(a[0], b[0]); const maxx = Math.max(a[0], b[0]);
    const miny = Math.min(a[1], b[1]); const maxy = Math.max(a[1], b[1]);
    applyRegion(minx, miny, maxx, maxy, (pt) => pt[0] >= minx && pt[0] <= maxx && pt[1] >= miny && pt[1] <= maxy);
  };
  const applyEllipse = (a: Pt, b: Pt) => {
    const minx = Math.min(a[0], b[0]); const maxx = Math.max(a[0], b[0]);
    const miny = Math.min(a[1], b[1]); const maxy = Math.max(a[1], b[1]);
    const cx = (minx + maxx) / 2; const cy = (miny + maxy) / 2;
    const rx = (maxx - minx) / 2 || 1e-6; const ry = (maxy - miny) / 2 || 1e-6;
    applyRegion(minx, miny, maxx, maxy, (pt) => ((pt[0] - cx) / rx) ** 2 + ((pt[1] - cy) / ry) ** 2 <= 1);
  };

  const fillRest = () => {
    const color = resolveColor();
    if (color === null) return; // "Reset" has nothing to fill with
    snapshot();
    setSegColors((prev) => {
      const next = { ...prev };
      for (const line of visibleLines) {
        const arr = next[line.id] ? [...next[line.id]] : new Array(line.segs).fill(null);
        let changed = false;
        for (let i = 0; i < line.segs; i++) if (arr[i] == null) { arr[i] = color; changed = true; }
        if (changed) next[line.id] = arr;
      }
      return next;
    });
    touch();
  };

  const clearColor = (color: ColoringColor) => {
    snapshot();
    setSegColors((prev) => {
      const next: SegMap = {};
      for (const id in prev) {
        const arr = prev[id];
        if (!arr.includes(color)) { next[id] = arr; continue; }
        const na = arr.map((c) => (c === color ? null : c));
        if (na.some((c) => c !== null)) next[id] = na;
      }
      return next;
    });
    if (isolate === color) setIsolate(null);
    touch();
  };

  const clearAll = () => { snapshot(); setSegColors({}); setIsolate(null); touch(); };

  const nearestLine = (p: Pt): string | null => {
    let best: string | null = null;
    let bestD = lineHitRadius;
    for (const line of visibleLines) {
      const [x0, y0, x1, y1] = line.bbox;
      if (p[0] < x0 - bestD || p[0] > x1 + bestD || p[1] < y0 - bestD || p[1] > y1 + bestD) continue;
      for (let i = 0; i < line.segs; i++) {
        const d = distToSeg(p, line.world[i], line.world[i + 1]);
        if (d <= bestD) { best = line.id; bestD = d; }
      }
    }
    return best;
  };

  // --- view transforms / pointer coordinates ----------------------------

  const pointWorld = (clientX: number, clientY: number): Pt | null => {
    const svg = svgRef.current;
    const g = contentRef.current;
    if (!svg || !g) return null;
    const ctm = g.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const w = pt.matrixTransform(ctm.inverse());
    return [w.x, w.y];
  };
  const pointUser = (clientX: number, clientY: number): Pt | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const u = pt.matrixTransform(ctm.inverse());
    return [u.x, u.y];
  };

  const spaceDown = useRef(false);
  const panLast = useRef<[number, number] | null>(null);
  const painting = useRef(false);
  const rectStart = useRef<Pt | null>(null);
  const isShape = tool === "rect" || tool === "circle";

  const onCanvasPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || e.button === 2 || spaceDown.current) {
      e.preventDefault();
      panLast.current = [e.clientX, e.clientY];
      svgRef.current?.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const p = pointWorld(e.clientX, e.clientY);
    if (!p) return;
    if (tool === "inspect") { setInspected(nearestLine(p)); return; }
    snapshot();
    painting.current = true;
    svgRef.current?.setPointerCapture(e.pointerId);
    if (isShape) { rectStart.current = p; setRectCur(p); return; }
    brushAt(p);
  };
  const onCanvasPointerMove = (e: React.PointerEvent) => {
    if (panLast.current) {
      const a = pointUser(panLast.current[0], panLast.current[1]);
      const b = pointUser(e.clientX, e.clientY);
      if (a && b) setView((v) => ({ ...v, x: v.x - (b[0] - a[0]), y: v.y - (b[1] - a[1]) }));
      panLast.current = [e.clientX, e.clientY];
      return;
    }
    const p = pointWorld(e.clientX, e.clientY);
    if (!p) return;
    if (painting.current) {
      if (isShape) {
        // Rectangle: Shift keeps it square. Ellipse: Ctrl keeps it a circle.
        const lock = (tool === "rect" && e.shiftKey) || (tool === "circle" && e.ctrlKey);
        if (lock && rectStart.current) {
          const s = rectStart.current;
          const m = Math.max(Math.abs(p[0] - s[0]), Math.abs(p[1] - s[1]));
          setRectCur([s[0] + Math.sign(p[0] - s[0] || 1) * m, s[1] + Math.sign(p[1] - s[1] || 1) * m]);
        } else setRectCur(p);
      } else brushAt(p);
    } else {
      setHover(nearestLine(p));
    }
  };
  const endStroke = () => {
    if (rectStart.current && rectCur) {
      if (tool === "rect") applyRect(rectStart.current, rectCur);
      else if (tool === "circle") applyEllipse(rectStart.current, rectCur);
    }
    rectStart.current = null;
    setRectCur(null);
    painting.current = false;
    panLast.current = null;
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const u = pointUser(e.clientX, e.clientY);
      if (!u) return;
      const factor = e.deltaY < 0 ? 0.85 : 1 / 0.85;
      const minW = W * 0.05;
      const maxW = S * 3;
      setView((v) => {
        let nw = v.w * factor; let nh = v.h * factor;
        const k = nw < minW ? minW / nw : nw > maxW ? maxW / nw : 1;
        nw *= k; nh *= k;
        const ux = (u[0] - v.x) / v.w; const uy = (u[1] - v.y) / v.h;
        return { x: u[0] - ux * nw, y: u[1] - uy * nh, w: nw, h: nh };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [W, S]);

  // Space = temporary pan; Ctrl/Cmd+Z / +Y (or +Shift+Z) = undo / redo.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) { spaceDown.current = true; e.preventDefault(); return; }
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === "z" && !e.shiftKey) { e.preventDefault(); undoRef.current(); }
        else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redoRef.current(); }
        return;
      }
      // Number keys pick a pen colour (0 = reset / erase).
      const pick: Record<string, PaintColor> = { "1": "black", "2": "red", "3": "blue", "4": "green", "0": "none" };
      if (e.key in pick) setActiveColor(pick[e.key]);
    };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") spaceDown.current = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  useEffect(() => {
    const used = order.filter((c) => counts.perColor[c] > 0);
    if (!used.length) { setScores({}); return; }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const nextScores: Partial<Record<ColoringColor, GalleryScore | null>> = {};
      const nextDur: Partial<Record<ColoringColor, number>> = {};
      for (const color of used) {
        try {
          const res = await api.pageScore(page.id, objectsForColor(color));
          nextScores[color] = res.score;
          if (res.metrics) nextDur[color] = (res.metrics as GalleryMetrics).duration_s;
        } catch { nextScores[color] = null; }
        if (cancelled) return;
      }
      if (!cancelled) { setScores(nextScores); setDurations(nextDur); }
    }, 700);
    return () => { cancelled = true; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segColors, order]);

  // Persist the coloring on the page (debounced), keyed by line geometry hash.
  // Only current lines are written, so colours of deleted/edited lines are
  // pruned. Skip the initial mount so we don't immediately re-save what we read.
  const firstSave = useRef(true);
  useEffect(() => {
    if (firstSave.current) { firstSave.current = false; return; }
    const timer = window.setTimeout(() => {
      const idToKey = new Map(lines.map((l) => [l.id, l.key]));
      const assignments: Record<string, (ColoringColor | null)[]> = {};
      for (const id in segColors) {
        const key = idToKey.get(id);
        if (key && segColors[id].some((c) => c)) assignments[key] = segColors[id];
      }
      const coloring: PageColoring = { assignments, order };
      onColoringChange?.(coloring); // keep the parent page in sync for re-opens
      api.savePage(page.id, { coloring }).catch(() => {});
    }, 800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segColors, order]);

  // Print one colour straight away: confirm, refuse if a plot is running, then
  // build a job from that colour's strokes and send it. No jobs-tab detour.
  const [printing, setPrinting] = useState<ColoringColor | null>(null);
  const printColor = async (color: ColoringColor) => {
    if (printing) return;
    const objects = objectsForColor(color);
    if (!objects.length) return;
    if (!await confirm(t("paint.coloringPrintConfirm", { color: t(COLOR_LABEL_KEY[color]) }))) return;
    setPrinting(color);
    try {
      const st = await api.octoStatus().catch(() => null);
      const state = String(st?.job?.state ?? "").toLowerCase();
      if (state.includes("printing") || state.includes("paused")) {
        toast.error(t("paint.coloringPrintBusy"));
        return;
      }
      const job = await api.pageGcode(page.id, activeProfile, objects);
      await api.send(job.filename, true);
      toast.success(t("paint.coloringPrintStarted", { color: t(COLOR_LABEL_KEY[color]) }));
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    } finally {
      setPrinting(null);
    }
  };

  const rotate = () => {
    const next = ((rotation + 90) % 360) as Rotation;
    setRotation(next);
    setView(fitView(next));
  };
  const resetView = () => setView(fitView(rotation));

  const dragColor = useRef<ColoringColor | null>(null);
  const dropBefore = (target: ColoringColor) => {
    const src = dragColor.current;
    dragColor.current = null;
    if (!src || src === target) return;
    setOrder((prev) => {
      const arr = prev.filter((c) => c !== src);
      arr.splice(arr.indexOf(target), 0, src);
      return arr;
    });
    touch();
  };

  const buildItems = (): ColoringApiItem[] => {
    const usedInOrder = order.filter((color) => counts.perColor[color] > 0);
    return usedInOrder.map((color, idx) => ({
      color, label: t(COLOR_LABEL_KEY[color]), order: idx + 1, objects: objectsForColor(color),
    }));
  };

  const slice = async () => {
    if (slicing) return;
    const items = buildItems();
    if (!items.length) { setError(t("paint.coloringNoLines")); return; }
    const replace = !!createdJobs;
    if (replace && !await confirm(t("paint.coloringReplaceConfirm"))) return;
    setSlicing(true);
    setError(null);
    try {
      const res = await api.colorPageGcode(page.id, activeProfile, colorGroupId, replace, items);
      setCreatedJobs(res.files);
      setDirty(false);
      onCreated(res.files);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSlicing(false);
    }
  };

  const sliceLabel = createdJobs ? t("paint.coloringReplaceJobs") : t("paint.coloringCreateJobs");
  const paperHex = `hsl(0, 0%, ${paper}%)`;
  const totalLines = lines.length;
  const pct = (n: number) => (totalLines ? Math.round((n / totalLines) * 100) : 0);
  const region = rectStart.current && rectCur
    ? { x: Math.min(rectStart.current[0], rectCur[0]), y: Math.min(rectStart.current[1], rectCur[1]), w: Math.abs(rectCur[0] - rectStart.current[0]), h: Math.abs(rectCur[1] - rectStart.current[1]) }
    : null;
  const previewHex = activeColor === "none" ? UNASSIGNED : COLOR_HEX[activeColor];
  const inspectedLine = inspected ? lines.find((l) => l.id === inspected) : null;
  const inspectedColors = inspected ? [...new Set((segColors[inspected] ?? []).filter((c): c is ColoringColor => !!c))] : [];

  return (
    <div className="coloring-overlay" role="dialog" aria-modal="true" aria-label={t("paint.coloringTitle")}>
      <div className="coloring-modal">
        <header className="coloring-head">
          <h2>{t("paint.coloringTitle")}</h2>
          <button className="ghost" onClick={onClose} aria-label={t("paint.coloringClose")}>✕</button>
        </header>

        <div className="coloring-body">
          {/* Tools */}
          <aside className="coloring-tools">
            <div className="coloring-history">
              <button className="ghost" disabled={!past.length} onClick={undo} title={`${t("paint.coloringUndo")} (Ctrl+Z)`}>↶</button>
              <button className="ghost" disabled={!future.length} onClick={redo} title={`${t("paint.coloringRedo")} (Ctrl+Y)`}>↷</button>
            </div>
            <Segmented<Tool>
              className="vertical"
              value={tool}
              onChange={setTool}
              options={[
                { value: "brush", label: t("paint.coloringToolBrush") },
                { value: "rect", label: t("paint.coloringToolRect") },
                { value: "circle", label: t("paint.coloringToolCircle") },
                { value: "inspect", label: t("paint.coloringToolInspect") },
              ]}
            />
            {tool !== "inspect" && (
              <Segmented<Granularity>
                value={granularity}
                onChange={setGranularity}
                options={[
                  { value: "whole", label: t("paint.coloringWhole") },
                  { value: "segment", label: t("paint.coloringPartial") },
                ]}
              />
            )}
            {tool === "brush" && (
              <Segmented<BrushSize>
                value={brush}
                onChange={setBrush}
                options={[
                  { value: "point", label: t("paint.coloringBrushPoint") },
                  { value: "small", label: t("paint.coloringBrushSmall"), title: t("paint.coloringBrushSize") },
                  { value: "medium", label: t("paint.coloringBrushMedium"), title: t("paint.coloringBrushSize") },
                  { value: "large", label: t("paint.coloringBrushLarge"), title: t("paint.coloringBrushSize") },
                ]}
              />
            )}

            <div className="coloring-tool-actions">
              <button className="coloring-fill-rest" onClick={fillRest}>{t("paint.coloringFillRest")}</button>
              <button className="ghost" onClick={clearAll}>{t("paint.coloringClearAll")}</button>
            </div>

            <div className="coloring-view-block">
              <label className="coloring-field">
                <span>{t("paint.coloringDetail")}</span>
                <select value={detail} onChange={(e) => setDetail(e.target.value as Detail)}>
                  <option value="simple">{t("paint.coloringDetailSimple")}</option>
                  <option value="normal">{t("paint.coloringDetailNormal")}</option>
                  <option value="detail">{t("paint.coloringDetailFull")}</option>
                </select>
              </label>
              <label className="coloring-field">
                <span>{t("paint.coloringFilter")}</span>
                <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
                  <option value="all">{t("paint.coloringFilterAll")}</option>
                  <option value="unassigned">{t("paint.coloringFilterUnassigned")}</option>
                  <option value="active">{t("paint.coloringFilterActive")}</option>
                </select>
              </label>
              <label className="coloring-check">
                <input type="checkbox" checked={heatmap} onChange={(e) => setHeatmap(e.target.checked)} />
                {t("paint.coloringHeatmap")}
              </label>
              <div className="coloring-view-controls">
                <span>{t("paint.coloringView")}</span>
                <button onClick={rotate} title={t("paint.coloringRotate")}>⟳ 90°</button>
                <button onClick={resetView} title={t("paint.coloringResetView")}>⤢</button>
              </div>
              <label className="coloring-paper">
                <span>{t("paint.coloringPaper")}</span>
                <input type="range" min={0} max={100} value={paper} onChange={(e) => setPaper(Number(e.target.value))} />
              </label>
              <p className="coloring-pan-hint">{t("paint.coloringPanHint")}</p>
            </div>
          </aside>

          {/* Canvas */}
          <div className="coloring-canvas">
            <svg
              ref={svgRef}
              viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
              preserveAspectRatio="xMidYMid meet"
              className={`coloring-svg tool-${tool}`}
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onCanvasPointerMove}
              onPointerUp={endStroke}
              onPointerLeave={() => { endStroke(); setHover(null); }}
              onContextMenu={(e) => e.preventDefault()}
            >
              <g ref={contentRef} transform={`rotate(${rotation} ${W / 2} ${H / 2})`}>
                <rect x={0} y={0} width={W} height={H} className="coloring-plotarea" style={{ fill: paperHex }} />
                {visibleLines.map((line) => {
                  const arr = segColors[line.id];
                  const isHover = hover === line.id;
                  const isInspected = inspected === line.id;
                  const runs = arr ? colourRuns(line.world, arr) : [];
                  return (
                    <g key={line.id}>
                      <path
                        d={toPath(line.world)}
                        fill="none"
                        stroke={isInspected ? "var(--accent)" : heatmap ? heatColor(line.length, maxLen) : UNASSIGNED}
                        strokeOpacity={isolate ? 0.12 : heatmap ? 0.9 : 0.75}
                        strokeWidth={isHover || isInspected ? strokeW * 2.2 : strokeW}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {runs.map((run, ri) => (
                        isolate && run.color !== isolate ? null : (
                          <path
                            key={ri}
                            d={toPath(run.pts)}
                            fill="none"
                            stroke={COLOR_HEX[run.color]}
                            strokeWidth={strokeW * 1.4}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        )
                      ))}
                    </g>
                  );
                })}
                {region && tool === "rect" && (
                  <rect className="coloring-region-preview" x={region.x} y={region.y} width={region.w} height={region.h}
                    fill={previewHex} fillOpacity={0.12} stroke={previewHex} strokeWidth={strokeW} strokeDasharray={`${strokeW * 2} ${strokeW * 2}`} />
                )}
                {region && tool === "circle" && (
                  <ellipse className="coloring-region-preview" cx={region.x + region.w / 2} cy={region.y + region.h / 2} rx={region.w / 2} ry={region.h / 2}
                    fill={previewHex} fillOpacity={0.12} stroke={previewHex} strokeWidth={strokeW} strokeDasharray={`${strokeW * 2} ${strokeW * 2}`} />
                )}
              </g>
            </svg>
            {tool === "brush" && brush !== "point" && (
              <div className="coloring-brush-hint">⌀ {Math.round(brushRadius * 2)} mm</div>
            )}
          </div>

          {/* Colours, order, insights */}
          <aside className="coloring-side">
            <div className="coloring-section">
              <h3>{t("paint.coloringActiveColor")}</h3>
              <div className="coloring-swatches">
                {ALL_COLORS.map((color) => (
                  <button
                    key={color}
                    className={`coloring-swatch ${activeColor === color ? "active" : ""}`}
                    onClick={() => setActiveColor(color)}
                  >
                    <span className="dot" style={{ background: COLOR_HEX[color] }} />
                    {t(COLOR_LABEL_KEY[color])}
                    <span className="count">{counts.perColor[color]}</span>
                  </button>
                ))}
                <button
                  className={`coloring-swatch ${activeColor === "none" ? "active" : ""}`}
                  onClick={() => setActiveColor("none")}
                >
                  <span className="dot none" />
                  {t("paint.coloringColorNone")}
                </button>
              </div>
            </div>

            <div className="coloring-section">
              <h3>{t("paint.coloringOrder")}</h3>
              <ol className="coloring-order">
                {order.map((color, i) => {
                  const used = counts.perColor[color] > 0;
                  return (
                    <li
                      key={color}
                      className={`${used ? "" : "muted"} ${isolate === color ? "isolated" : ""}`}
                      draggable
                      onDragStart={() => { dragColor.current = color; }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => dropBefore(color)}
                    >
                      <span className="handle" title={t("paint.coloringReorderHint")}>⠿</span>
                      <span className="dot" style={{ background: COLOR_HEX[color] }} />
                      <button
                        className="label"
                        title={t("paint.coloringIsolateHint")}
                        disabled={!used}
                        onClick={() => setIsolate((cur) => (cur === color ? null : color))}
                      >
                        {i + 1} {t(COLOR_LABEL_KEY[color])}
                      </button>
                      {used && durations[color] != null && <span className="coloring-dur">{fmtDuration(durations[color]!)}</span>}
                      {used && scores[color] && <ScoreBadge score={scores[color] as GalleryScore} />}
                      {used && (
                        <button className="ghost print" title={t("paint.coloringPrintColor")} disabled={!!printing} onClick={() => printColor(color)}>🖨</button>
                      )}
                      {used && (
                        <button className="ghost clear" title={t("paint.coloringClearColor")} onClick={() => clearColor(color)}>✕</button>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="coloring-section coloring-insights">
              <h3>{t("paint.coloringInsights")}</h3>
              <p className="coloring-total">{t("paint.coloringTotalPainted", { painted: counts.assigned, total: totalLines, pct: pct(counts.assigned) })}</p>
              {ALL_COLORS.filter((c) => counts.perColor[c] > 0).map((color) => (
                <div key={color} className="coloring-insight-row">
                  <span className="dot" style={{ background: COLOR_HEX[color] }} />
                  <span className="label">{t(COLOR_LABEL_KEY[color])}</span>
                  <div className="bar"><i style={{ width: `${pct(counts.perColor[color])}%`, background: COLOR_HEX[color] }} /></div>
                  <em>{counts.perColor[color]} · {pct(counts.perColor[color])}%</em>
                </div>
              ))}
            </div>

            {createdJobs && (
              <div className="coloring-section">
                <h3>{t("paint.coloringCreatedJobs")}</h3>
                <ul className="coloring-jobs">
                  {createdJobs.map((job) => (<li key={job.filename}>{job.filename}</li>))}
                </ul>
                {dirty && <p className="coloring-dirty">{t("paint.coloringDirty")}</p>}
              </div>
            )}
          </aside>
        </div>

        <footer className="coloring-foot">
          <span className="coloring-status">
            {t("paint.coloringStatus", { total: lines.length, assigned: counts.assigned, unassigned: lines.length - counts.assigned })}
            {hiddenCount > 0 && ` · ${t("paint.coloringHidden", { count: hiddenCount })}`}
          </span>
          {inspectedLine && (
            <span className="coloring-inspect">
              {t("paint.coloringInspectLine", {
                len: Math.round(inspectedLine.length),
                colors: inspectedColors.length ? inspectedColors.map((c) => t(COLOR_LABEL_KEY[c])).join(", ") : t("paint.coloringInspectNone"),
              })}
            </span>
          )}
          {error && <span className="coloring-error">{error}</span>}
          {slicing && <span className="coloring-slicing">{t("paint.coloringSlicing")}</span>}
          <div className="coloring-actions">
            {createdJobs && <span className="coloring-replace-hint">{t("paint.coloringReplaceHint")}</span>}
            <button className="ghost" onClick={onClose}>{t("paint.coloringCancel")}</button>
            <button className="primary" disabled={slicing || counts.assigned === 0} onClick={slice}>
              {sliceLabel}
            </button>
          </div>
        </footer>
      </div>
      {ConfirmNode}
    </div>
  );
}
