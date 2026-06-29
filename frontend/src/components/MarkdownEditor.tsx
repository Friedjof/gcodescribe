import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api, type Calibration, type GallerySvg, type PageScore, type SceneObject } from "../api";
import { transformPolylines } from "../paint/geometry";
import { type TextFont } from "../paint/text";
import { fontLabel, useTextFonts } from "../paint/useTextFonts";
import { parseMarkdown, type Block, type InlineToken } from "../markdown/parse";
import { layoutMarkdown, placeObjects, type LayoutOptions } from "../markdown/layout";
import { useI18n } from "../i18n";
import Modal from "./Modal";
import Segmented from "./Segmented";
import PolylinePreview from "./PolylinePreview";
import { ScoreOverlay } from "./PlotScore";

const DEBOUNCE_MS = 450;
const MARGIN_MM = 5;

type PreviewMode = "read" | "plot";

/** Build a flat world-space preview (mm, y down) from laid-out objects. */
function toSvg(objects: SceneObject[]): GallerySvg {
  const polylines: number[][][] = [];
  let w = 1;
  let h = 1;
  for (const obj of objects) {
    const lines = transformPolylines((obj.cachedPolylines ?? []) as any, obj.transform!);
    for (const line of lines) {
      polylines.push(line);
      for (const [x, y] of line) {
        w = Math.max(w, x);
        h = Math.max(h, y);
      }
    }
  }
  return { polylines, width: w, height: h };
}

