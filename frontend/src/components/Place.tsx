import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type Calibration,
  type Source,
  type SourcePreview,
} from "../api";
import { useI18n } from "../i18n";
import type { PageScore } from "../api";
import { localize, type Pt } from "../paint/geometry";
import { ScoreOverlay } from "./PlotScore";
import Segmented from "./Segmented";

type Mode = "auto" | "vector" | "trace" | "handwriting";

// Placement: lower-left corner (px, py) in printer mm + target width in mm.
interface Placement {
  x: number;
  y: number;
  width: number;
}

// Tiny rail thumbnails + the heavier canvas previews, cached across selections
// (and across tab switches) so re-opening a source is instant.
const thumbCache = new Map<string, SourcePreview>();
const previewCache = new Map<string, SourcePreview>();
// Detail cap for the on-screen placement preview — far below the full 20k the
// designer import uses, since the bed view only needs a clean vector outline.
const CANVAS_PREVIEW_POINTS = 6000;

export default function Place({
  status,
  onAction,
  onOpenPaint,
}: {
  status: any;
  onAction: () => void;
  onOpenPaint: () => void;
}) {
  const { t } = useI18n();
  const [cal, setCal] = useState<Calibration | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [sel, setSel] = useState<Source | null>(null);
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, SourcePreview>>({});
  const [mode, setMode] = useState<Mode>("auto");
  const [detail, setDetail] = useState(1);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [score, setScore] = useState<PageScore | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scoreSeq = useRef(0);
  const drag = useRef<{
    kind: "move" | "scale";
    startX: number;
    startY: number;
    orig: Placement;
  } | null>(null);

  const online = status?.online;

  // Whole rail in one request (cached server-side), instead of one round-trip
  // per source — populate the shared cache so thumbs paint immediately.
  const loadThumbs = useCallback(
    () =>
      api
        .sourceThumbnails()
        .then((all) => {
          for (const [id, pv] of Object.entries(all)) thumbCache.set(id, pv);
          setThumbs(all);
        })
        .catch(() => {}),
    []
  );

  const loadSources = useCallback(
    () => api.listSources().then(setSources).catch(() => {}),
    []
  );

  useEffect(() => {
    api.getCalibration().then(setCal).catch((e) => setErr(String(e.message)));
    // Jobs generated here are bound to the active profile — show which one.
    api.activeProfile().then((p) => setProfileName(p.name)).catch(() => {});
    loadSources();
    loadThumbs();
  }, [loadSources, loadThumbs]);

  const flash = (m: string) => {
    setMsg(m);
    setErr(null);
    setTimeout(() => setMsg(null), 4000);
  };
  const fail = (e: any) => setErr(String(e.message ?? e));

  // Load a source's page preview and default its placement to fit the plot area.
  useEffect(() => {
    if (!sel || !cal) {
      setPreview(null);
      setPlace(null);
      return;
    }
    // Use the content bounding box (not the page size): the backend scales the
    // drawing's bbox to `width`, so the placement must too — otherwise pages
    // with whitespace overflow the plot area. Centered, with breathing room.
    const fit = (pv: SourcePreview) => {
      const cw = pv.bounds ? pv.bounds[2] - pv.bounds[0] : pv.width;
      const ch = pv.bounds ? pv.bounds[3] - pv.bounds[1] : pv.height;
      const aspect = ch / cw || 1;
      let w = cal.plot_width * 0.9;
      if (w * aspect > cal.plot_height * 0.9) w = (cal.plot_height * 0.9) / aspect;
      const x = cal.origin_x + (cal.plot_width - w) / 2;
      const y = cal.origin_y + (cal.plot_height - w * aspect) / 2;
      setPlace({ x, y, width: w });
    };

    const key = `${sel.id}:${page}`;
    // Show something instantly: the cached full preview, else the rail thumbnail,
    // while the higher-detail preview loads in the background.
    const placeholder = previewCache.get(key) ?? thumbCache.get(sel.id) ?? null;
    if (placeholder) {
      setPreview(placeholder);
      fit(placeholder);
    } else {
      setPreview(null);
    }

    if (previewCache.has(key)) return; // already at full detail

    let alive = true;
    setLoadingPreview(true);
    api
      .sourcePreview(sel.id, page, CANVAS_PREVIEW_POINTS)
      .then((pv) => {
        if (!alive) return;
        previewCache.set(key, pv);
        setPreview(pv);
        if (!placeholder) fit(pv); // keep the placement we already fitted
      })
      .catch((e) => alive && fail(e))
      .finally(() => alive && setLoadingPreview(false));
    return () => {
      alive = false;
    };
  }, [sel, page, cal]);

  // Live plottability rating of the current placement — debounced, same backend
  // evaluation the gallery and the designer use, without writing a job file.
  useEffect(() => {
    if (!sel || !place) {
      setScore(null);
      return;
    }
    const mine = ++scoreSeq.current;
    const timer = window.setTimeout(() => {
      api
        .sourceScore(sel.id, page, place.x, place.y, place.width)
        .then((res) => scoreSeq.current === mine && setScore(res))
        .catch(() => scoreSeq.current === mine && setScore(null));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [sel, page, place]);

  const upload = async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      const src = await api.createSource(file, mode, detail);
      await loadSources();
      setSel(src);
      setPage(1);
      loadThumbs(); // refresh the rail in the background — don't block selection
      flash(
        t("place.loaded", {
          name: src.name,
          mode: src.mode === "trace" ? t("place.traced") : t("place.vector"),
          pages: src.pages.length,
        })
      );
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const pickFile = (file: File | undefined | null) => {
    if (file) upload(file);
  };

  const removeSource = (s: Source) => {
    api
      .deleteSource(s.id)
      .then(() => {
        thumbCache.delete(s.id);
        for (const k of previewCache.keys()) if (k.startsWith(`${s.id}:`)) previewCache.delete(k);
        if (sel?.id === s.id) setSel(null);
        loadSources();
        loadThumbs();
      })
      .catch(fail);
  };

  if (!cal) return <div className="card">{t("common.loading")}</div>;

  const W = cal.bed_width;
  const H = cal.bed_height;
  const ty = (y: number) => H - y; // printer y up -> svg y down
  // Aspect from the content bbox (matches the backend's scaling basis).
  const contentW = preview ? (preview.bounds ? preview.bounds[2] - preview.bounds[0] : preview.width) : 1;
  const contentH = preview ? (preview.bounds ? preview.bounds[3] - preview.bounds[1] : preview.height) : 1;
  const aspect = preview ? contentH / contentW || 1 : 1;
  const drawH = place ? place.width * aspect : 0;

  // Convert a pointer event to printer-mm coordinates.
  const toMM = (e: React.PointerEvent) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: ty(p.y) };
  };

  const onPointerDown = (kind: "move" | "scale") => (e: React.PointerEvent) => {
    if (!place) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const m = toMM(e);
    drag.current = { kind, startX: m.x, startY: m.y, orig: { ...place } };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !place) return;
    const m = toMM(e);
    const d = drag.current;
    if (d.kind === "move") {
      let x = d.orig.x + (m.x - d.startX);
      let y = d.orig.y + (m.y - d.startY);
      // Clamp inside the plot area.
      x = Math.max(cal.origin_x, Math.min(x, cal.origin_x + cal.plot_width - place.width));
      y = Math.max(cal.origin_y, Math.min(y, cal.origin_y + cal.plot_height - drawH));
      setPlace({ ...place, x, y });
    } else {
      // Scale by dragging the top-right handle; keep lower-left fixed.
      let w = Math.max(5, m.x - place.x);
      const maxW = cal.origin_x + cal.plot_width - place.x;
      const maxH = cal.origin_y + cal.plot_height - place.y;
      w = Math.min(w, maxW, maxH / aspect);
      setPlace({ ...place, width: w });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (drag.current) (e.target as Element).releasePointerCapture?.(e.pointerId);
    drag.current = null;
  };

  const setWidth = (w: number) => {
    if (!place) return;
    const maxW = cal.origin_x + cal.plot_width - place.x;
    const maxH = cal.origin_y + cal.plot_height - place.y;
    setPlace({ ...place, width: Math.max(5, Math.min(w, maxW, maxH / aspect)) });
  };

  const generate = async (send: boolean) => {
    if (!sel || !place) return;
    if (send) setSending(true); else setBusy(true);
    try {
      const job = await api.sourceGcode(sel.id, page, place.x, place.y, place.width);
      if (send) {
        // Plot directly — upload and start the print right away.
        await api.send(job.filename, true);
        flash(t("place.gcodeSent", { file: job.filename }));
        onAction();
      } else {
        flash(t("place.gcodeCreated", { file: job.filename }));
      }
    } catch (e) {
      fail(e);
    } finally {
      setSending(false);
      setBusy(false);
    }
  };

  // Hand the current drawing off to the full designer as an editable image
  // object, scaled to the placement, on a fresh page — then switch tabs.
  const toDesigner = () => {
    if (!sel || !preview || !place || busy) return;
    setBusy(true);
    setErr(null);
    const name = sel.name.replace(/\.[^.]+$/, "");
    const { local } = localize(preview.polylines as Pt[][]);
    const contentW = preview.bounds ? preview.bounds[2] - preview.bounds[0] : preview.width;
    const scale = place.width / Math.max(contentW, 1);
    api
      .createPage(name)
      .then((newPage) =>
        api.savePage(newPage.id, {
          objects: [
            {
              id: crypto.randomUUID(),
              type: "image",
              data: { sourceId: sel.id, name, basePolylines: local },
              cachedPolylines: local,
              transform: { x: cal.plot_width / 2, y: cal.plot_height / 2, rotation: 0, scale },
              plotted: false,
            },
          ],
        })
      )
      .then(() => onOpenPaint())
      .catch(fail)
      .finally(() => setBusy(false));
  };

  // Grid lines every 10mm.
  const grid = [];
  for (let gx = 0; gx <= W; gx += 10)
    grid.push(<line key={`v${gx}`} x1={gx} y1={0} x2={gx} y2={H}
      stroke="var(--border)" strokeWidth={gx % 50 === 0 ? 0.4 : 0.15} />);
  for (let gy = 0; gy <= H; gy += 10)
    grid.push(<line key={`h${gy}`} x1={0} y1={ty(gy)} x2={W} y2={ty(gy)}
      stroke="var(--border)" strokeWidth={gy % 50 === 0 ? 0.4 : 0.15} />);

  // Scale source-mm preview coords into the placement rectangle.
  const previewPolys = () => {
    if (!preview || !place) return null;
    // Scale and offset the content bbox to the placement rect, exactly like the
    // backend's tx(): lower-left of the bbox maps to (place.x, place.y).
    const [bx0, , bx1, by1] = preview.bounds ?? [0, 0, preview.width, preview.height];
    const s = place.width / (bx1 - bx0 || 1);
    return preview.polylines.map((line, i) => (
      <polyline
        key={i}
        points={line
          .map(([X, Y]) => `${place.x + (X - bx0) * s},${ty(place.y + (by1 - Y) * s)}`)
          .join(" ")}
        fill="none"
        stroke="var(--busy)"
        strokeWidth={0.4}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    ));
  };

  const meta = (s: Source) =>
    `${s.mode === "trace" ? t("place.traced") : t("place.vector")} · ${s.pages.length} ${t("place.pagesShort")} · ${s.pages.reduce((a, p) => a + p.lines, 0)} ${t("place.linesShort")}`;

  return (
    <div className="place-app">
      <input
        ref={fileRef}
        type="file"
        hidden
        accept=".pdf,.svg,.png,.jpg,.jpeg,.bmp,.tif,.tiff,.odt,.ods,.odp,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
        disabled={busy}
        onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }}
      />

      {/* ---- file rail ---- */}
      <aside className="place-rail">
        <button className="place-upload-btn" disabled={busy} onClick={() => fileRef.current?.click()}>
          <span className="plus">＋</span> {busy ? t("place.processing") : t("place.loadDocument")}
        </button>

        {/* import settings — always visible, applied to the next upload */}
        <div className="place-import-opts">
          <div className="place-opts-row">
            <span className="place-opts-label">{t("place.mode")}</span>
            <Segmented<Mode>
              className="place-mode-seg"
              value={mode}
              onChange={setMode}
              options={[
                { value: "auto", label: <span className="place-mode-icon">✦</span>, title: t("place.modeAuto") },
                { value: "vector", label: <span className="place-mode-icon">▱</span>, title: t("place.modeVector") },
                { value: "trace", label: <span className="place-mode-icon">〰</span>, title: t("place.modeTrace") },
                { value: "handwriting", label: <span className="place-mode-icon">✎</span>, title: t("place.modeHandwriting") },
              ]}
            />
          </div>
          {(mode === "trace" || mode === "auto" || mode === "handwriting") && (
            <div className="place-opts-row">
              <span className="place-opts-label">{t("place.detailLevel")}</span>
              <Segmented
                value={detail}
                onChange={setDetail}
                options={[
                  { value: 1, label: t("place.coarse") },
                  { value: 2, label: t("place.medium") },
                  { value: 3, label: t("place.fine") },
                ]}
              />
            </div>
          )}
          <p className="muted hint">
            {mode === "auto" ? t("place.hintAuto") : mode === "vector" ? t("place.hintVector") : mode === "handwriting" ? t("place.hintHandwriting") : t("place.hintTrace")}
          </p>
        </div>

        <h3 className="place-rail-title">{t("place.loadedDocs")}</h3>
        <ul className="place-rail-list">
          {sources.map((s) => (
            <li key={s.id} className={sel?.id === s.id ? "active" : ""}>
              <button className="place-thumb-btn" onClick={() => { setSel(s); setPage(1); }}>
                <div className="place-thumb">
                  <SourceThumb id={s.id} data={thumbs[s.id]} />
                </div>
                <div className="place-thumb-meta">
                  <span className="name">{s.name}</span>
                  <span className="muted">{meta(s)}</span>
                </div>
              </button>
              <button className="ghost tiny place-thumb-del" title="✕" onClick={() => removeSource(s)}>✕</button>
            </li>
          ))}
          {sources.length === 0 && <li className="place-rail-empty muted">{t("place.nothingLoaded")}</li>}
        </ul>
      </aside>

      {/* ---- bed stage ---- */}
      <section
        className={`place-stage ${dragOver ? "drag-over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0]); }}
      >
        <div className="place-canvas">
          {sel && <ScoreOverlay result={score} />}
          {profileName && (
            <span className="place-profile-chip">{t("paint.activeProfile", { name: profileName })}</span>
          )}
          <svg
            ref={svgRef}
            viewBox={`-8 -8 ${W + 16} ${H + 16}`}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <rect x={0} y={0} width={W} height={H} rx={2}
              fill="var(--panel-2)" stroke="var(--border)" strokeWidth={1} />
            {grid}
            {/* plot area */}
            <rect
              x={cal.origin_x} y={ty(cal.origin_y + cal.plot_height)}
              width={cal.plot_width} height={cal.plot_height}
              fill="rgba(10,132,255,0.05)" stroke="var(--accent)"
              strokeWidth={0.6} strokeDasharray="4 3"
            />
            {/* placement */}
            {place && preview && (
              <>
                <rect
                  x={place.x} y={ty(place.y + drawH)}
                  width={place.width} height={drawH}
                  fill="rgba(191,90,242,0.07)" stroke="var(--busy)"
                  strokeWidth={0.4} strokeDasharray="2 2"
                  style={{ cursor: "move" }}
                  onPointerDown={onPointerDown("move")}
                />
                {previewPolys()}
                {/* scale handle (top-right) */}
                <circle
                  cx={place.x + place.width} cy={ty(place.y + drawH)} r={2.4}
                  fill="var(--busy)" stroke="#fff" strokeWidth={0.4}
                  style={{ cursor: "nesw-resize" }}
                  onPointerDown={onPointerDown("scale")}
                />
              </>
            )}
            <text x={1} y={H + 6.5} fontSize={6} fill="var(--muted)">0,0</text>
          </svg>

          {!sel && !busy && (
            <button
              className="place-empty"
              onClick={() => fileRef.current?.click()}
            >
              <span className="place-empty-icon">⬑</span>
              <strong>{t("place.dropzone")}</strong>
              <span className="muted">{t("place.nothingLoaded")}</span>
            </button>
          )}

          {(busy || loadingPreview) && (
            <div className="place-loading">
              <span className="spinner" />
              <span>{busy ? t("place.processing") : t("common.loading")}</span>
            </div>
          )}
        </div>

        {sel && place && (
          <div className="place-bar">
            {sel.pages.length > 1 && (
              <Segmented
                value={page}
                onChange={setPage}
                wrap
                options={sel.pages.map((p) => ({ value: p.n, label: p.n }))}
              />
            )}
            <label className="field place-width">
              <span>{t("common.width")}</span>
              <div className="input-unit">
                <input type="number" step="1" value={place.width.toFixed(0)}
                  onChange={(e) => setWidth(parseFloat(e.target.value) || 5)} />
                <em>mm</em>
              </div>
            </label>
            <span className="place-readout muted">
              {place.width.toFixed(0)} × {drawH.toFixed(0)} mm · {t("place.corner")} ({place.x.toFixed(0)}, {place.y.toFixed(0)})
            </span>
            <div className="place-bar-actions">
              <button className="ghost" disabled={busy || sending || !preview} onClick={toDesigner}>
                {t("gallery.toPaint")}
              </button>
              <button className="ghost" disabled={busy || sending} onClick={() => generate(false)}>
                {t("common.generateGcode")}
              </button>
              <button className="primary" disabled={busy || sending || !online} onClick={() => generate(true)}>
                {sending ? t("paint.starting") : t("paint.directPlot")}
              </button>
            </div>
          </div>
        )}

        {(msg || err) && (
          <div className="place-banners">
            {msg && <div className="banner ok">{msg}</div>}
            {err && <div className="banner err">{err}</div>}
          </div>
        )}
      </section>
    </div>
  );
}

/** Tight polyline thumbnail of a source's first page, cropped to its content. */
function SourceThumb({ id, data }: { id: string; data?: SourcePreview }) {
  const [pv, setPv] = useState<SourcePreview | null>(data ?? thumbCache.get(id) ?? null);

  useEffect(() => {
    if (data) {
      setPv(data);
      return;
    }
    if (pv) return;
    // Fallback for a source not yet in the batch (rare) — fetch its single thumb.
    let alive = true;
    api
      .sourceThumbnail(id)
      .then((res) => {
        thumbCache.set(id, res);
        if (alive) setPv(res);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, pv, data]);

  if (!pv) return <span className="muted">…</span>;
  const [bx0, by0, bx1, by1] = pv.bounds ?? [0, 0, pv.width, pv.height];
  const w = Math.max(bx1 - bx0, 1);
  const h = Math.max(by1 - by0, 1);
  const d = pv.polylines
    .map((line) => "M" + line.map(([x, y]) => `${x},${y}`).join("L"))
    .join("");
  return (
    <svg
      className="poly-preview"
      viewBox={`${bx0 - w * 0.04} ${by0 - h * 0.04} ${w * 1.08} ${h * 1.08}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <path d={d} fill="none" stroke="var(--busy)" strokeWidth={Math.max(w, h) / 300}
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
