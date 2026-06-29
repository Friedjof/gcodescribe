import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import type { Stroke, StrokeFontMetrics, StrokePoint } from "../../api";
import { useStrokeInput } from "../../fontEditor/useStrokeInput";
import { buildTimeline, revealCounts, strokePoints } from "../../fontEditor/playback";
import {
  metricBottom,
  metricTop,
  nearestStrokeId,
  pointsToPath,
  viewBoxFor,
  viewToEm,
  type ViewBox,
} from "../../fontEditor/strokeGeometry";

// Vertical width references (fractions of the em), so the drawn glyph width can
// be judged against the em square.
const WIDTH_GRID = [0.25, 0.5, 0.75, 1];

interface LegendRow {
  swatch: string;
  nameKey: string;
  descKey: string;
}

const LEGEND_HEIGHT: LegendRow[] = [
  { swatch: "metric", nameKey: "fontEditor.guideAscender", descKey: "fontEditor.guideAscenderDesc" },
  { swatch: "metric", nameKey: "fontEditor.guideCap", descKey: "fontEditor.guideCapDesc" },
  { swatch: "metric", nameKey: "fontEditor.guideX", descKey: "fontEditor.guideXDesc" },
  { swatch: "baseline", nameKey: "fontEditor.guideBaseline", descKey: "fontEditor.guideBaselineDesc" },
  { swatch: "metric", nameKey: "fontEditor.guideDescender", descKey: "fontEditor.guideDescenderDesc" },
];

const LEGEND_WIDTH: LegendRow[] = [
  { swatch: "margin", nameKey: "fontEditor.guideLeft", descKey: "fontEditor.guideLeftDesc" },
  { swatch: "advance", nameKey: "fontEditor.guideAdvance", descKey: "fontEditor.guideAdvanceDesc" },
  { swatch: "grid", nameKey: "fontEditor.guideGrid", descKey: "fontEditor.guideGridDesc" },
];

export type CanvasTool = "draw" | "erase" | "move";

// Metric guide lines drawn behind the strokes.
const GUIDES: { metric: keyof StrokeFontMetrics; labelKey: string }[] = [
  { metric: "ascender", labelKey: "fontEditor.guideAscender" },
  { metric: "capHeight", labelKey: "fontEditor.guideCap" },
  { metric: "xHeight", labelKey: "fontEditor.guideX" },
  { metric: "baseline", labelKey: "fontEditor.guideBaseline" },
  { metric: "descender", labelKey: "fontEditor.guideDescender" },
];

function zoomViewBox(vb: ViewBox, anchor: { x: number; y: number }, factor: number, em: number): ViewBox {
  const minW = em / 8;
  const maxW = em * 5;
  let w = vb.w / factor;
  if (w < minW) w = minW;
  if (w > maxW) w = maxW;
  const scale = w / vb.w;
  const h = vb.h * scale;
  return {
    x: anchor.x - (anchor.x - vb.x) * scale,
    y: anchor.y - (anchor.y - vb.y) * scale,
    w,
    h,
  };
}