export default function MarkdownEditor({
  cal,
  pageId,
  initialMarkdown,
  onClose,
  onInsert,
}: {
  cal: Calibration;
  pageId: string;
  initialMarkdown: string;
  onClose: () => void;
  onInsert: (objects: SceneObject[], markdown: string) => void;
}) {
  const { t } = useI18n();
  const { fonts } = useTextFonts();
  const [source, setSource] = useState(initialMarkdown || t("paint.md.sample"));
  const [font, setFont] = useState<TextFont>("sans");
  const [baseSize, setBaseSize] = useState(5);
  const [columnWidthMm, setColumnWidthMm] = useState(Math.round(cal.plot_width * 0.9));
  const [paragraphGap, setParagraphGap] = useState(3);
  const [connectSpaces, setConnectSpaces] = useState(false);
  const [debug, setDebug] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("read");
  const [svg, setSvg] = useState<GallerySvg | null>(null);
  const [score, setScore] = useState<PageScore | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);
  const hlRef = useRef<HTMLPreElement>(null);

  const blocks = useMemo(() => parseMarkdown(source), [source]);
  const opts: LayoutOptions = useMemo(
    () => ({ font, baseSize, columnWidthMm, paragraphGap, connectSpaces }),
    [font, baseSize, columnWidthMm, paragraphGap, connectSpaces]
  );

  // Debounced plot preview + live score (only while the plot tab is shown).
  useEffect(() => {
    if (previewMode !== "plot") return;
    const mine = ++seq.current;
    const timer = window.setTimeout(() => {
      if (blocks.length === 0) {
        setSvg(null);
        setScore(null);
        return;
      }
      layoutMarkdown(blocks, opts, "preview", t("paint.md.sample"))
        .then(({ objects }) => {
          if (seq.current !== mine) return;
          setSvg(toSvg(objects));
          return api.pageScore(pageId, objects).then((res) => {
            if (seq.current === mine) setScore(res);
          });
        })
        .catch(() => seq.current === mine && setErr(t("paint.md.previewError")));
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [blocks, opts, previewMode, pageId, t]);

  const insert = async (mode: "topLeft" | "center" | "fit") => {
    if (blocks.length === 0 || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const { objects, width, height } = await layoutMarkdown(blocks, opts, crypto.randomUUID(), t("paint.md.sample"));
      let scale = 1;
      let dx = MARGIN_MM;
      let dy = MARGIN_MM;
      if (mode === "fit") {
        scale = Math.min(1, (cal.plot_width * 0.95) / Math.max(width, 1), (cal.plot_height * 0.95) / Math.max(height, 1));
      }
      if (mode === "center" || mode === "fit") {
        dx = Math.max(0, (cal.plot_width - width * scale) / 2);
        dy = Math.max(0, (cal.plot_height - height * scale) / 2);
      }
      onInsert(placeObjects(objects, dx, dy, scale), source);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t("paint.md.title")}
      onClose={onClose}
      className="md-editor"
      bodyClassName="md-editor-body"
      footer={
        <div className="md-footer">
          <div className="md-options">
            <label className="field">
              {t("paint.font")}
              <select value={font} onChange={(e) => setFont(e.target.value as TextFont)}>
                {fonts.map((f) => (
                  <option key={f.id} value={f.id}>{fontLabel(f, t)}</option>
                ))}
              </select>
            </label>
            <label className="field">
              {t("paint.md.baseSize")}
              <div className="input-unit">
                <input type="number" min={3} max={40} step={1} value={baseSize}
                  onChange={(e) => setBaseSize(Math.max(3, Number(e.target.value) || 5))} />
                <em>mm</em>
              </div>
            </label>
            <label className="field">
              {t("paint.md.column")}
              <div className="input-unit">
                <input type="number" min={20} step={5} value={columnWidthMm}
                  onChange={(e) => setColumnWidthMm(Math.max(20, Number(e.target.value) || 20))} />
                <em>mm</em>
              </div>
            </label>
            <label className="field">
              {t("paint.md.gap")}
              <div className="input-unit">
                <input type="number" min={0} step={1} value={paragraphGap}
                  onChange={(e) => setParagraphGap(Math.max(0, Number(e.target.value) || 0))} />
                <em>mm</em>
              </div>
            </label>
            {font === "script" && (
              <label className="check md-check">
                <input type="checkbox" checked={connectSpaces} onChange={(e) => setConnectSpaces(e.target.checked)} />
                {t("paint.md.connectSpaces")}
              </label>
            )}
          </div>
          <div className="md-actions">
            <button className="ghost" disabled={busy || blocks.length === 0} onClick={() => insert("topLeft")}>
              {t("paint.md.placeTopLeft")}
            </button>
            <button className="ghost" disabled={busy || blocks.length === 0} onClick={() => insert("center")}>
              {t("paint.md.placeCenter")}
            </button>
            <button className="primary" disabled={busy || blocks.length === 0} onClick={() => insert("fit")}>
              {busy ? t("paint.md.placing") : t("paint.md.placeFit")}
            </button>
          </div>
        </div>
      }
    >
      <div className="md-split">
        <div className="md-source-wrap">
          <pre className="md-highlight" aria-hidden="true" ref={hlRef}>
            {highlightMarkdown(source)}
          </pre>
          <textarea
            className="md-source"
            value={source}
            spellCheck={false}
            onChange={(e) => setSource(e.target.value)}
            onScroll={(e) => {
              if (hlRef.current) {
                hlRef.current.scrollTop = e.currentTarget.scrollTop;
                hlRef.current.scrollLeft = e.currentTarget.scrollLeft;
              }
            }}
            placeholder={t("paint.md.placeholder")}
          />
        </div>
        <div className="md-preview">
          <div className="md-preview-head">
            <Segmented<PreviewMode>
              className="md-preview-seg"
              value={previewMode}
              onChange={setPreviewMode}
              options={[
                { value: "read", label: t("paint.md.previewRead") },
                { value: "plot", label: t("paint.md.previewPlot") },
              ]}
            />
            {previewMode === "plot" && (
              <label className="check md-debug-toggle">
                <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} />
                {t("paint.md.debug")}
              </label>
            )}
          </div>
          {previewMode === "read" ? (
            <div className="md-render">
              {blocks.length === 0 ? <p className="muted">{t("paint.md.empty")}</p> : blocks.map((b, i) => <RenderBlock key={i} block={b} />)}
            </div>
          ) : (
            <div className="md-plot">
              {svg ? debug ? <PlotDebug data={svg} /> : <PolylinePreview data={svg} /> : <p className="muted">{t("paint.md.empty")}</p>}
              <ScoreOverlay result={score} />
            </div>
          )}
        </div>
      </div>
      {err && <div className="banner err md-err">{err}</div>}
    </Modal>
  );
}

// --- plot debug view: pen-down strokes + pen-up travel + start/end points ---

type DPt = number[];

/** Order strokes the way the backend does (nearest-neighbour, with reversal)
 * and collect the pen-up moves between them. */
function buildTravel(lines: number[][][]): { order: number[][][]; travel: [DPt, DPt][] } {
  const remaining = lines.filter((l) => l.length >= 2).map((l) => l);
  const order: number[][][] = [];
  const travel: [DPt, DPt][] = [];
  let cursor: DPt = [0, 0];
  while (remaining.length) {
    let bi = 0, rev = false, bd = Infinity;
    remaining.forEach((line, i) => {
      const ds = Math.hypot(line[0][0] - cursor[0], line[0][1] - cursor[1]);
      const de = Math.hypot(line[line.length - 1][0] - cursor[0], line[line.length - 1][1] - cursor[1]);
      if (ds < bd) { bi = i; rev = false; bd = ds; }
      if (de < bd) { bi = i; rev = true; bd = de; }
    });
    let line = remaining.splice(bi, 1)[0];
    if (rev) line = [...line].reverse();
    if (order.length) travel.push([cursor, line[0]]);
    order.push(line);
    cursor = line[line.length - 1];
  }
  return { order, travel };
}

function PlotDebug({ data }: { data: GallerySvg }) {
  const { order, travel } = useMemo(() => buildTravel(data.polylines), [data.polylines]);
  const w = Math.max(data.width, 1);
  const h = Math.max(data.height, 1);
  const sw = Math.max(w, h) / 350;
  const draw = order.map((line) => "M" + line.map(([x, y]) => `${x},${y}`).join("L")).join("");
  const trav = travel.map(([a, b]) => `M${a[0]},${a[1]}L${b[0]},${b[1]}`).join("");
  return (
    <svg className="poly-preview" viewBox={`${-w * 0.02} ${-h * 0.02} ${w * 1.04} ${h * 1.04}`} preserveAspectRatio="xMidYMid meet">
      <path d={trav} fill="none" stroke="#e0563f" strokeWidth={sw * 0.7} strokeDasharray={`${sw * 3},${sw * 3}`} />
      <path d={draw} fill="none" stroke="var(--text)" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      {order.map((line, i) => (
        <g key={i}>
          <circle cx={line[0][0]} cy={line[0][1]} r={sw * 2.2} fill="#36c06a" />
          <circle cx={line[line.length - 1][0]} cy={line[line.length - 1][1]} r={sw * 1.7} fill="#3b82f6" />
        </g>
      ))}
    </svg>
  );
}

function RenderBlock({ block }: { block: Block }) {
  const content = block.inline.map((tok, i) => <RenderInline key={i} token={tok} />);
  if (block.kind === "h1") return <h1>{content}</h1>;
  if (block.kind === "h2") return <h2>{content}</h2>;
  if (block.kind === "h3") return <h3>{content}</h3>;
  if (block.kind === "li") return <div className="md-li">{block.ordinal != null ? `${block.ordinal}.` : "•"} {content}</div>;
  return <p>{content}</p>;
}

function RenderInline({ token }: { token: InlineToken }) {
  if (token.kind === "strong") return <strong>{token.text}</strong>;
  if (token.kind === "em") return <em>{token.text}</em>;
  if (token.kind === "code") return <code>{token.text}</code>;
  if (token.kind === "link") return <a href={token.href} target="_blank" rel="noreferrer">{token.text}</a>;
  return <>{token.text}</>;
}

// --- source syntax highlighting (backdrop layer behind the textarea) ---

const INLINE_HL = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\))/g;

