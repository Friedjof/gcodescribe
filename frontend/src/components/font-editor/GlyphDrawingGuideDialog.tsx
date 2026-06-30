import { useCallback, useRef, useState } from "react";
import type { StrokeFontMetrics, StrokePoint } from "../../api";
import { useI18n } from "../../i18n";
import { boundsOf, metricBottom, metricTop, pointsToPath, viewToEm } from "../../fontEditor/strokeGeometry";
import Modal from "../Modal";
import Segmented from "../Segmented";

const EXAMPLES = [
  { key: "A", labelKey: "fontEditor.drawGuideExampleA", side: "cap" },
  { key: "t", labelKey: "fontEditor.drawGuideExampleT", side: "ascender" },
  { key: "g", labelKey: "fontEditor.drawGuideExampleG", side: "descender" },
  { key: "o", labelKey: "fontEditor.drawGuideExampleO", side: "xheight" },
] as const;

const METRIC_LINES = [
  { metric: "ascender", className: "ascender", labelKey: "fontEditor.guideAscender" },
  { metric: "capHeight", className: "cap", labelKey: "fontEditor.guideCap" },
  { metric: "xHeight", className: "xheight", labelKey: "fontEditor.guideX" },
  { metric: "baseline", className: "baseline", labelKey: "fontEditor.guideBaseline" },
  { metric: "descender", className: "descender", labelKey: "fontEditor.guideDescender" },
] as const;

type GuideMode = "examples" | "practice";

interface PracticeTip {
  key: string;
  kind: "good" | "warn";
  highlight?: "top" | "bottom" | "width" | "center" | "advance";
}

interface ExampleNote {
  key: string;
  side: "left" | "right";
  target?: "ascender" | "capHeight" | "xHeight" | "baseline" | "descender" | "advance" | "width";
}

function examplePath(key: string, m: StrokeFontMetrics): string {
  const usable = Math.min(m.defaultAdvance, m.em * 0.82);
  const left = usable * 0.15;
  const right = usable * 0.82;
  const mid = (left + right) / 2;
  if (key === "A") {
    return `M ${left} ${m.baseline} L ${mid} ${m.capHeight} L ${right} ${m.baseline} M ${left + m.em * 0.14} ${m.xHeight} L ${right - m.em * 0.14} ${m.xHeight}`;
  }
  if (key === "t") {
    return `M ${mid} ${m.descender * 0.05} L ${mid} ${m.ascender * 0.92} M ${left + m.em * 0.08} ${m.xHeight + m.em * 0.08} L ${right - m.em * 0.02} ${m.xHeight + m.em * 0.08} M ${mid} ${m.baseline} C ${mid} ${m.xHeight * 0.35} ${right - m.em * 0.05} ${m.baseline + m.em * 0.05} ${right} ${m.baseline + m.em * 0.15}`;
  }
  if (key === "g") {
    return `M ${right - m.em * 0.04} ${m.xHeight * 0.48} C ${right - m.em * 0.04} ${m.xHeight * 0.9} ${left + m.em * 0.1} ${m.xHeight * 0.9} ${left + m.em * 0.1} ${m.xHeight * 0.42} C ${left + m.em * 0.1} ${m.baseline - m.em * 0.04} ${right - m.em * 0.08} ${m.baseline - m.em * 0.02} ${right - m.em * 0.04} ${m.xHeight * 0.42} M ${right - m.em * 0.04} ${m.xHeight * 0.82} L ${right - m.em * 0.04} ${m.descender * 0.78} C ${right - m.em * 0.04} ${m.descender * 1.05} ${left + m.em * 0.22} ${m.descender * 0.98} ${left + m.em * 0.26} ${m.descender * 0.58}`;
  }
  return `M ${mid} ${m.xHeight} C ${right} ${m.xHeight} ${right} ${m.baseline} ${mid} ${m.baseline} C ${left} ${m.baseline} ${left} ${m.xHeight} ${mid} ${m.xHeight}`;
}

