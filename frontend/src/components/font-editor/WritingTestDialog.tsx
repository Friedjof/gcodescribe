import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Stroke, StrokeFontDocument, StrokeGlyph, StrokePoint } from "../../api";
import { useI18n } from "../../i18n";
import { glyphStrokes, upsertGlyph } from "../../fontEditor/glyphModel";
import { boundsOf, metricTop, pointsToPath } from "../../fontEditor/strokeGeometry";
import Modal from "../Modal";
import GlyphAlignmentPanel from "./GlyphAlignmentPanel";

interface RenderedStroke {
  id: string;
  key: string;
  instanceId: string;
  points: StrokePoint[];
}

interface RenderedTravel {
  id: string;
  points: StrokePoint[];
}

interface GlyphInstance {
  id: string;
  key: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  originX: number;
  originY: number;
  /** Playback time (ms) at which this glyph starts being written. */
  startMs: number;
}

interface TimelineSegment {
  id: string;
  kind: "stroke" | "travel";
  points: StrokePoint[];
  start: number;
  duration: number;
}

interface PreviewResult {
  strokes: RenderedStroke[];
  travels: RenderedTravel[];
  instances: GlyphInstance[];
  timeline: TimelineSegment[];
  missing: string[];
  width: number;
  height: number;
  lineCount: number;
  totalMs: number;
}

const PREVIEW_LINE_CHARS = 40;
const DEFAULT_WRITING_TEXT: Record<string, string> = {
  de: "Franz jagt im komplett verwahrlosten Taxi quer durch Bayern.\nZwölf große Boxkämpfer jagen Viktor quer über den Sylter Deich.\nProbe: 0123456789, äöü ÄÖÜ ß!?",
  en: "The quick brown fox jumps over the lazy dog while five dozen quills trace every curve.\nPack my box with five dozen liquor jugs, then write 0123456789 and punctuation!?",
  fr: "Portez ce vieux whisky au juge blond qui fume près du quai.\nVoix ambiguë d'un cœur qui au zéphyr préfère les jattes de kiwis.\nEssai: 0123456789, ç é è à ù !?",
  es: "El veloz murciélago hindú comía feliz cardillo y kiwi bajo la luna.\nLa cigüeña tocó el saxofón detrás del palenque de paja.\nPrueba: 0123456789, ñ á é í ó ú ¿? ¡!",
  ba: "Čudna žena brzo piše lijepa slova dok se džez čuje kroz prozor.\nHladan vjetar nosi šarene znakove: č ć ž š đ 0123456789!?",
};

function strokePoints(stroke: Stroke): StrokePoint[] {
  return stroke.points.length ? stroke.points : stroke.rawPoints;
}

function glyphAdvance(glyph: StrokeGlyph | undefined, doc: StrokeFontDocument): number {
  return glyph?.advance ?? doc.metrics.defaultAdvance;
}

function glyphSpacingBefore(glyph: StrokeGlyph | undefined): number {
  return glyph?.spacingBefore ?? 0;
}

function wrapLine(line: string, maxChars: number): string[] {
  const out: string[] = [];
  let cur = "";
  const words = line.trim().length ? line.split(/\s+/) : [""];
  for (const word of words) {
    if (!word) continue;
    if (!cur) {
      if (word.length <= maxChars) cur = word;
      else {
        for (let i = 0; i < word.length; i += maxChars) out.push(word.slice(i, i + maxChars));
      }
      continue;
    }
    if (cur.length + 1 + word.length <= maxChars) cur += ` ${word}`;
    else {
      out.push(cur);
      cur = word.length <= maxChars ? word : "";
      if (!cur) {
        for (let i = 0; i < word.length; i += maxChars) out.push(word.slice(i, i + maxChars));
      }
    }
  }
  out.push(cur);
  return out;
}

function wrapText(text: string, maxChars = PREVIEW_LINE_CHARS): string {
  return text
    .split("\n")
    .flatMap((line) => wrapLine(line, maxChars))
    .join("\n");
}

