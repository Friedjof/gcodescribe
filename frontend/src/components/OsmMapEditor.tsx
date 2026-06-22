import { useEffect, useState } from "react";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { Calibration, OsmLayer } from "../api";
import { api } from "../api";
import { useI18n } from "../i18n";
import type { TemplateSpec } from "../games/types";
import { buildOsmMapTemplate } from "../games/osmMap";
import GamePreviewSvg from "../games/PreviewSvg";
import Modal from "./Modal";
import { useToasts } from "./Toasts";

const LAYERS: Array<{ id: OsmLayer; labelKey: string }> = [
  { id: "streets", labelKey: "games.osm.layer.streets" },
  { id: "paths", labelKey: "games.osm.layer.paths" },
  { id: "buildings", labelKey: "games.osm.layer.buildings" },
  { id: "waterways", labelKey: "games.osm.layer.waterways" },
  { id: "water", labelKey: "games.osm.layer.water" },
  { id: "rail", labelKey: "games.osm.layer.rail" },
  { id: "transit", labelKey: "games.osm.layer.transit" },
];

type Bounds = { south: number; west: number; north: number; east: number };

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
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [layers, setLayers] = useState<OsmLayer[]>(["streets"]);
  const [detail, setDetail] = useState(0.55);
  const [includeFrame, setIncludeFrame] = useState(true);
  const [preview, setPreview] = useState<TemplateSpec | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const requestPreview = async () => {
    if (!bounds || layers.length === 0 || loading) return;
    setLoading(true);
    setErr(null);
    try {
      const map = await api.getOsmMap({
        ...bounds,
        layers,
        width: Math.max(20, cal.plot_width - 8),
        height: Math.max(20, cal.plot_height - 8),
        detail,
        includeFrame,
      });
      setPreview(buildOsmMapTemplate(map, t));
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  const toggleLayer = (layer: OsmLayer) => {
    setLayers((current) => current.includes(layer)
      ? current.filter((item) => item !== layer)
      : [...current, layer]);
    setPreview(null);
    setErr(null);
  };

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
          <button type="button" className="ghost" disabled={!bounds || layers.length === 0 || loading || busy} onClick={requestPreview}>
            {loading ? t("games.osm.loading") : t("games.osm.preview")}
          </button>
          <button type="button" className="primary" disabled={!preview || loading || busy} onClick={() => preview && onInsert(preview)}>
            {busy ? t("games.creatingPage") : t("games.createPage")}
          </button>
        </>
      )}
    >
      <div className="osm-editor">
        <section className="osm-map-pane">
          <MapContainer center={[52.52, 13.405]} zoom={13} scrollWheelZoom className="osm-leaflet">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <BoundsTracker onChange={setBounds} />
            <InvalidateMapSize />
          </MapContainer>
          <p className="muted osm-hint">{t("games.osm.mapHint")}</p>
        </section>

        <section className="osm-side-pane">
          <div className="osm-controls">
            <div>
              <h3>{t("games.osm.layers")}</h3>
              <div className="osm-layer-grid">
                {LAYERS.map((layer) => (
                  <label key={layer.id} className="osm-layer-toggle">
                    <input
                      type="checkbox"
                      checked={layers.includes(layer.id)}
                      onChange={() => toggleLayer(layer.id)}
                    />
                    <span>{t(layer.labelKey)}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="osm-range">
              <span>{t("games.osm.detail")}: {Math.round(detail * 100)}%</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={detail}
                onChange={(e) => { setDetail(Number(e.target.value)); setPreview(null); }}
              />
            </label>

            <label className="osm-layer-toggle osm-frame-toggle">
              <input
                type="checkbox"
                checked={includeFrame}
                onChange={(e) => { setIncludeFrame(e.target.checked); setPreview(null); }}
              />
              <span>{t("games.osm.includeFrame")}</span>
            </label>
          </div>

          <div className="osm-preview-pane">
            <h3>{t("games.preview")}</h3>
            {preview ? (
              <>
                <div className="games-chip-grid compact osm-chip-grid">
                  {preview.details.map((detail) => (
                    <span key={`${detail.label}-${detail.value}`} className="games-chip">
                      <strong>{detail.label}:</strong> {detail.value}
                    </span>
                  ))}
                </div>
                <GamePreviewSvg cal={cal} lines={preview.lines} className="osm-preview-svg" />
              </>
            ) : (
              <div className="osm-empty-preview">
                <span>{t("games.osm.emptyPreview")}</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </Modal>
  );
}

function BoundsTracker({ onChange }: { onChange: (bounds: Bounds) => void }) {
  const map = useMap();
  const update = () => {
    const b = map.getBounds();
    onChange({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
  };
  useMapEvents({
    moveend: update,
    zoomend: update,
  });
  useEffect(update, [map]);
  return null;
}

function InvalidateMapSize() {
  const map = useMap();
  useEffect(() => {
    const id = window.setTimeout(() => map.invalidateSize(), 80);
    return () => window.clearTimeout(id);
  }, [map]);
  return null;
}