function exampleNotes(side: string): ExampleNote[] {
  if (side === "ascender") {
    return [
      { key: "fontEditor.drawGuide_ascender_left1", side: "left", target: "ascender" },
      { key: "fontEditor.drawGuide_ascender_left2", side: "left", target: "xHeight" },
      { key: "fontEditor.drawGuide_ascender_right1", side: "right", target: "baseline" },
      { key: "fontEditor.drawGuide_ascender_right2", side: "right" },
    ];
  }
  if (side === "descender") {
    return [
      { key: "fontEditor.drawGuide_descender_left1", side: "left", target: "descender" },
      { key: "fontEditor.drawGuide_descender_left2", side: "left", target: "descender" },
      { key: "fontEditor.drawGuide_descender_right1", side: "right", target: "xHeight" },
      { key: "fontEditor.drawGuide_descender_right2", side: "right", target: "advance" },
    ];
  }
  if (side === "xheight") {
    return [
      { key: "fontEditor.drawGuide_xheight_left1", side: "left", target: "xHeight" },
      { key: "fontEditor.drawGuide_xheight_left2", side: "left" },
      { key: "fontEditor.drawGuide_xheight_right1", side: "right", target: "width" },
      { key: "fontEditor.drawGuide_xheight_right2", side: "right", target: "advance" },
    ];
  }
  return [
    { key: "fontEditor.drawGuide_cap_left1", side: "left", target: "capHeight" },
    { key: "fontEditor.drawGuide_cap_left2", side: "left" },
    { key: "fontEditor.drawGuide_cap_right1", side: "right", target: "baseline" },
    { key: "fontEditor.drawGuide_cap_right2", side: "right", target: "advance" },
  ];
}

function flatten(strokes: StrokePoint[][], active: StrokePoint[] | null): StrokePoint[] {
  return [...strokes.flat(), ...(active ?? [])];
}

function evaluatePractice(key: string, m: StrokeFontMetrics, points: StrokePoint[]): PracticeTip[] {
  const b = boundsOf(points);
  if (!b) return [{ key: "fontEditor.drawPracticeFeedbackEmpty", kind: "warn" }];

  const usable = Math.min(m.defaultAdvance, m.em * 0.82);
  const width = b.xMax - b.xMin;
  const center = (b.xMin + b.xMax) / 2;
  const targetCenter = usable * 0.48;
  const tips: PracticeTip[] = [];
  const add = (key: string, highlight?: PracticeTip["highlight"]) => tips.push({ key, kind: "warn", highlight });

  if (b.xMin < -m.em * 0.04) add("fontEditor.drawPracticeTipTooFarLeft", "center");
  if (b.xMax > m.defaultAdvance - m.em * 0.03) add("fontEditor.drawPracticeTipPastAdvance", "advance");
  if (center < targetCenter - m.em * 0.12) add("fontEditor.drawPracticeTipMoreRight", "center");
  if (center > targetCenter + m.em * 0.14) add("fontEditor.drawPracticeTipMoreLeft", "center");

  if (key === "A") {
    if (b.yMax < m.capHeight - m.em * 0.1) add("fontEditor.drawPracticeTipHigherCap", "top");
    if (b.yMax > m.ascender + m.em * 0.03) add("fontEditor.drawPracticeTipTooHigh", "top");
    if (Math.abs(b.yMin - m.baseline) > m.em * 0.12) add("fontEditor.drawPracticeTipTouchBaseline", "bottom");
    if (width < usable * 0.42) add("fontEditor.drawPracticeTipWider", "width");
    if (width > usable * 0.82) add("fontEditor.drawPracticeTipNarrower", "width");
  } else if (key === "t") {
    if (b.yMax < m.xHeight + m.em * 0.12) add("fontEditor.drawPracticeTipHigherAscender", "top");
    if (b.yMax > m.ascender + m.em * 0.05) add("fontEditor.drawPracticeTipTooHigh", "top");
    if (b.yMin < m.descender * 0.25) add("fontEditor.drawPracticeTipNoDescender", "bottom");
    if (width > usable * 0.72) add("fontEditor.drawPracticeTipTNarrower", "width");
  } else if (key === "g") {
    if (b.yMax > m.xHeight + m.em * 0.14) add("fontEditor.drawPracticeTipLowerBowl", "top");
    if (b.yMin > m.descender * 0.35) add("fontEditor.drawPracticeTipUseDescender", "bottom");
    if (b.yMin < m.descender - m.em * 0.05) add("fontEditor.drawPracticeTipTooLow", "bottom");
    if (width < usable * 0.35) add("fontEditor.drawPracticeTipWider", "width");
  } else {
    if (b.yMax > m.xHeight + m.em * 0.12) add("fontEditor.drawPracticeTipStayXHeight", "top");
    if (b.yMin < m.baseline - m.em * 0.12) add("fontEditor.drawPracticeTipTouchBaseline", "bottom");
    if (width < usable * 0.35) add("fontEditor.drawPracticeTipWider", "width");
    if (width > usable * 0.78) add("fontEditor.drawPracticeTipNarrower", "width");
  }

  if (tips.length === 0) return [{ key: "fontEditor.drawPracticeTipGood", kind: "good" }];
  return tips.slice(0, 3);
}

