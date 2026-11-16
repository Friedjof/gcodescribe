import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type Calibration,
  type GeocodeResult,
  type OsmMapGcode,
  type OsmMapRequest,
} from "../../api";
import { fmtDuration } from "../../lib/format";
import { useI18n } from "../../i18n";
import type { TemplateSpec } from "../games/lib/types";
import GamePreviewSvg from "../games/components/PreviewSvg";
import Gcode3DOverlay from "../../components/Gcode3DOverlay";
import type { Gcode3DView } from "../../components/Gcode3D";
import EditorIcon from "../../components/editor/EditorIcon";
import PaginationBar from "../../components/paging/PaginationBar";
import { useOsmPreview } from "./hooks/useOsmPreview";

/** Inline map workspace: the document stays visible while its properties change. */
export default function OsmMapEditor({
  cal,
  busy,
  onInsert,
  active = true,
}: {
  cal: Calibration;
  busy: boolean;
  onInsert: (template: TemplateSpec) => void;
  active?: boolean;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"place" | "layers" | "drawing">("place");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [resultPage, setResultPage] = useState(0);
  const [selected, setSelected] = useState<GeocodeResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchController = useRef<AbortController | null>(null);
  const [useBoundary, setUseBoundary] = useState(true);
  const [detail, setDetail] = useState(0.55);
  const [includeFrame, setIncludeFrame] = useState(false);
  const [continuous, setContinuous] = useState(false);
  const [layers, setLayers] = useState<NonNullable<OsmMapRequest["layers"]>>([
    "roads",
  ]);
  const [roadLevel, setRoadLevel] =
    useState<NonNullable<OsmMapRequest["roadLevel"]>>("collector");
  const [railLevel, setRailLevel] =
    useState<NonNullable<OsmMapRequest["railLevel"]>>("main");
  const [waterLevel, setWaterLevel] =
    useState<NonNullable<OsmMapRequest["waterLevel"]>>("streams");
  const [minLengthMm, setMinLengthMm] = useState(0.2);
  const [analysis, setAnalysis] = useState<OsmMapGcode | null>(null);
  const [scoring, setScoring] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const analysisController = useRef<AbortController | null>(null);
  const [showGcode, setShowGcode] = useState(false);
  const [gcode3dView, setGcode3dView] = useState<Gcode3DView>({
    yaw: -0.7,
    pitch: 1,
    zoom: 1,
    panX: 0,
    panY: 0,
  });
  const mapRequest = useMemo<OsmMapRequest | null>(
    () =>
      selected
        ? {
            south: selected.south,
            west: selected.west,
            north: selected.north,
            east: selected.east,
            width: cal.plot_width,
            height: cal.plot_height,
            detail,
            includeFrame,
            areaId:
              useBoundary && selected.areaId != null
                ? selected.areaId
                : undefined,
            layers,
            roadLevel,
            railLevel,
            waterLevel,
            minLengthMm,
          }
        : null,
    [
      selected,
      cal.plot_width,
      cal.plot_height,
      detail,
      includeFrame,
      useBoundary,
      layers,
      roadLevel,
      railLevel,
      waterLevel,
      minLengthMm,
    ],
  );
  const { template, current, loading, error, refresh } = useOsmPreview(
    mapRequest,
    active,
  );

  useEffect(() => {
    analysisController.current?.abort();
    setAnalysis(null);
    setScoring(false);
    setAnalysisError(null);
    setShowGcode(false);
    return () => analysisController.current?.abort();
  }, [mapRequest, continuous, active]);
  useEffect(() => () => searchController.current?.abort(), []);
  useEffect(() => {
    if (!active) {
      searchController.current?.abort();
      setSearching(false);
    }
  }, [active]);

  const search = async () => {
    if (!query.trim()) return;
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    setSearching(true);
    setSearchError(null);
    try {
      const response = await api.geocodePlace(query.trim(), controller.signal);
      if (controller.signal.aborted) return;
      setResults(response.results);
      setResultPage(0);
      if (!response.results.length) setSearchError(t("games.osm.noResults"));
    } catch (e: unknown) {
      if (!controller.signal.aborted)
        setSearchError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  };
  const analyze = async () => {
    if (!mapRequest || !current || loading || scoring) return;
    const controller = new AbortController();
    analysisController.current?.abort();
    analysisController.current = controller;
    setScoring(true);
    setAnalysisError(null);
    try {
      const result = await api.getOsmMapGcode(
        mapRequest,
        continuous,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setAnalysis(result);
        setShowGcode(true);
      }
    } catch (e: unknown) {
      if (!controller.signal.aborted)
        setAnalysisError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!controller.signal.aborted) setScoring(false);
    }
  };
  return (
    <>
      <section className="template-stage osm-inline-stage">
        <div className="template-stage-head">
          <div>
            <h2>{t("game.osmMap.name")}</h2>
            <p title={selected?.name}>
              {selected?.name || t("games.osm.inlineHint")}
            </p>
          </div>
          <button
            type="button"
            disabled={!current || loading || scoring}
            onClick={() => (analysis ? setShowGcode(true) : analyze())}
          >
            <EditorIcon name="preview" size={16} />
            {t(scoring ? "games.osm.scoring" : "games.osm.gcode3d")}
          </button>
        </div>
        <div
          className="template-stage-preview osm-inline-preview"
          aria-busy={loading}
        >
          {template ? (
            <GamePreviewSvg
              cal={cal}
              lines={template.lines}
              strokeWidth={0.12}
            />
          ) : (
            <div className="template-preview-empty">
              <EditorIcon name="map" size={40} />
              <span>
                {t(loading ? "games.osm.loading" : "games.osm.emptyPreview")}
              </span>
            </div>
          )}
          {loading && template && (
            <span className="osm-update-status" role="status">
              {t("games.osm.updating")}
            </span>
          )}
        </div>
        <div className="template-stage-status" role="status">
          <span>
            {cal.plot_width.toFixed(0)} × {cal.plot_height.toFixed(0)} mm
          </span>
          <span>
            {analysis
              ? `${analysis.metrics.pen_lifts} ${t("gallery.m.penLifts")} · ${fmtDuration(analysis.metrics.duration_s)}`
              : t(
                  loading
                    ? "games.osm.updating"
                    : current
                      ? "games.osm.ready"
                      : "games.osm.emptyPreview",
                )}
          </span>
        </div>
      </section>
      <aside className="template-inspector osm-inline-inspector">
        <header>
          <strong>{t("games.settings")}</strong>
        </header>
        <div
          className="osm-property-tabs"
          role="tablist"
          aria-label={t("games.settings")}
        >
          {(["place", "layers", "drawing"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={`osm-panel-${id}`}
              id={`osm-tab-${id}`}
              onClick={() => setTab(id)}
              onKeyDown={(event) => {
                const ids = ["place", "layers", "drawing"] as const;
                const index = ids.indexOf(id);
                const next = event.key === "ArrowRight" ? (index + 1) % ids.length : event.key === "ArrowLeft" ? (index + ids.length - 1) % ids.length : event.key === "Home" ? 0 : event.key === "End" ? ids.length - 1 : -1;
                if (next < 0) return;
                event.preventDefault(); setTab(ids[next]); document.getElementById(`osm-tab-${ids[next]}`)?.focus();
              }}
              tabIndex={tab === id ? 0 : -1}
            >
              <EditorIcon
                size={15}
                name={
                  id === "place" ? "map" : id === "layers" ? "group" : "draw"
                }
              />
              {t(`games.osm.tab.${id}`)}
            </button>
          ))}
        </div>
        <div
          className="osm-properties"
          role="tabpanel"
          id={`osm-panel-${tab}`}
          aria-labelledby={`osm-tab-${tab}`}
        >
          {tab === "place" && (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  search();
                }}
                className="osm-place-search"
              >
                <label htmlFor="osm-place-query">{t("games.osm.search")}</label>
                <div className="osm-search-row">
                  <input
                    id="osm-place-query"
                    value={query}
                    placeholder={t("games.osm.searchPlaceholder")}
                    onChange={(e) => {
                      searchController.current?.abort();
                      setSearching(false);
                      setQuery(e.target.value);
                      setResults([]);
                      setSearchError(null);
                    }}
                  />
                  <button
                    type="submit"
                    disabled={!query.trim() || searching}
                    aria-label={t("games.osm.searchButton")}
                    title={t("games.osm.searchButton")}
                  >
                    <EditorIcon name="search" size={16} />
                  </button>
                </div>
              </form>
              {searching && <p role="status">{t("games.osm.loading")}</p>}
              {searchError && <p role="alert">{searchError}</p>}
              {!!results.length && (
                <div className="osm-place-results">
                  <div>
                    {results
                      .slice(resultPage * 4, resultPage * 4 + 4)
                      .map((r) => (
                        <button
                          type="button"
                          key={`${r.osmType}-${r.osmId}`}
                          title={r.name}
                          onClick={() => {
                            setSelected(r);
                            setUseBoundary(r.areaId != null);
                            setResults([]);
                            setQuery(r.name);
                          }}
                        >
                          <EditorIcon name="map" size={16} />
                          <span>{r.name}</span>
                        </button>
                      ))}
                  </div>
                  <PaginationBar
                    page={resultPage}
                    pages={Math.ceil(results.length / 4)}
                    onChange={setResultPage}
                    label={t("games.osm.search")}
                  />
                </div>
              )}
              {selected && results.length === 0 && (
                <div className="osm-place-summary">
                  <strong>{t("games.osm.selected")}</strong>
                  <p title={selected.name}>{selected.name}</p>
                  <small>
                    {selected.lat.toFixed(4)}°, {selected.lon.toFixed(4)}°
                  </small>
                </div>
              )}
              <label
                className="osm-layer-toggle"
                title={t("games.osm.useBoundaryHint")}
              >
                <input
                  type="checkbox"
                  checked={useBoundary}
                  disabled={selected?.areaId == null}
                  onChange={(e) => setUseBoundary(e.target.checked)}
                />
                <span>{t("games.osm.useBoundary")}</span>
              </label>
              <p className="osm-inline-hint">{t("games.osm.inlineHint")}</p>
            </>
          )}
          {tab === "layers" && (
            <>
              <fieldset className="osm-filter-group">
                <legend>{t("games.osm.layers")}</legend>
                {(["roads", "rail", "waterways"] as const).map((layer) => (
                  <label key={layer} className="osm-layer-toggle">
                    <input
                      type="checkbox"
                      checked={layers.includes(layer)}
                      disabled={layers.length === 1 && layers.includes(layer)}
                      onChange={(e) =>
                        setLayers((value) =>
                          e.target.checked
                            ? [...value, layer]
                            : value.filter((item) => item !== layer),
                        )
                      }
                    />
                    <span>
                      {t(
                        `games.osm.layer.${layer === "roads" ? "streets" : layer}`,
                      )}
                    </span>
                  </label>
                ))}
              </fieldset>
              {layers.includes("roads") && (
                <label className="osm-filter-select">
                  <span>{t("games.osm.roadLevel")}</span>
                  <select
                    value={roadLevel}
                    onChange={(e) =>
                      setRoadLevel(e.target.value as typeof roadLevel)
                    }
                  >
                    {(
                      [
                        "motorways",
                        "major",
                        "collector",
                        "local",
                        "all",
                      ] as const
                    ).map((level) => (
                      <option key={level} value={level}>
                        {t(`games.osm.road.${level}`)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {layers.includes("rail") && (
                <label className="osm-filter-select">
                  <span>{t("games.osm.railLevel")}</span>
                  <select
                    value={railLevel}
                    onChange={(e) =>
                      setRailLevel(e.target.value as typeof railLevel)
                    }
                  >
                    {(["main", "all"] as const).map((level) => (
                      <option key={level} value={level}>
                        {t(`games.osm.rail.${level}`)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {layers.includes("waterways") && (
                <label className="osm-filter-select">
                  <span>{t("games.osm.waterLevel")}</span>
                  <select
                    value={waterLevel}
                    onChange={(e) =>
                      setWaterLevel(e.target.value as typeof waterLevel)
                    }
                  >
                    {(["major", "streams", "all"] as const).map((level) => (
                      <option key={level} value={level}>
                        {t(`games.osm.water.${level}`)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
          {tab === "drawing" && (
            <>
              <label className="osm-range">
                <span>
                  {t("games.osm.detail")}: {Math.round(detail * 100)}%
                </span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={detail}
                  onChange={(e) => setDetail(Number(e.target.value))}
                />
              </label>
              <p className="osm-inline-hint">
                {t("games.osm.detailHint", {
                  mm: ((1 - detail) ** 2 * 1.5).toFixed(2),
                })}
              </p>
              <label className="osm-filter-select">
                <span>{t("games.osm.minLength")}</span>
                <select
                  value={minLengthMm}
                  onChange={(e) => setMinLengthMm(Number(e.target.value))}
                >
                  {[0, 0.2, 0.5, 1, 2, 5].map((length) => (
                    <option key={length} value={length}>
                      {length === 0 ? t("games.osm.keepAll") : `${length} mm`}
                    </option>
                  ))}
                </select>
              </label>
              <p className="osm-inline-hint">{t("games.osm.minLengthHint")}</p>
              <label className="osm-layer-toggle">
                <input
                  type="checkbox"
                  checked={includeFrame}
                  onChange={(e) => setIncludeFrame(e.target.checked)}
                />
                <span>{t("games.osm.includeFrame")}</span>
              </label>
              <label
                className="osm-layer-toggle"
                title={t("games.osm.continuousHint")}
              >
                <input
                  type="checkbox"
                  checked={continuous}
                  onChange={(e) => setContinuous(e.target.checked)}
                />
                <span>{t("games.osm.continuous")}</span>
              </label>
            </>
          )}
        </div>
        {(error || analysisError) && (
          <div className="osm-inline-error" role="alert">
            <p>{error || analysisError}</p>
            {error && (
              <button type="button" onClick={refresh}>
                {t("common.refresh")}
              </button>
            )}
          </div>
        )}
        {current && !loading && !template?.lines.length && (
          <p className="osm-inline-hint">{t("games.osm.noLines")}</p>
        )}
        <div className="template-inspector-info">
          {t("games.osm.autoUpdate")}
        </div>
        <footer className="template-inspector-actions">
          <button
            type="button"
            className="primary"
            disabled={!current || !template?.lines.length || loading || busy}
            onClick={() =>
              template &&
              onInsert({
                ...template,
                name: selected?.name.split(",")[0].trim() || template.name,
                continuous,
              })
            }
          >
            <EditorIcon name="add" size={17} />
            {t(busy ? "games.creatingPage" : "games.createPage")}
          </button>
        </footer>
      </aside>
      {showGcode && analysis && (
        <Gcode3DOverlay
          data={analysis.gcode3d}
          viewState={gcode3dView}
          onViewChange={setGcode3dView}
          onClose={() => setShowGcode(false)}
        />
      )}
    </>
  );
}
