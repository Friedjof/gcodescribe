import { useEffect, useState } from "react";
import type { Calibration, GalleryMetrics, GalleryScore, GcodePreview3D, GeocodeResult, OsmMapRequest } from "../api";
import { api } from "../api";
import { fmtDuration } from "../format";
import { useI18n } from "../i18n";
import type { TemplateSpec } from "../games/types";
import { buildOsmMapTemplate } from "../games/osmMap";
import GamePreviewSvg from "../games/PreviewSvg";
import Gcode3DOverlay from "./Gcode3DOverlay";
import type { Gcode3DView } from "./Gcode3D";
import Modal from "./Modal";
import ScoreBadge from "./ScoreBadge";
import { useToasts } from "./Toasts";

// city-roads style: search a place, then render every road inside its boundary.
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
  const [continuous, setContinuous] = useState(true);
  const [preview, setPreview] = useState<TemplateSpec | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [score, setScore] = useState<GalleryScore | null>(null);
  const [metrics, setMetrics] = useState<GalleryMetrics | null>(null);
  const [gcode3d, setGcode3d] = useState<GcodePreview3D | null>(null);
  const [scoring, setScoring] = useState(false);
  const [showGcode, setShowGcode] = useState(false);
  const [gcode3dView, setGcode3dView] = useState<Gcode3DView>({ yaw: -0.7, pitch: 1.0, zoom: 1, panX: 0, panY: 0 });

  const mapRequest = (): OsmMapRequest | null => {
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
    };
  };

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
    setPreview(null);
    setScore(null);
    setMetrics(null);
    setGcode3d(null);
    setSelected(r);
  };

  // Fast SVG preview, debounced on every change.
  useEffect(() => {
    const reqMap = mapRequest();
    if (!reqMap) return;
    const id = window.setTimeout(async () => {
      setLoading(true);
      setErr(null);
      try {
        setPreview(buildOsmMapTemplate(await api.getOsmMap(reqMap), t));
      } catch (e: any) {
        setErr(String(e.message ?? e));
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, detail, includeFrame, useBoundary]);

  // Real G-code (score + 3D) reflecting how it will plot — heavier, longer debounce.
  useEffect(() => {
    const reqMap = mapRequest();
    if (!reqMap) return;
    const id = window.setTimeout(async () => {
      setScoring(true);
      try {
        const res = await api.getOsmMapGcode(reqMap, continuous);
        setScore(res.score);
        setMetrics(res.metrics);
        setGcode3d(res.gcode3d);
      } catch {
        setScore(null);
        setMetrics(null);
        setGcode3d(null);
      } finally {
        setScoring(false);
      }
    }, 650);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, detail, includeFrame, useBoundary, continuous]);

  useEffect(() => {
    if (err) toast.error(err);
  }, [err, toast]);

  return (
    <Modal
      title={t("games.osm.editorTitle")}
      onClose={() => !loading && !busy && onClose()}
      className="osm-modal"
      bodyClassName="osm-modal-body"
      footer={(
        <>
          <button type="button" className="ghost" disabled={loading || busy} onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="button" className="primary" disabled={!preview || loading || busy} onClick={() => preview && onInsert(preview)}>
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
                  </>
                )}
                {scoring && <span className="games-chip muted">{t("games.osm.scoring")}</span>}
              </div>
              <GamePreviewSvg cal={cal} lines={preview.lines} className="osm-preview-svg" />
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
