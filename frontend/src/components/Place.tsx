import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type Calibration,
  type Source,
  type SourcePreview,
} from "../api";
import { useI18n } from "../i18n";
import Segmented from "./Segmented";

type Mode = "auto" | "vector" | "trace";

// Placement: lower-left corner (px, py) in printer mm + target width in mm.
interface Placement {
  x: number;
  y: number;
  width: number;
}

export default function Place({
  status,
  onAction,
}: {
  status: any;
  onAction: () => void;
}) {
  const { t } = useI18n();
  const [cal, setCal] = useState<Calibration | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [sel, setSel] = useState<Source | null>(null);
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  const [mode, setMode] = useState<Mode>("auto");
  const [detail, setDetail] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    kind: "move" | "scale";
    startX: number;
    startY: number;
    orig: Placement;
  } | null>(null);

  const online = status?.online;

  const loadSources = useCallback(
    () => api.listSources().then(setSources).catch(() => {}),
    []
  );

  useEffect(() => {
    api.getCalibration().then(setCal).catch((e) => setErr(String(e.message)));
    // Jobs generated here are bound to the active profile — show which one.
    api.activeProfile().then((p) => setProfileName(p.name)).catch(() => {});
    loadSources();
  }, [loadSources]);

  const flash = (m: string) => {
    setMsg(m);
    setErr(null);
    setTimeout(() => setMsg(null), 4000);
  };
  const fail = (e: any) => setErr(String(e.message ?? e));

  const pageInfo = sel?.pages.find((p) => p.n === page);

  // Load a source's page preview and default its placement to fit the plot area.
  useEffect(() => {
    if (!sel || !cal) {
      setPreview(null);
      setPlace(null);
      return;
    }
    api
      .sourcePreview(sel.id, page)
      .then((pv) => {
        setPreview(pv);
        // Use the content bounding box (not the page size): the backend scales
        // the drawing's bbox to `width`, so the placement must too — otherwise
        // pages with whitespace overflow the plot area.
        const cw = pv.bounds ? pv.bounds[2] - pv.bounds[0] : pv.width;
        const ch = pv.bounds ? pv.bounds[3] - pv.bounds[1] : pv.height;
        const aspect = ch / cw || 1;
        // Fit within the plot area, centered, with a little breathing room.
        let w = cal.plot_width * 0.9;
        if (w * aspect > cal.plot_height * 0.9) w = (cal.plot_height * 0.9) / aspect;
        const x = cal.origin_x + (cal.plot_width - w) / 2;
        const y = cal.origin_y + (cal.plot_height - w * aspect) / 2;
        setPlace({ x, y, width: w });
      })
      .catch(fail);
  }, [sel, page, cal]);

  const upload = async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      const src = await api.createSource(file, mode, detail);
      await loadSources();
      setSel(src);
      setPage(1);
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
    setBusy(true);
    try {
      const job = await api.sourceGcode(sel.id, page, place.x, place.y, place.width);
      if (send) {
        await api.send(job.filename, false);
        flash(t("place.gcodeSent", { file: job.filename }));
        onAction();
      } else {
        flash(t("place.gcodeCreated", { file: job.filename }));
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
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

  return (
    <div className="grid place-grid">
      <section className="card">
        <h2>{t("place.previewTitle")}</h2>
        {profileName && (
          <p className="muted paint-profile">{t("paint.activeProfile", { name: profileName })}</p>
        )}
        <div className="liveview">
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
        </div>
        {place && (
          <div className="place-controls">
            <label className="field">
              <span>{t("common.width")}</span>
              <div className="input-unit">
                <input type="number" step="1" value={place.width.toFixed(0)}
                  onChange={(e) => setWidth(parseFloat(e.target.value) || 5)} />
                <em>mm</em>
              </div>
            </label>
            <div className="place-readout muted">
              {place.width.toFixed(0)} × {drawH.toFixed(0)} mm · {t("place.corner")} ({place.x.toFixed(0)}, {place.y.toFixed(0)})
            </div>
          </div>
        )}
        <div className="job-controls" style={{ marginTop: 12 }}>
          <button className="primary" disabled={!place || busy} onClick={() => generate(false)}>
            {t("common.generateGcode")}
          </button>
          <button disabled={!place || busy || !online} onClick={() => generate(true)}>
            {t("place.generateSend")}
          </button>
        </div>
        {msg && <div className="banner ok">{msg}</div>}
        {err && <div className="banner err">{err}</div>}
      </section>

      <section className="card">
        <h2>{t("place.loadDocument")}</h2>
        <div className="field-group">
          <h3>{t("place.mode")}</h3>
          <Segmented<Mode>
            value={mode}
            onChange={setMode}
            options={[
              { value: "auto", label: t("place.modeAuto") },
              { value: "vector", label: t("place.modeVector") },
              { value: "trace", label: t("place.modeTrace") },
            ]}
          />
          <p className="muted hint">
            {mode === "auto"
              ? t("place.hintAuto")
              : mode === "vector"
              ? t("place.hintVector")
              : t("place.hintTrace")}
          </p>
          {(mode === "trace" || mode === "auto") && (
            <>
              <h3 style={{ marginTop: 12 }}>{t("place.detailLevel")}</h3>
              <Segmented
                value={detail}
                onChange={setDetail}
                options={[
                  { value: 1, label: t("place.coarse") },
                  { value: 2, label: t("place.medium") },
                  { value: 3, label: t("place.fine") },
                ]}
              />
            </>
          )}
        </div>
        <label className={`dropzone ${busy ? "busy" : ""}`}>
          <input type="file" accept=".pdf,.svg,.png,.jpg,.jpeg,.bmp,.tif,.tiff,.odt,.ods,.odp,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
            disabled={busy}
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          {busy ? t("place.processing") : t("place.dropzone")}
        </label>

        <div className="field-group" style={{ marginTop: 18 }}>
          <h3>{t("place.loadedDocs")}</h3>
          {sources.length === 0 && <p className="muted">{t("place.nothingLoaded")}</p>}
          <ul className="jobs">
            {sources.map((s) => (
              <li key={s.id} className={sel?.id === s.id ? "sel" : ""}>
                <button className="src-pick" onClick={() => { setSel(s); setPage(1); }}>
                  <span className="name">{s.name}</span>
                  <span className="muted">
                    {s.mode === "trace" ? t("place.traced") : t("place.vector")} · {s.pages.length} {t("place.pagesShort")} ·{" "}
                    {s.pages.reduce((a, p) => a + p.lines, 0)} {t("place.linesShort")}
                  </span>
                </button>
                <button className="ghost" onClick={() =>
                  api.deleteSource(s.id).then(() => {
                    if (sel?.id === s.id) setSel(null);
                    loadSources();
                  }).catch(fail)
                }>✕</button>
              </li>
            ))}
          </ul>
        </div>

        {sel && sel.pages.length > 1 && (
          <div className="field-group">
            <h3>{t("place.page")}</h3>
            <Segmented
              value={page}
              onChange={setPage}
              wrap
              options={sel.pages.map((p) => ({ value: p.n, label: p.n }))}
            />
          </div>
        )}
        {pageInfo && (
          <p className="muted">
            {t("place.original", {
              w: pageInfo.width.toFixed(0),
              h: pageInfo.height.toFixed(0),
              lines: pageInfo.lines,
            })}
          </p>
        )}
      </section>
    </div>
  );
}
