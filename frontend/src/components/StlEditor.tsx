import { useEffect, useMemo, useRef, useState } from "react";
import type { Calibration, PageColoring } from "../api";
import { useI18n } from "../i18n";
import type { TemplateSpec } from "../games/types";
import { toPath } from "../paint/geometry";
import {
  allPolylines,
  cameraFromParams,
  computeStl,
  DEFAULT_PARAMS,
  parseStl,
  prepareMesh,
  PRESETS,
  stlColoring,
  type DimStyle,
  type EdgeModel,
  type HiddenMode,
  type Mesh,
  type StlComputeResult,
  type StlParams,
} from "../stl";
import Modal from "./Modal";
import StlView3D from "./StlView3D";
import { useToasts } from "./Toasts";

const MAX_STL_MB = 20;
const PEN_COLORS = ["black", "red", "blue", "green"] as const;
// Swatch colours (UI).
const COLOR_HEX: Record<string, string> = {
  black: "#111111", red: "#ff453a", blue: "#0a84ff", green: "#30d158",
};
// Stroke colours for the light-paper 2D preview (good contrast on white).
const INK_HEX: Record<string, string> = {
  black: "#161616", red: "#d22020", blue: "#2552dd", green: "#1a8a3a",
};

export interface StlSavePayload {
  stl: ArrayBuffer;
  filename: string;
  params: StlParams;
  result: StlComputeResult;
}

