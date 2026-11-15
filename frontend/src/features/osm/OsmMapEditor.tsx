import { useEffect, useMemo, useState } from "react";
import type { Calibration, GalleryMetrics, GalleryScore, GcodePreview3D, GeocodeResult, OsmMapGcode, OsmMapRequest } from "../../api";
import { api } from "../../api";
import { fmtDuration } from "../../lib/format";
import { useI18n } from "../../i18n";
import type { TemplateSpec } from "../games/lib/types";
import { buildOsmMapTemplate } from "../games/lib/osmMap";
import GamePreviewSvg from "../games/components/PreviewSvg";
import Gcode3DOverlay from "../../components/Gcode3DOverlay";
import type { Gcode3DView } from "../../components/Gcode3D";
import Modal from "../../components/Modal";
import ScoreBadge from "../../components/ScoreBadge";
import { useToasts } from "../../components/Toasts";

// Search a place and select the line features to draw inside its boundary.
export default function OsmMapEditor({
  cal,
  busy,
  onClose,
  onInsert,
}: {
  cal: Calibration;
  busy: boolean;
  onClose: () => void;
  onInsert: (template: TemplateSpec) => void;
}) {
  const { t } = useI18n();
  const toast = useToasts();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [selected, setSelected] = useState<GeocodeResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [useBoundary, setUseBoundary] = useState(true);
  const [detail, setDetail] = useState(0.55);
  const [includeFrame, setIncludeFrame] = useState(false);
  const [continuous, setContinuous] = useState(false);
  const [layers, setLayers] = useState<NonNullable<OsmMapRequest["layers"]>>(["roads"]);
  const [roadLevel, setRoadLevel] = useState<NonNullable<OsmMapRequest["roadLevel"]>>("collector");
  const [railLevel, setRailLevel] = useState<NonNullable<OsmMapRequest["railLevel"]>>("main");
  const [waterLevel, setWaterLevel] = useState<NonNullable<OsmMapRequest["waterLevel"]>>("streams");
  const [minLengthMm, setMinLengthMm] = useState(0.2);
  const [loadedMap, setLoadedMap] = useState<{ request: OsmMapRequest; template: TemplateSpec } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [score, setScore] = useState<GalleryScore | null>(null);
  const [metrics, setMetrics] = useState<GalleryMetrics | null>(null);
  const [route, setRoute] = useState<OsmMapGcode["route"]>(undefined);
  const [gcode3d, setGcode3d] = useState<GcodePreview3D | null>(null);
  const [scoring, setScoring] = useState(false);
  const [showGcode, setShowGcode] = useState(false);
  const [gcode3dView, setGcode3dView] = useState<Gcode3DView>({ yaw: -0.7, pitch: 1.0, zoom: 1, panX: 0, panY: 0 });

  const mapRequest = useMemo<OsmMapRequest | null>(() => {
    if (!selected) return null;
    return {
      south: selected.south,
      west: selected.west,
      north: selected.north,
      east: selected.east,
      width: cal.plot_width,
      height: cal.plot_height,
      detail,
      includeFrame,
      areaId: useBoundary && selected.areaId != null ? selected.areaId : undefined,
      layers, roadLevel, railLevel, waterLevel, minLengthMm,
    };
  }, [selected, cal.plot_width, cal.plot_height, detail, includeFrame, useBoundary,
    layers, roadLevel, railLevel, waterLevel, minLengthMm]);
  const preview = loadedMap?.request === mapRequest ? loadedMap.template : null;

  const search = async () => {
    if (!query.trim() || searching) return;
    setSearching(true);
    setErr(null);
    try {
      const res = await api.geocodePlace(query.trim());
      setResults(res.results);
      if (res.results.length === 0) setErr(t("games.osm.noResults"));
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setSearching(false);
    }
  };

  const chooseResult = (r: GeocodeResult) => {
    setResults([]);
    setQuery(r.name);
    setUseBoundary(r.areaId != null);
    setLoadedMap(null);
    setScore(null);
    setMetrics(null);
    setGcode3d(null);
    setSelected(r);
  };

  // Fast SVG preview, debounced on every change.
  useEffect(() => {
    const reqMap = mapRequest;
    if (!reqMap) return;
    const controller = new AbortController();
    setLoading(true);
    setErr(null);
    const id = window.setTimeout(async () => {
      try {
        const map = await api.getOsmMap(reqMap, controller.signal);
        if (!controller.signal.aborted) {
          setLoadedMap({ request: reqMap, template: buildOsmMapTemplate(map, t) });
        }
      } catch (e: any) {
        if (!controller.signal.aborted) setErr(String(e.message ?? e));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 400);
    return () => {
      window.clearTimeout(id);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRequest]);

  // Real G-code (score + 3D) reflecting how it will plot — heavier, longer debounce.
  useEffect(() => {
    setScore(null);
    setMetrics(null);
    setRoute(undefined);
    setGcode3d(null);
    setShowGcode(false);
    setScoring(false);
    // Start only after the matching preview has finished. The backend now
    // reuses its geometry rather than downloading and preparing it twice.
    if (!preview || !mapRequest) return;
    const reqMap = mapRequest;
    const controller = new AbortController();
    setScoring(true);
    const id = window.setTimeout(async () => {
      try {
        const res = await api.getOsmMapGcode(reqMap, continuous, controller.signal);
        if (controller.signal.aborted) return;
        setScore(res.score);
        setMetrics(res.metrics);
        setRoute(res.route);
        setGcode3d(res.gcode3d);
      } catch {
        // The map remains usable if its optional G-code preview fails.
      } finally {
        if (!controller.signal.aborted) setScoring(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(id);
      controller.abort();
    };
  }, [mapRequest, preview, continuous]);

  useEffect(() => {
    if (err) toast.error(err);
  }, [err, toast]);

  return (
    <Modal
      title={t("games.osm.editorTitle")}
      onClose={() => !busy && onClose()}
      className="osm-modal"
      bodyClassName="osm-modal-body"
      footer={(
        <>
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!preview?.lines.length || loading || busy}
            onClick={() => preview && onInsert({
              ...preview,
              name: selected?.name.split(",")[0].trim() || preview.name,
              continuous,
            })}
          >
            {busy ? t("games.creatingPage") : t("games.createPage")}
          </button>
        </>
      )}
    >
      <div className="osm-editor osm-editor-search">
        <section className="osm-side-pane">
          <div className="osm-controls">
            <div className="osm-search">
              <h3>{t("games.osm.search")}</h3>
              <div className="osm-search-row">
                <input
                  type="text"
                  autoFocus
                  value={query}
                  placeholder={t("games.osm.searchPlaceholder")}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }}
                />
                <button type="button" className="ghost" disabled={!query.trim() || searching} onClick={search}>
                  {searching ? t("games.osm.loading") : t("games.osm.searchButton")}
                </button>
              </div>
              {results.length > 0 && (
                <ul className="osm-search-results">
                  {results.map((r) => (
                    <li key={`${r.osmType}-${r.osmId}`}>
                      <button type="button" onClick={() => chooseResult(r)}>{r.name}</button>
                    </li>
                  ))}
                </ul>
              )}
              {selected && (
                <p className="muted osm-hint">{t("games.osm.selected")}: {selected.name}</p>
              )}
            </div>

            <fieldset className="osm-filter-group">
              <legend>{t("games.osm.layers")}</legend>
              {(["roads", "rail", "waterways"] as const).map((layer) => (
                <label key={layer} className="osm-layer-toggle">
                  <input type="checkbox" checked={layers.includes(layer)}
                    disabled={layers.length === 1 && layers.includes(layer)}
                    onChange={(e) => setLayers((current) => e.target.checked
                      ? [...current, layer] : current.filter((item) => item !== layer))} />
                  <span>{t(`games.osm.layer.${layer === "roads" ? "streets" : layer}`)}</span>
                </label>
              ))}
            </fieldset>
            {layers.includes("roads") && (
              <label className="osm-filter-select">
                <span>{t("games.osm.roadLevel")}</span>
                <select value={roadLevel} onChange={(e) => setRoadLevel(e.target.value as typeof roadLevel)}>
                  {(["motorways", "major", "collector", "local", "all"] as const).map((level) => (
                    <option key={level} value={level}>{t(`games.osm.road.${level}`)}</option>
                  ))}
                </select>
              </label>
            )}
            {layers.includes("rail") && (
              <label className="osm-filter-select">
                <span>{t("games.osm.railLevel")}</span>
                <select value={railLevel} onChange={(e) => setRailLevel(e.target.value as typeof railLevel)}>
                  <option value="main">{t("games.osm.rail.main")}</option>
                  <option value="all">{t("games.osm.rail.all")}</option>
                </select>
              </label>
            )}
            {layers.includes("waterways") && (
              <label className="osm-filter-select">
                <span>{t("games.osm.waterLevel")}</span>
                <select value={waterLevel} onChange={(e) => setWaterLevel(e.target.value as typeof waterLevel)}>
                  {(["major", "streams", "all"] as const).map((level) => (
                    <option key={level} value={level}>{t(`games.osm.water.${level}`)}</option>
                  ))}
                </select>
              </label>
            )}

            <label
              className="osm-layer-toggle osm-frame-toggle"
              title={selected?.areaId == null ? t("games.osm.useBoundaryHint") : undefined}
            >
              <input
                type="checkbox"
                checked={useBoundary}
                disabled={selected?.areaId == null}
                onChange={(e) => setUseBoundary(e.target.checked)}
              />
              <span>{t("games.osm.useBoundary")}</span>
            </label>

            <label className="osm-layer-toggle osm-frame-toggle" title={t("games.osm.continuousHint")}>
              <input
                type="checkbox"
                checked={continuous}
                onChange={(e) => setContinuous(e.target.checked)}
              />
              <span>{t("games.osm.continuous")}</span>
            </label>

            <label className="osm-range">
              <span>{t("games.osm.detail")}: {Math.round(detail * 100)}%</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={detail}
                onChange={(e) => setDetail(Number(e.target.value))}
              />
            </label>
            <p className="muted osm-hint">{t("games.osm.detailHint", {
              mm: ((1 - detail) ** 2 * 1.5).toFixed(2),
            })}</p>
            <label className="osm-filter-select">
              <span>{t("games.osm.minLength")}</span>
              <select value={minLengthMm} onChange={(e) => setMinLengthMm(Number(e.target.value))}>
                {[0, 0.2, 0.5, 1, 2, 5].map((length) => (
                  <option key={length} value={length}>{length === 0 ? t("games.osm.keepAll") : `${length} mm`}</option>
                ))}
              </select>
            </label>

            <p className="muted osm-hint">{t("games.osm.minLengthHint")}</p>

            <label className="osm-layer-toggle osm-frame-toggle">
              <input
                type="checkbox"
                checked={includeFrame}
                onChange={(e) => setIncludeFrame(e.target.checked)}
              />
              <span>{t("games.osm.includeFrame")}</span>
            </label>
          </div>
        </section>

        <section className="osm-preview-pane osm-preview-pane-wide">
          <div className="osm-preview-head">
            <h3>{t("games.preview")}</h3>
            <div className="osm-preview-actions">
              {score && <ScoreBadge score={score} />}
              <button
                type="button"
                className="ghost games-mini-action"
                disabled={!gcode3d}
                onClick={() => setShowGcode(true)}
              >
                ⛶ {t("games.osm.gcode3d")}
              </button>
            </div>
          </div>
          {preview ? (
            <>
              <div className="games-chip-grid compact osm-chip-grid">
                {preview.details.map((d) => (
                  <span key={`${d.label}-${d.value}`} className="games-chip">
                    <strong>{d.label}:</strong> {d.value}
                  </span>
                ))}
                {metrics && (
                  <>
                    <span className="games-chip"><strong>{t("gallery.m.penLifts")}:</strong> {metrics.pen_lifts}</span>
                    <span className="games-chip"><strong>{t("gallery.m.duration")}:</strong> {fmtDuration(metrics.duration_s)}</span>
                    <span className="games-chip"><strong>{t("games.osm.drawLength")}:</strong> {(metrics.draw_mm / 1000).toFixed(2)} m</span>
                    {route && <span className="games-chip"><strong>{t("games.osm.retrace")}:</strong> {(route.retrace_mm / 1000).toFixed(2)} m ({route.retrace_percent}%)</span>}
                  </>
                )}
                {scoring && <span className="games-chip muted">{t("games.osm.scoring")}</span>}
              </div>
              {preview.lines.length === 0 && <p className="muted">{t("games.osm.noLines")}</p>}
              <GamePreviewSvg cal={cal} lines={preview.lines} strokeWidth={0.12} className="osm-preview-svg" />
            </>
          ) : (
            <div className="osm-empty-preview">
              <span>{loading ? t("games.osm.loading") : t("games.osm.emptyPreview")}</span>
            </div>
          )}
        </section>
      </div>

      {showGcode && gcode3d && (
        <Gcode3DOverlay
          data={gcode3d}
          viewState={gcode3dView}
          onViewChange={setGcode3dView}
          onClose={() => setShowGcode(false)}
        />
      )}
    </Modal>
  );
}