function segmentDuration(points: StrokePoint[], fallbackMs: number): number {
  const first = points[0]?.t;
  const last = points[points.length - 1]?.t;
  if (typeof first === "number" && typeof last === "number" && last > first) return Math.max(80, last - first);
  if (points.length < 2) return fallbackMs;
  let dist = 0;
  for (let i = 1; i < points.length; i += 1) {
    dist += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return Math.max(fallbackMs, dist * 0.7);
}

function partialPoints(points: StrokePoint[], ratio: number): StrokePoint[] {
  if (ratio <= 0 || points.length === 0) return [];
  if (ratio >= 1 || points.length === 1) return points;
  const lengths: number[] = [0];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    lengths.push(total);
  }
  if (total === 0) return points.slice(0, 1);
  const target = total * ratio;
  const out: StrokePoint[] = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    if (lengths[i] <= target) {
      out.push(points[i]);
      continue;
    }
    const prev = points[i - 1];
    const next = points[i];
    const local = (target - lengths[i - 1]) / Math.max(1e-6, lengths[i] - lengths[i - 1]);
    out.push({ ...next, x: prev.x + (next.x - prev.x) * local, y: prev.y + (next.y - prev.y) * local });
    break;
  }
  return out;
}

function renderPreview(doc: StrokeFontDocument, text: string, maxLineChars: number): PreviewResult {
  const wrappedText = wrapText(text, maxLineChars);
  const lineCount = wrappedText.split("\n").length;
  const keys = doc.glyphs.map((g) => g.key).filter(Boolean).sort((a, b) => [...b].length - [...a].length);
  const top = metricTop(doc.metrics);
  const lineHeight = top - (doc.metrics.descender - Math.round(doc.metrics.em * 0.1));
  const strokes: RenderedStroke[] = [];
  const travels: RenderedTravel[] = [];
  const instances: GlyphInstance[] = [];
  const timeline: TimelineSegment[] = [];
  const missing = new Set<string>();
  let x = 0;
  let y = 0;
  let maxX = 0;
  let elapsed = 0;
  let previousEnd: StrokePoint | null = null;

  const pushTimeline = (kind: "stroke" | "travel", id: string, points: StrokePoint[]) => {
    const duration = kind === "travel" ? segmentDuration(points, 120) : segmentDuration(points, 180);
    timeline.push({ id, kind, points, start: elapsed, duration });
    elapsed += duration;
  };

  for (let i = 0; i < wrappedText.length; ) {
    const ch = wrappedText[i];
    if (ch === "\n") {
      maxX = Math.max(maxX, x);
      x = 0;
      y -= lineHeight;
      i += 1;
      continue;
    }
    if (/\s/.test(ch)) {
      x += doc.metrics.wordSpacing;
      i += 1;
      continue;
    }

    const match = keys.find((key) => wrappedText.startsWith(key, i));
    if (!match) {
      missing.add(ch);
      x += doc.metrics.defaultAdvance;
      i += 1;
      continue;
    }

    const glyph = doc.glyphs.find((g) => g.key === match);
    const spacingBefore = glyphSpacingBefore(glyph);
    const advance = glyphAdvance(glyph, doc);
    x += spacingBefore;
    const instanceId = `${match}-${i}`;
    const glyphPoints: StrokePoint[] = [];
    let startMs = elapsed;
    let started = false;
    for (const stroke of glyphStrokes(doc, match)) {
      const points = strokePoints(stroke).map((p) => ({ ...p, x: p.x + x, y: p.y + y }));
      const start = points[0];
      if (previousEnd && start) {
        const travel = { id: `travel-${instanceId}-${stroke.id}`, points: [previousEnd, start] };
        travels.push(travel);
        pushTimeline("travel", travel.id, travel.points);
      }
      if (!started) {
        startMs = elapsed; // `elapsed` is now the start time of this first stroke
        started = true;
      }
      strokes.push({
        id: `${match}-${stroke.id}-${i}`,
        key: match,
        instanceId,
        points,
      });
      glyphPoints.push(...points);
      pushTimeline("stroke", `${match}-${stroke.id}-${i}`, points);
      previousEnd = points[points.length - 1] ?? previousEnd;
    }
    const b = boundsOf(glyphPoints);
    const originX = x;
    const originY = top - y;
    instances.push({
      id: instanceId,
      key: match,
      label: match,
      x,
      y: top - y - doc.metrics.ascender,
      width: advance,
      height: lineHeight,
      originX,
      originY,
      startMs,
    });
    if (b) {
      instances[instances.length - 1] = {
        id: instanceId,
        key: match,
        label: match,
        x: Math.min(x, b.xMin),
        y: top - Math.max(b.yMax, doc.metrics.ascender + y),
        width: Math.max(advance, b.xMax - Math.min(x, b.xMin)),
        height: Math.max(lineHeight, b.yMax - b.yMin),
        originX,
        originY,
        startMs,
      };
    }
    x += advance;
    i += match.length;
  }
  maxX = Math.max(maxX, x, doc.metrics.defaultAdvance);
  return {
    strokes,
    travels,
    instances,
    timeline,
    missing: [...missing],
    width: Math.max(maxX, doc.metrics.defaultAdvance),
    height: Math.max(lineHeight, top - y - doc.metrics.descender),
    lineCount,
    totalMs: Math.max(elapsed, 1),
  };
}