export default function StlEditor({
  cal,
  busy = false,
  onClose,
  onInsert,
  initialStl,
  initialParams,
  initialName,
  onSaveGallery,
  saving = false,
}: {
  cal: Calibration;
  busy?: boolean;
  onClose: () => void;
  onInsert: (template: TemplateSpec, coloring: PageColoring | null) => void;
  initialStl?: ArrayBuffer;
  initialParams?: StlParams;
  initialName?: string;
  onSaveGallery?: (payload: StlSavePayload) => void;
  saving?: boolean;
}) {
  const { t } = useI18n();
  const toast = useToasts();

  const [mesh, setMesh] = useState<Mesh | null>(null);
  const [model, setModel] = useState<EdgeModel | null>(null);
  const [fileName, setFileName] = useState(initialName ?? "model.stl");
  const [params, setParams] = useState<StlParams>(initialParams ?? DEFAULT_PARAMS);
  const [result, setResult] = useState<StlComputeResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Bumped only on *external* orientation changes (presets, axis flips).
  const [orientToken, setOrientToken] = useState(0);
  const [resetToken, setResetToken] = useState(0);

  const stlRef = useRef<ArrayBuffer | null>(initialStl ?? null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<StlParams>) => setParams((p) => ({ ...p, ...patch }));

  // ---- mesh loading -------------------------------------------------------
  const loadBuffer = (buf: ArrayBuffer, name: string) => {
    try {
      const m = parseStl(buf);
      if (!m.triangles.length) { setErr(t("stl.errorEmpty")); return; }
      stlRef.current = buf;
      setMesh(m);
      setModel(prepareMesh(m));
      setFileName(name);
      setErr(null);
      setOrientToken((n) => n + 1);
      setResetToken((n) => n + 1);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  };

  const pickFile = async (file: File | null | undefined) => {
    if (!file) return;
    if (!/\.stl$/i.test(file.name)) { setErr(t("stl.errorType")); return; }
    if (file.size > MAX_STL_MB * 1024 * 1024) { setErr(t("stl.errorTooLarge", { mb: String(MAX_STL_MB) })); return; }
    loadBuffer(await file.arrayBuffer(), file.name);
  };

  useEffect(() => {
    if (initialStl) loadBuffer(initialStl, initialName ?? "model.stl");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (err) toast.error(err); }, [err, toast]);

  // ---- plotter lines (debounced; occlusion is the heavy part) -------------
  useEffect(() => {
    if (!mesh || !model) { setResult(null); return; }
    setComputing(true);
    const id = window.setTimeout(() => {
      try {
        setResult(computeStl(model, {
          camera: cameraFromParams(params, mesh),
          featureAngleDeg: params.featureAngleDeg,
          hidden: params.hidden,
          colors: { visible: params.colorVisible, hidden: params.colorHidden },
          continuous: params.continuous,
          bbox: [mesh.min, mesh.max],
          up: params.up,
          dimLabels: { w: t("stl.dimW"), h: t("stl.dimH"), d: t("stl.dimD") },
          dimStyle: params.dimStyle,
          sizeTable: params.sizeTable,
          plotWidth: cal.plot_width,
          plotHeight: cal.plot_height,
        }));
      } catch (e: any) {
        setErr(String(e?.message ?? e));
        setResult(null);
      } finally {
        setComputing(false);
      }
    }, 220);
    return () => window.clearTimeout(id);
  }, [mesh, model, params, cal.plot_width, cal.plot_height, t]);

  const applyPreset = (name: keyof typeof PRESETS) => {
    const [az, el] = PRESETS[name];
    set({ azimuth: az, elevation: el });
    setOrientToken((n) => n + 1);
  };

  const setUpAxis = (up: "z" | "y") => {
    set({ up });
    setOrientToken((n) => n + 1);
  };

  const resetView = () => setResetToken((n) => n + 1);

  // ---- outputs ------------------------------------------------------------
  const template = useMemo<TemplateSpec | null>(() => {
    if (!result || result.layers.length === 0) return null;
    return {
      name: fileName.replace(/\.stl$/i, "") || "stl",
      lines: allPolylines(result),
      width: result.width,
      height: result.height,
      details: [
        { label: t("stl.triangles"), value: String(mesh?.triangles.length ?? 0) },
        { label: t("stl.size"), value: `${result.width.toFixed(0)}×${result.height.toFixed(0)} mm` },
      ],
    };
  }, [result, fileName, mesh, t]);

  const insert = () => { if (template && result) onInsert(template, stlColoring(result)); };
  const save = () => {
    if (!result || !stlRef.current || !onSaveGallery) return;
    onSaveGallery({ stl: stlRef.current, filename: fileName, params, result });
  };

  const showHiddenColor = params.hidden === "secondColor";

  return (
    <Modal
      title={t("stl.title")}
      onClose={() => !busy && !saving && onClose()}
      className="stl-modal"
      bodyClassName="stl-modal-body"
      footer={(
        <>
          <button type="button" className="ghost" disabled={busy || saving} onClick={onClose}>
            {t("common.cancel")}
          </button>
          {onSaveGallery && (
            <button type="button" className="ghost" disabled={!result || saving} onClick={save}>
              {saving ? t("stl.saving") : t("stl.saveGallery")}
            </button>
          )}
          <button type="button" className="primary" disabled={!template || busy} onClick={insert}>
            {busy ? t("games.creatingPage") : t("stl.insert")}
          </button>
        </>
      )}
    >
      <div className="stl-editor">
        <section className="stl-side-pane">
          {!mesh && (
            <div
              className="stl-drop"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0]); }}
              onClick={() => fileInputRef.current?.click()}
            >
              <strong>{t("stl.dropHint")}</strong>
              <span className="muted">{t("stl.dropFormats", { mb: String(MAX_STL_MB) })}</span>
              <input ref={fileInputRef} type="file" accept=".stl" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
            </div>
          )}

          {mesh && (
            <div className="stl-controls">
              <div className="stl-file-row">
                <span className="stl-file-name" title={fileName}>{fileName}</span>
                <button type="button" className="ghost" onClick={() => fileInputRef.current?.click()}>
                  {t("stl.replace")}
                </button>
                <input ref={fileInputRef} type="file" accept=".stl" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
              </div>

              <div className="stl-presets">
                {(["front", "back", "left", "right", "top", "iso"] as const).map((p) => (
                  <button key={p} type="button" className="ghost" onClick={() => applyPreset(p)}>
                    {t(`stl.preset.${p}`)}
                  </button>
                ))}
              </div>

              <label className="stl-field">
                <span>{t("stl.hidden")}</span>
                <select value={params.hidden} onChange={(e) => set({ hidden: e.target.value as HiddenMode })}>
                  <option value="remove">{t("stl.hidden.remove")}</option>
                  <option value="show">{t("stl.hidden.show")}</option>
                  <option value="secondColor">{t("stl.hidden.secondColor")}</option>
                </select>
              </label>

              <label className="stl-range">
                <span>{t("stl.featureAngle")}: {params.featureAngleDeg}°</span>
                <input
                  type="range" min={1} max={80} step={1}
                  value={params.featureAngleDeg}
                  onChange={(e) => set({ featureAngleDeg: Number(e.target.value) })}
                />
              </label>

              <label className="stl-toggle">
                <input type="checkbox" checked={params.perspective} onChange={(e) => set({ perspective: e.target.checked })} />
                <span>{t("stl.perspective")}</span>
              </label>

              <label className="stl-toggle">
                <input type="checkbox" checked={params.shading} onChange={(e) => set({ shading: e.target.checked })} />
                <span>{t("stl.shading")}</span>
              </label>

              <label className="stl-range">
                <span>{t("stl.opacity")}: {Math.round(params.opacity * 100)}%</span>
                <input
                  type="range" min={10} max={100} step={5}
                  value={Math.round(params.opacity * 100)}
                  onChange={(e) => set({ opacity: Number(e.target.value) / 100 })}
                />
              </label>

              <label className="stl-toggle">
                <input type="checkbox" checked={params.showTriangles} onChange={(e) => set({ showTriangles: e.target.checked })} />
                <span>{t("stl.showTriangles")}</span>
              </label>

              <label className="stl-field">
                <span>{t("stl.dimStyle")}</span>
                <select value={params.dimStyle} onChange={(e) => set({ dimStyle: e.target.value as DimStyle })}>
                  <option value="none">{t("stl.dimStyle.none")}</option>
                  <option value="box">{t("stl.dimStyle.box")}</option>
                  <option value="arrows">{t("stl.dimStyle.arrows")}</option>
                </select>
              </label>

              <label className="stl-toggle">
                <input type="checkbox" checked={params.sizeTable} onChange={(e) => set({ sizeTable: e.target.checked })} />
                <span>{t("stl.sizeTable")}</span>
              </label>

              {mesh && (
                <div className="stl-dims">
                  <div>
                    <span className="muted">{t("stl.modelSize")}</span>
                    <strong>
                      {(mesh.max[0] - mesh.min[0]).toFixed(1)} × {(mesh.max[1] - mesh.min[1]).toFixed(1)} × {(mesh.max[2] - mesh.min[2]).toFixed(1)}
                    </strong>
                  </div>
                  {result && (
                    <div>
                      <span className="muted">{t("stl.plotSize")}</span>
                      <strong>{result.width.toFixed(1)} × {result.height.toFixed(1)} mm</strong>
                    </div>
                  )}
                </div>
              )}

              <label className="stl-field">
                <span>{t("stl.upAxis")}</span>
                <select value={params.up} onChange={(e) => setUpAxis(e.target.value as "z" | "y")}>
                  <option value="z">Z</option>
                  <option value="y">Y</option>
                </select>
              </label>

              <label className="stl-toggle">
                <input type="checkbox" checked={params.continuous} onChange={(e) => set({ continuous: e.target.checked })} />
                <span>{t("stl.continuous")}</span>
              </label>

              <label className="stl-field">
                <span>{showHiddenColor ? t("stl.colorVisible") : t("stl.color")}</span>
                <ColorPicker value={params.colorVisible} onChange={(c) => set({ colorVisible: c })} />
              </label>
              {showHiddenColor && (
                <label className="stl-field">
                  <span>{t("stl.colorHidden")}</span>
                  <ColorPicker value={params.colorHidden} onChange={(c) => set({ colorHidden: c })} />
                </label>
              )}
            </div>
          )}
        </section>

        <section className="stl-mid-pane">
          {mesh && model ? (
            <StlView3D
              mesh={mesh}
              model={model}
              azimuth={params.azimuth}
              elevation={params.elevation}
              fov={params.fov}
              up={params.up}
              distanceFactor={params.distanceFactor}
              featureAngleDeg={params.featureAngleDeg}
              showTriangles={params.showTriangles}
              shading={params.shading}
              opacity={params.opacity}
              showBox={params.dimStyle !== "none"}
              orientToken={orientToken}
              resetToken={resetToken}
              onOrient={(azimuth, elevation) => set({ azimuth, elevation })}
            />
          ) : (
            <div className="stl-view-3d">
              <div className="stl-canvas-empty">{t("stl.noModel")}</div>
            </div>
          )}
        </section>

        <section className="stl-preview-pane">
          <div className="stl-preview-2d">
            <div className="stl-preview-head">
              <h3>{t("games.preview")}</h3>
              <span className="muted stl-preview-stat">
                {computing ? t("stl.computing")
                  : result ? t("stl.lineCount", { points: String(result.points) })
                  : ""}
              </span>
              <button type="button" className="ghost stl-mini-btn" onClick={resetView}>
                {t("g3d.resetView")}
              </button>
            </div>
            <div className="stl-preview-svg">
              {result ? (
                <TechnicalDrawing result={result} />
              ) : (
                <div className="stl-canvas-empty">{computing ? t("stl.computing") : t("stl.noModel")}</div>
              )}
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}