export default function GlyphCanvas({
  metrics,
  strokes,
  tool,
  selectedId,
  onSelectStroke,
  onStrokeComplete,
  onEraseStroke,
  onMoveStroke,
  playRequest,
  onPlayingChange,
}: {
  metrics: StrokeFontMetrics;
  strokes: Stroke[];
  tool: CanvasTool;
  selectedId: string | null;
  onSelectStroke: (id: string | null) => void;
  onStrokeComplete: (raw: StrokePoint[]) => void;
  onEraseStroke: (id: string) => void;
  onMoveStroke: (id: string, dx: number, dy: number) => void;
  playRequest: number;
  onPlayingChange: (playing: boolean) => void;
}) {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const top = metricTop(metrics);
  // Vertical span of the metric region in view space (for vertical guide lines).
  const guideTop = top - metricTop(metrics);
  const guideBottom = top - metricBottom(metrics);
  const penWidth = Math.max(6, Math.round(metrics.em * 0.012));
  // Hit-test radius for erase/move, in em (zoom-independent, generous).
  const hitThreshold = metrics.em * 0.045;

  const [vb, setVb] = useState<ViewBox>(() => viewBoxFor(metrics));
  // Live translate preview while dragging a stroke in move mode.
  const drag = useRef<{ id: string; startX: number; startY: number } | null>(null);
  const dragOffsetRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const [dragOffset, setDragOffset] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const erasing = useRef(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);

  // Close the guide-legend dropdown on outside click or Escape.
  useEffect(() => {
    if (!infoOpen) return;
    const onDown = (e: PointerEvent) => {
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) setInfoOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInfoOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [infoOpen]);
  // Reset the view whenever the font's metric box changes (e.g. another font).
  useEffect(() => {
    setVb(viewBoxFor(metrics));
  }, [metrics.em, metrics.ascender, metrics.descender]);

  // client pixel → SVG user coords (respects current viewBox & letterboxing).
  const toUser = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const u = pt.matrixTransform(ctm.inverse());
    return { x: u.x, y: u.y };
  }, []);

  const toEm = useCallback(
    (clientX: number, clientY: number) => viewToEm(toUser(clientX, clientY), top),
    [toUser, top]
  );

  const input = useStrokeInput(toEm, onStrokeComplete);

  // ---- Playback ---------------------------------------------------------
  const [reveal, setReveal] = useState<number[] | null>(null);
  const playing = useRef(false);
  const raf = useRef<number | null>(null);

  const stopPlayback = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    if (playing.current) {
      playing.current = false;
      onPlayingChange(false);
    }
    setReveal(null);
  }, [onPlayingChange]);

  useEffect(() => {
    if (playRequest === 0) return;
    const timeline = buildTimeline(strokes);
    if (timeline.seq.length === 0) return;
    const count = strokes.length;
    playing.current = true;
    onPlayingChange(true);
    const start = performance.now();
    const tick = (now: number) => {
      if (!playing.current) return;
      const elapsed = now - start;
      setReveal(revealCounts(timeline, elapsed, count));
      if (elapsed >= timeline.total) {
        stopPlayback();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
    // Re-run only when a new playback is requested.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playRequest]);

  useEffect(() => () => stopPlayback(), [stopPlayback]);

  // ---- Pointer (draw + pan) --------------------------------------------
  const panning = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (playing.current) stopPlayback();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const isPan = e.button === 1 || e.button === 2 || e.shiftKey;
    if (isPan) {
      panning.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0) return;

    if (tool === "erase") {
      erasing.current = true;
      const p = toEm(e.clientX, e.clientY);
      const id = nearestStrokeId(strokes, p, hitThreshold);
      if (id) onEraseStroke(id);
      return;
    }
    if (tool === "move") {
      const p = toEm(e.clientX, e.clientY);
      const id = nearestStrokeId(strokes, p, hitThreshold);
      onSelectStroke(id);
      drag.current = id ? { id, startX: p.x, startY: p.y } : null;
      return;
    }
    input.begin(e.clientX, e.clientY, e);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (panning.current) {
      const svg = svgRef.current;
      const rect = svg?.getBoundingClientRect();
      if (rect) {
        const dx = ((e.clientX - panning.current.x) * vb.w) / rect.width;
        const dy = ((e.clientY - panning.current.y) * vb.h) / rect.height;
        setVb((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
      }
      panning.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (tool === "erase") {
      if (!erasing.current) return;
      const p = toEm(e.clientX, e.clientY);
      const id = nearestStrokeId(strokes, p, hitThreshold);
      if (id) onEraseStroke(id);
      return;
    }
    if (tool === "move") {
      if (!drag.current) return;
      const p = toEm(e.clientX, e.clientY);
      const next = { id: drag.current.id, dx: p.x - drag.current.startX, dy: p.y - drag.current.startY };
      dragOffsetRef.current = next;
      setDragOffset(next);
      return;
    }
    input.extend(e.clientX, e.clientY, e);
  };

  const onPointerUp = () => {
    if (panning.current) {
      panning.current = null;
      return;
    }
    if (tool === "erase") {
      erasing.current = false;
      return;
    }
    if (tool === "move") {
      const offset = dragOffsetRef.current;
      if (offset && (offset.dx !== 0 || offset.dy !== 0)) {
        onMoveStroke(offset.id, offset.dx, offset.dy);
      }
      drag.current = null;
      dragOffsetRef.current = null;
      setDragOffset(null);
      return;
    }
    input.finish();
  };

  // Non-passive wheel listener so we can preventDefault the page scroll.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const anchor = toUser(e.clientX, e.clientY);
      const factor = Math.exp(-e.deltaY * 0.0015);
      setVb((v) => zoomViewBox(v, anchor, factor, metrics.em));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [toUser, metrics.em]);

  // Arrow keys nudge the selected stroke in move mode. Pen side buttons that
  // emit arrow keys drive this too. Shift = larger step, Alt = fine step.
  useEffect(() => {
    if (tool !== "move" || !selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
      const step = e.shiftKey ? metrics.em * 0.04 : e.altKey ? metrics.em * 0.004 : metrics.em * 0.012;
      let dx = 0;
      let dy = 0;
      if (e.key === "ArrowUp") dy = step; // em is y-up
      else if (e.key === "ArrowDown") dy = -step;
      else if (e.key === "ArrowLeft") dx = -step;
      else if (e.key === "ArrowRight") dx = step;
      else return;
      e.preventDefault();
      onMoveStroke(selectedId, dx, dy);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, selectedId, metrics.em, onMoveStroke]);

  const cancelPointer = () => {
    input.cancel();
    erasing.current = false;
    drag.current = null;
    dragOffsetRef.current = null;
    setDragOffset(null);
  };

  const renderStroke = (stroke: Stroke, i: number) => {
    let pts = strokePoints(stroke);
    if (reveal) pts = pts.slice(0, reveal[i] ?? 0);
    // Live preview while dragging this stroke in move mode.
    if (dragOffset && dragOffset.id === stroke.id) {
      pts = pts.map((p) => ({ ...p, x: p.x + dragOffset.dx, y: p.y + dragOffset.dy }));
    }
    const d = pointsToPath(pts, top);
    if (!d) return null;
    const selected = tool === "move" && stroke.id === selectedId;
    return <path key={stroke.id} className={`fe-stroke ${selected ? "is-selected" : ""}`} d={d} />;
  };

  return (
    <div className="fe-canvas">
      <svg
        ref={svgRef}
        className={`fe-canvas-svg fe-tool-${tool}`}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={cancelPointer}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Vertical references: faint width grid, the left margin (origin) and
            the default advance, so a glyph's width is easy to gauge. */}
        {WIDTH_GRID.map((f) => {
          const gx = metrics.em * f;
          return (
            <line
              key={`vgrid-${f}`}
              className="fe-guide-grid"
              x1={gx}
              x2={gx}
              y1={guideTop}
              y2={guideBottom}
            />
          );
        })}
        <g className="fe-guide fe-guide-margin">
          <line x1={0} x2={0} y1={guideTop} y2={guideBottom} />
          <text x={8} y={guideBottom - 8}>
            {t("fontEditor.guideLeft")}
          </text>
        </g>
        <g className="fe-guide fe-guide-advance">
          <line
            x1={metrics.defaultAdvance}
            x2={metrics.defaultAdvance}
            y1={guideTop}
            y2={guideBottom}
          />
          <text x={metrics.defaultAdvance + 8} y={guideBottom - 8}>
            {t("fontEditor.guideAdvance")}
          </text>
        </g>

        {GUIDES.map(({ metric, labelKey }) => {
          const y = top - metrics[metric];
          return (
            <g key={metric} className={`fe-guide fe-guide-${metric}`}>
              <line x1={-metrics.em} x2={metrics.em * 2} y1={y} y2={y} />
              <text x={6} y={y - 6}>
                {t(labelKey)}
              </text>
            </g>
          );
        })}

        <g className="fe-strokes" strokeWidth={penWidth}>
          {strokes.map(renderStroke)}
          {input.active && (
            <path className="fe-stroke fe-stroke-active" d={pointsToPath(input.active, top)} />
          )}
        </g>
      </svg>

      <div className="fe-canvas-info" ref={infoRef}>
        <button
          type="button"
          className={`fe-info-btn ${infoOpen ? "is-open" : ""}`}
          onClick={() => setInfoOpen((o) => !o)}
          aria-expanded={infoOpen}
          aria-label={t("fontEditor.guideInfo")}
          title={t("fontEditor.guideInfo")}
        >
          i
        </button>
        <div
          className={`fe-info-panel ${infoOpen ? "is-open" : ""}`}
          role="dialog"
          aria-label={t("fontEditor.guidesTitle")}
        >
          <h4>{t("fontEditor.guidesTitle")}</h4>
          <p className="fe-info-group-label">{t("fontEditor.guidesHeight")}</p>
          <ul className="fe-info-list">
            {LEGEND_HEIGHT.map((row) => (
              <li key={row.nameKey} className="fe-info-row">
                <span className={`fe-info-swatch ${row.swatch}`} />
                <span className="fe-info-text">
                  <b>{t(row.nameKey)}</b>
                  <small>{t(row.descKey)}</small>
                </span>
              </li>
            ))}
          </ul>
          <p className="fe-info-group-label">{t("fontEditor.guidesWidth")}</p>
          <ul className="fe-info-list">
            {LEGEND_WIDTH.map((row) => (
              <li key={row.nameKey} className="fe-info-row">
                <span className={`fe-info-swatch ${row.swatch}`} />
                <span className="fe-info-text">
                  <b>{t(row.nameKey)}</b>
                  <small>{t(row.descKey)}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="fe-canvas-hint">{t("fontEditor.canvasHint")}</div>

      <button
        type="button"
        className="fe-canvas-reset"
        onClick={() => setVb(viewBoxFor(metrics))}
        title={t("fontEditor.resetView")}
        aria-label={t("fontEditor.resetView")}
      >
        ⤢
      </button>
    </div>
  );
}