/** Colour bold / italic / code / link spans within a line (markers kept). */
function highlightInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_HL.lastIndex = 0;
  let k = 0;
  while ((m = INLINE_HL.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const cls = tok.startsWith("`")
      ? "hl-code"
      : tok.startsWith("[")
        ? "hl-link"
        : tok.startsWith("**") || tok.startsWith("__")
          ? "hl-strong"
          : "hl-em";
    out.push(<span key={`${keyBase}-${k++}`} className={cls}>{tok}</span>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Render one source line with heading / list / inline colouring. */
function highlightLine(line: string, key: string): ReactNode {
  const heading = /^(#{1,3})(\s+)(.*)$/.exec(line);
  if (heading) {
    return (
      <span className={`hl-h${heading[1].length}`}>
        <span className="hl-marker">{heading[1]}</span>
        {heading[2]}
        {highlightInline(heading[3], key)}
      </span>
    );
  }
  const list = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/.exec(line);
  if (list) {
    return (
      <>
        {list[1]}
        <span className="hl-marker">{list[2]}</span>
        {list[3]}
        {highlightInline(list[4], key)}
      </>
    );
  }
  return <>{highlightInline(line, key)}</>;
}

/** Highlighted mirror of the markdown source for the editor backdrop. */
function highlightMarkdown(src: string): ReactNode[] {
  const lines = src.split("\n");
  const out: ReactNode[] = [];
  lines.forEach((line, i) => {
    out.push(<span key={i}>{highlightLine(line, String(i))}</span>);
    if (i < lines.length - 1) out.push("\n");
  });
  // Trailing newline keeps the backdrop height in sync with the textarea.
  out.push("\n");
  return out;
}