export default function WritingTestDialog({
  doc,
  activeKey,
  activeStrokes,
  activeSpacingBefore,
  activeAdvance,
  minSpacingBefore,
  maxSpacingBefore,
  minAdvance,
  maxAdvance,
  onMoveGlyph,
  onScaleGlyph,
  onAutoAlignGlyph,
  onSpacingBeforeChange,
  onAdvanceChange,
  onSelectGlyph,
  onSaveGlyph,
  canSaveGlyph,
  onClose,
}: {
  doc: StrokeFontDocument;
  activeKey: string;
  activeStrokes: Stroke[];
  activeSpacingBefore: number;
  activeAdvance: number;
  minSpacingBefore: number;
  maxSpacingBefore: number;
  minAdvance: number;
  maxAdvance: number;
  onMoveGlyph: (dx: number, dy: number) => void;
  onScaleGlyph: (factor: number) => void;
  onAutoAlignGlyph: () => void;
  onSpacingBeforeChange: (spacingBefore: number) => void;
  onAdvanceChange: (advance: number) => void;
  onSelectGlyph: (key: string) => void;
  onSaveGlyph: () => void;
  canSaveGlyph: boolean;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const [text, setText] = useState(() => DEFAULT_WRITING_TEXT[lang] ?? DEFAULT_WRITING_TEXT.en);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [maxLineChars, setMaxLineChars] = useState(PREVIEW_LINE_CHARS);
  const [showTravels, setShowTravels] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [autoFitView, setAutoFitView] = useState(true);
  const [hoveredInstanceId, setHoveredInstanceId] = useState<string | null>(null);
  const playheadRef = useRef(0);
  const startRef = useRef<{ wall: number; head: number } | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const previewDoc = activeKey.trim() && activeStrokes.length ? upsertGlyph(doc, activeKey.trim(), activeStrokes, activeAdvance, activeSpacingBefore) : doc;
  const preview = useMemo(() => renderPreview(previewDoc, text, maxLineChars), [previewDoc, text, maxLineChars]);
  const top = metricTop(previewDoc.metrics);
  const penWidth = Math.max(6, Math.round(previewDoc.metrics.em * 0.012));
  const viewBox = `0 0 ${preview.width} ${preview.height}`;
  const baseSvgWidth = Math.max(1, preview.width);
  const baseSvgHeight = Math.max(1, preview.height);
  const svgHeight = baseSvgHeight * zoom;
  const svgWidth = baseSvgWidth * zoom;

  const setViewZoom = useCallback((next: number) => {
    setAutoFitView(false);
    setZoom(Math.max(0.02, Math.min(8, next)));
  }, []);

  const applyFitView = useCallback(() => {
    const el = previewRef.current;
    if (!el) return;
    const pad = 18;
    const widthFit = Math.max(1, el.clientWidth - pad) / Math.max(1, baseSvgWidth);
    const heightFit = Math.max(1, el.clientHeight - pad) / Math.max(1, baseSvgHeight);
    setZoom(Math.min(8, Math.max(0.02, Math.min(widthFit, heightFit) * 0.985)));
    requestAnimationFrame(() => {
      el.scrollLeft = 0;
      el.scrollTop = 0;
    });
  }, [baseSvgHeight, baseSvgWidth]);

  const fitView = useCallback(() => {
    setAutoFitView(true);
    applyFitView();
  }, [applyFitView]);

  const resetView = useCallback(() => {
    setAutoFitView(true);
    applyFitView();
  }, [applyFitView]);

  useLayoutEffect(() => {
    if (!autoFitView) return;
    applyFitView();
  }, [autoFitView, applyFitView, preview.width, preview.height]);

  useEffect(() => {
    if (!autoFitView) return;
    const onResize = () => applyFitView();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [autoFitView, applyFitView]);

  const zoomAtPointer = useCallback(
    (deltaY: number, clientX: number, clientY: number) => {
      const el = previewRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const xRatio = (el.scrollLeft + localX) / Math.max(1, el.scrollWidth);
      const yRatio = (el.scrollTop + localY) / Math.max(1, el.scrollHeight);
      const factor = deltaY < 0 ? 1.1 : 0.9;
      setAutoFitView(false);
      setZoom((current) => Math.max(0.02, Math.min(8, current * factor)));
      requestAnimationFrame(() => {
        el.scrollLeft = xRatio * el.scrollWidth - localX;
        el.scrollTop = yRatio * el.scrollHeight - localY;
      });
    },
    []
  );

  const setHead = useCallback(
    (v: number) => {
      const clamped = Math.max(0, Math.min(preview.totalMs, v));
      playheadRef.current = clamped;
      setPlayhead(clamped);
    },
    [preview.totalMs]
  );

  useEffect(() => {
    if (!playing) return;
    startRef.current = { wall: performance.now(), head: playheadRef.current };
    let raf = 0;
    const tick = (now: number) => {
      const s = startRef.current;
      if (!s) return;
      const next = Math.min(preview.totalMs, s.head + (now - s.wall) * speed);
      playheadRef.current = next;
      setPlayhead(next);
      if (next < preview.totalMs) raf = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, preview.totalMs]);

  // Resume from the current playhead (start over only when already at the end).
  const play = () => {
    if (playheadRef.current >= preview.totalMs) setHead(0);
    setPlaying(true);
  };
  const pause = () => setPlaying(false);
  const resetPlayback = () => {
    setPlaying(false);
    setHead(0);
  };
  const showAll = () => {
    setPlaying(false);
    setHead(preview.totalMs);
  };
  const scrub = (v: number) => {
    setHead(v);
    if (playing) startRef.current = { wall: performance.now(), head: v };
  };

  // Jump the animation to wherever the caret sits in the text input: count the
  // glyphs before the caret and seek to that glyph's start time.
  const glyphKeysDesc = useMemo(
    () =>
      previewDoc.glyphs
        .map((g) => g.key)
        .filter(Boolean)
        .sort((a, b) => [...b].length - [...a].length),
    [previewDoc]
  );
  const jumpToCaret = (pos: number) => {
    const sub = text.slice(0, pos);
    let ordinal = 0;
    let i = 0;
    while (i < sub.length) {
      const ch = sub[i];
      if (ch === "\n" || /\s/.test(ch)) {
        i += 1;
        continue;
      }
      const match = glyphKeysDesc.find((k) => sub.startsWith(k, i));
      if (!match) {
        i += 1;
        continue;
      }
      ordinal += 1;
      i += match.length;
    }
    const target =
      ordinal >= preview.instances.length
        ? preview.totalMs
        : preview.instances[ordinal]?.startMs ?? 0;
    scrub(target);
  };

  const renderWrittenSegment = (segment: TimelineSegment) => {
    const ratio = (playhead - segment.start) / segment.duration;
    if (segment.kind === "travel" && !showTravels) return null;
    const points = partialPoints(segment.points, ratio);
    const d = pointsToPath(points, top);
    if (!d) return null;
    return <path key={`${segment.id}-written`} className={`fe-writing-written fe-writing-${segment.kind}`} d={d} />;
  };

  const hoveredInstance = hoveredInstanceId ? preview.instances.find((instance) => instance.id === hoveredInstanceId) : null;

  return (
    <Modal title={t("fontEditor.writingTestTitle")} onClose={onClose} className="fe-writing-modal" bodyClassName="fe-writing-modal-body">
      <div className="fe-writing-test">
        <section className="fe-writing-input-panel">
          <label className="fe-writing-label" htmlFor="fe-writing-input">
            {t("fontEditor.writingTestText")}
          </label>
          <textarea
            id="fe-writing-input"
            className="fe-writing-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onSelect={(e) => jumpToCaret(e.currentTarget.selectionStart ?? 0)}
            rows={12}
          />
          {activeKey.trim() && activeStrokes.length > 0 && (
            <p className="muted fe-writing-note">{t("fontEditor.writingTestUnsaved")}</p>
          )}
          {preview.missing.length > 0 && (
            <p className="fe-writing-missing">
              {t("fontEditor.writingTestMissing").replace("{chars}", preview.missing.join(" "))}
            </p>
          )}
        </section>
        <section className="fe-writing-preview-panel">
          <div
            ref={previewRef}
            className="fe-writing-preview"
            role="img"
            aria-label={t("fontEditor.writingTestPreview")}
            onWheel={(e) => {
              e.preventDefault();
              zoomAtPointer(e.deltaY, e.clientX, e.clientY);
            }}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={(e) => {
              if (e.button !== 2) return;
              e.preventDefault();
              const el = previewRef.current;
              if (!el) return;
              setAutoFitView(false);
              panRef.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
              el.setPointerCapture(e.pointerId);
              el.classList.add("is-panning");
            }}
            onPointerMove={(e) => {
              const pan = panRef.current;
              const el = previewRef.current;
              if (!pan || !el) return;
              el.scrollLeft = pan.left - (e.clientX - pan.x);
              el.scrollTop = pan.top - (e.clientY - pan.y);
            }}
            onPointerUp={(e) => {
              const el = previewRef.current;
              panRef.current = null;
              if (!el) return;
              if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
              el.classList.remove("is-panning");
            }}
            onPointerCancel={() => {
              panRef.current = null;
              previewRef.current?.classList.remove("is-panning");
            }}
          >
            <svg viewBox={viewBox} preserveAspectRatio="xMinYMin meet" style={{ width: svgWidth, height: svgHeight }}>
              <g className="fe-writing-hitboxes">
                {preview.instances.map((instance) => (
                  <rect
                    key={instance.id}
                    className={`fe-writing-instance ${instance.key === activeKey.trim() ? "is-selected" : ""}`}
                    x={instance.x}
                    y={instance.y}
                    width={instance.width}
                    height={instance.height}
                    onClick={() => onSelectGlyph(instance.key)}
                    onPointerEnter={() => setHoveredInstanceId(instance.id)}
                    onPointerLeave={() => setHoveredInstanceId((current) => (current === instance.id ? null : current))}
                  >
                    <title>{instance.label}</title>
                  </rect>
                ))}
              </g>
              {showInspector && (
                <g className="fe-writing-inspector">
                  {preview.instances.map((instance) => (
                    <g key={`${instance.id}-inspector`}>
                      <rect x={instance.x} y={instance.y} width={instance.width} height={instance.height} />
                      <line x1={instance.originX} y1={instance.y} x2={instance.originX} y2={instance.y + instance.height} />
                      <line x1={instance.x} y1={instance.originY} x2={instance.x + instance.width} y2={instance.originY} />
                      <circle cx={instance.originX} cy={instance.originY} r={7} />
                      <path
                        d={`M ${instance.originX - 12} ${instance.originY} L ${instance.originX + 12} ${instance.originY} M ${instance.originX} ${instance.originY - 12} L ${instance.originX} ${instance.originY + 12}`}
                      />
                    </g>
                  ))}
                </g>
              )}
              <g className="fe-writing-pending" strokeWidth={penWidth}>
                {showTravels &&
                  preview.travels.map((travel) => {
                    const d = pointsToPath(travel.points, top);
                    return d ? <path key={travel.id} className="fe-writing-travel" d={d} /> : null;
                  })}
                {preview.strokes.map((stroke) => {
                  const d = pointsToPath(stroke.points, top);
                  return d ? <path key={stroke.id} d={d} /> : null;
                })}
              </g>
              <g strokeWidth={penWidth}>{preview.timeline.map(renderWrittenSegment)}</g>
              <g className="fe-writing-labels">
                {preview.instances.map((instance) => (
                  <text key={`${instance.id}-label`} x={instance.x + 6} y={instance.y + 18}>
                    {instance.label}
                  </text>
                ))}
              </g>
              {hoveredInstance && (
                <g className="fe-writing-hover-key" transform={`translate(${hoveredInstance.x} ${Math.max(20, hoveredInstance.y - 12)})`}>
                  <rect width={Math.max(34, hoveredInstance.label.length * 18 + 18)} height={28} rx={8} />
                  <text x={10} y={19}>{hoveredInstance.label}</text>
                </g>
              )}
            </svg>
          </div>
          <div className="fe-writing-view-actions" aria-label={t("fontEditor.writingTestViewTools")}>
            <label className="fe-writing-view-zoom">
              <span>{Math.round(zoom * 100)}%</span>
              <input
                type="range"
                min="0.02"
                max="8"
                step="0.1"
                value={zoom}
                onChange={(e) => setViewZoom(Number(e.target.value))}
                aria-label={t("fontEditor.writingTestZoom")}
              />
            </label>
            <button type="button" onClick={fitView} title={t("fontEditor.writingTestFitView")}>
              ⤢
            </button>
            <button type="button" onClick={resetView} title={t("fontEditor.writingTestResetView")}>
              ↺
            </button>
          </div>
        </section>
        <aside className="fe-writing-tools">
          <div className="fe-writing-tool-card fe-writing-savebox">
            <button className="primary" onClick={onSaveGlyph} disabled={!canSaveGlyph}>
              {t("fontEditor.saveGlyph")}
            </button>
            <span className="muted">{canSaveGlyph ? t("fontEditor.writingTestSaveHint") : t("fontEditor.writingTestSavedHint")}</span>
          </div>
          <div className="fe-writing-tool-card fe-writing-play-card">
            <button className="primary fe-writing-play-btn" onClick={playing ? pause : play} disabled={preview.timeline.length === 0}>
              {playing ? t("fontEditor.writingTestPause") : t("fontEditor.writingTestPlay")}
            </button>
            <div className="fe-writing-scrub">
              <input
                className="fe-writing-scrub-range"
                type="range"
                min={0}
                max={Math.max(1, preview.totalMs)}
                step={1}
                value={playhead}
                onChange={(e) => scrub(Number(e.target.value))}
              />
              <span className="muted fe-writing-scrub-pct">
                {Math.round((playhead / preview.totalMs) * 100)}%
              </span>
            </div>
            <label className="fe-writing-slider fe-writing-speed-slider">
              <span>{t("fontEditor.writingTestSpeed")}</span>
              <input
                type="range"
                min="0.25"
                max="8"
                step="0.25"
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
              />
              <span>{speed.toFixed(2)}x</span>
            </label>
            <label className="fe-writing-slider fe-writing-line-length-slider">
              <span>{t("fontEditor.writingTestLineLength")}</span>
              <input
                type="range"
                min="12"
                max="90"
                step="1"
                value={maxLineChars}
                onChange={(e) => {
                  setMaxLineChars(Number(e.target.value));
                  setAutoFitView(true);
                }}
              />
              <span>{maxLineChars}</span>
            </label>
            <div className="fe-writing-button-row">
              <button onClick={resetPlayback}>{t("fontEditor.writingTestReset")}</button>
              <button onClick={showAll}>{t("fontEditor.writingTestShowAll")}</button>
            </div>
            <div className="fe-writing-toggle-row">
              <label className="fe-writing-check">
                <input type="checkbox" checked={showTravels} onChange={(e) => setShowTravels(e.target.checked)} />
                <span>{t("fontEditor.writingTestTravels")}</span>
              </label>
              <label className="fe-writing-check">
                <input type="checkbox" checked={showInspector} onChange={(e) => setShowInspector(e.target.checked)} />
                <span>{t("fontEditor.writingTestInspector")}</span>
              </label>
            </div>
          </div>
          <div className="fe-writing-tool-card fe-writing-align-card">
            <GlyphAlignmentPanel
              hasStrokes={activeStrokes.length > 0}
              spacingBefore={activeSpacingBefore}
              advance={activeAdvance}
              minSpacingBefore={minSpacingBefore}
              maxSpacingBefore={maxSpacingBefore}
              minAdvance={minAdvance}
              maxAdvance={maxAdvance}
              onMove={onMoveGlyph}
              onScale={onScaleGlyph}
              onAutoAlign={onAutoAlignGlyph}
              onSpacingBeforeChange={onSpacingBeforeChange}
              onAdvanceChange={onAdvanceChange}
            />
          </div>
        </aside>
      </div>
    </Modal>
  );
}