/** The plotter result as a centred, maximised technical drawing. Dimension
 *  geometry (when enabled) is already baked into the layers, so this just renders
 *  the layers framed to fit. */
function TechnicalDrawing({ result }: { result: StlComputeResult }) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const layer of result.layers) for (const line of layer.polylines) for (const [x, y] of line) {
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; x1 = Math.max(result.width, 1); y1 = Math.max(result.height, 1); }
  const m = Math.max(x1 - x0, y1 - y0, 1);
  const margin = m * 0.08;
  const obj = m * 0.004;

  return (
    <svg
      className="stl-tech-svg"
      viewBox={`${x0 - margin} ${y0 - margin} ${x1 - x0 + 2 * margin} ${y1 - y0 + 2 * margin}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {result.layers.map((layer, li) =>
        layer.polylines.map((line, i) => (
          <path
            key={`${li}-${i}`}
            d={toPath(line)}
            fill="none"
            stroke={INK_HEX[layer.color] ?? "#161616"}
            strokeWidth={obj}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )),
      )}
    </svg>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="stl-color-picker">
      {PEN_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={`stl-swatch ${value === c ? "active" : ""}`}
          style={{ background: COLOR_HEX[c] }}
          onClick={() => onChange(c)}
          aria-label={c}
        />
      ))}
    </div>
  );
}