export default function GlyphDrawingGuideDialog({
  metrics,
  onClose,
}: {
  metrics: StrokeFontMetrics;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<GuideMode>("examples");
  const [practiceStrokes, setPracticeStrokes] = useState<StrokePoint[][]>([]);
  const [activeStroke, setActiveStroke] = useState<StrokePoint[] | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drawingRef = useRef(false);
  const example = EXAMPLES[index];
  const top = metricTop(metrics);
  const bottom = metricBottom(metrics);
  const width = metrics.em;
  const height = top - bottom;
  const toY = (y: number) => top - y;
  const notes = exampleNotes(example.side);
  const noteTargets = new Set(notes.map((note) => note.target).filter(Boolean));
  const practicePoints = flatten(practiceStrokes, activeStroke);
  const practiceTips = evaluatePractice(example.key, metrics, practicePoints);
  const highlights = new Set(practiceTips.map((tip) => tip.highlight).filter(Boolean));
  const selectIndex = (nextIndex: number) => {
    setIndex(nextIndex);
    setPracticeStrokes([]);
    setActiveStroke(null);
  };
  const prev = () => selectIndex((index + EXAMPLES.length - 1) % EXAMPLES.length);
  const next = () => selectIndex((index + 1) % EXAMPLES.length);
  const resetPractice = () => {
    setPracticeStrokes([]);
    setActiveStroke(null);
  };
  const noteTargetPoint = (note: ExampleNote) => {
    if (!note.target) return null;
    const usable = Math.min(metrics.defaultAdvance, metrics.em * 0.82);
    const x = note.target === "advance"
      ? metrics.defaultAdvance
      : note.target === "width"
        ? usable * 0.82
        : note.side === "left"
          ? usable * 0.3
          : usable * 0.72;
    const y = note.target === "advance" || note.target === "width" ? height * 0.5 : toY(metrics[note.target]);
    return { x, y };
  };
  const toEm = useCallback(
    (clientX: number, clientY: number): StrokePoint => {
      const svg = svgRef.current;
      const ctm = svg?.getScreenCTM();
      if (!svg || !ctm) return { x: 0, y: 0 };
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const v = pt.matrixTransform(ctm.inverse());
      return viewToEm({ x: v.x, y: v.y }, top);
    },
    [top]
  );
  const beginPractice = (e: React.PointerEvent<SVGSVGElement>) => {
    if (mode !== "practice" || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    setActiveStroke([toEm(e.clientX, e.clientY)]);
  };
  const movePractice = (e: React.PointerEvent<SVGSVGElement>) => {
    if (mode !== "practice" || !drawingRef.current) return;
    const next = toEm(e.clientX, e.clientY);
    setActiveStroke((cur) => {
      const last = cur?.[cur.length - 1];
      if (!cur || (last && Math.hypot(next.x - last.x, next.y - last.y) < 1.5)) return cur;
      return [...cur, next];
    });
  };
  const finishPractice = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    setActiveStroke((cur) => {
      if (cur && cur.length > 0) setPracticeStrokes((strokes) => [...strokes, cur]);
      return null;
    });
  };

  return (
    <Modal
      title={t("fontEditor.drawGuideTitle")}
      onClose={onClose}
      className="fe-draw-guide-modal"
      bodyClassName="fe-draw-guide-modal-body"
    >
      <div className={`fe-draw-guide fe-draw-guide-${mode}`}>
        <aside className="fe-draw-guide-notes fe-draw-guide-notes-left">
          <h3>{mode === "practice" ? t("fontEditor.drawPracticeTipsTitle") : t(example.labelKey)}</h3>
          {mode === "practice" ? (
            practiceTips.map((tip) => (
              <p key={tip.key} className={`fe-draw-practice-tip ${tip.kind}`}>
                {t(tip.key)}
              </p>
            ))
          ) : (
            notes.filter((note) => note.side === "left").map((note) => (
              <p key={note.key} className={note.target ? "is-linked" : ""}>{t(note.key)}</p>
            ))
          )}
        </aside>

        <div className="fe-draw-guide-stage">
          <Segmented<GuideMode>
            className="fe-draw-guide-mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "examples", label: t("fontEditor.drawGuideModeExamples") },
              { value: "practice", label: t("fontEditor.drawGuideModePractice") },
            ]}
          />
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            className={`fe-draw-guide-svg ${mode === "practice" ? "is-practice" : ""}`}
            aria-label={t(example.labelKey)}
            onPointerDown={beginPractice}
            onPointerMove={movePractice}
            onPointerUp={finishPractice}
            onPointerCancel={finishPractice}
          >
            {Array.from({ length: 5 }, (_, i) => i * 0.25).map((f) => (
              <line key={f} className="fe-draw-guide-grid" x1={metrics.em * f} x2={metrics.em * f} y1={0} y2={height} />
            ))}
            <line className="fe-draw-guide-margin" x1={0} x2={0} y1={0} y2={height} />
            <line className={`fe-draw-guide-advance ${highlights.has("advance") || (mode === "examples" && noteTargets.has("advance")) ? "is-highlighted" : ""}`} x1={metrics.defaultAdvance} x2={metrics.defaultAdvance} y1={0} y2={height} />
            {METRIC_LINES.map((line) => {
              const y = toY(metrics[line.metric]);
              const highlighted =
                (highlights.has("top") && ["ascender", "cap", "xheight"].includes(line.className)) ||
                (highlights.has("bottom") && ["baseline", "descender"].includes(line.className)) ||
                (mode === "examples" && noteTargets.has(line.metric));
              return (
                <g key={line.metric} className={`fe-draw-guide-line fe-draw-guide-line-${line.className} ${highlighted ? "is-highlighted" : ""}`}>
                  <line x1={0} x2={width} y1={y} y2={y} />
                  <text x={10} y={y - 7}>{t(line.labelKey)}</text>
                </g>
              );
            })}
            {mode === "practice" ? (
              <>
                <rect className={`fe-draw-practice-target ${highlights.has("width") ? "is-highlighted" : ""}`} x={Math.min(metrics.defaultAdvance, metrics.em * 0.82) * 0.15} y={toY(metrics.xHeight)} width={Math.min(metrics.defaultAdvance, metrics.em * 0.82) * 0.67} height={metrics.xHeight - metrics.baseline} />
                <path className="fe-draw-guide-letter fe-draw-guide-letter-ghost" d={examplePath(example.key, metrics)} transform={`scale(1 -1) translate(0 ${-top})`} />
                {practiceStrokes.map((stroke, i) => (
                  <path key={i} className="fe-draw-practice-stroke" d={pointsToPath(stroke, top)} />
                ))}
                {activeStroke && <path className="fe-draw-practice-stroke active" d={pointsToPath(activeStroke, top)} />}
                <g
                  className="fe-draw-practice-reset-icon"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    resetPractice();
                  }}
                  role="button"
                  aria-label={t("fontEditor.drawPracticeReset")}
                >
                  <title>{t("fontEditor.drawPracticeReset")}</title>
                  <rect x={width - 94} y={height - 86} width={64} height={56} rx={14} />
                  <path d={`M ${width - 72} ${height - 62} L ${width - 52} ${height - 62} M ${width - 68} ${height - 56} L ${width - 56} ${height - 56} L ${width - 58} ${height - 42} L ${width - 66} ${height - 42} Z M ${width - 64} ${height - 66} L ${width - 60} ${height - 66}`} />
                </g>
              </>
            ) : (
              <>
                <path className="fe-draw-guide-letter" d={examplePath(example.key, metrics)} transform={`scale(1 -1) translate(0 ${-top})`} />
                <g className="fe-draw-guide-note-lines">
                  {notes.map((note) => {
                    const p = noteTargetPoint(note);
                    if (!p) return null;
                    return (
                      <g key={`${note.key}-line`}>
                        <line x1={note.side === "left" ? 0 : width} y1={p.y} x2={p.x} y2={p.y} />
                        <circle cx={p.x} cy={p.y} r={8} />
                      </g>
                    );
                  })}
                </g>
              </>
            )}
          </svg>
          <Segmented<number>
            className="fe-draw-guide-nav"
            value={index}
            onChange={selectIndex}
            options={EXAMPLES.map((item, i) => ({ value: i, label: item.key, title: t(item.labelKey) }))}
            suffix={
              <>
                <button type="button" onClick={prev} aria-label={t("fontEditor.drawGuidePrev")}>‹</button>
                <button type="button" onClick={next} aria-label={t("fontEditor.drawGuideNext")}>›</button>
              </>
            }
          />
        </div>

        <aside className="fe-draw-guide-notes fe-draw-guide-notes-right">
          {mode === "practice" ? (
            <>
              <p>{t("fontEditor.drawPracticeTarget", { key: example.key })}</p>
              <p>{t("fontEditor.drawPracticeHint")}</p>
            </>
          ) : (
            notes.filter((note) => note.side === "right").map((note) => (
              <p key={note.key} className={note.target ? "is-linked" : ""}>{t(note.key)}</p>
            ))
          )}
        </aside>
      </div>
    </Modal>
  );
}
