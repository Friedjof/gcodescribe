import { useEffect, useState } from "react";
import { api, type GalleryItem, type GallerySvg, type GcodePreview3D } from "../api";
import { useI18n } from "../i18n";
import { localize, type Pt } from "../paint/geometry";
import Gcode3D from "./Gcode3D";
import Modal from "./Modal";
import PolylinePreview from "./PolylinePreview";
import ScoreBadge from "./ScoreBadge";
import Segmented from "./Segmented";

type View = "2d" | "3d";

function fmtDuration(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, "0")} min`;
}

function fmtBytes(n: number) {
  return n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** Popup inspection of one submission: 2D artwork by default, switchable to
 * the generated G-code in 3D (with fullscreen), plus admin actions. */
export default function GalleryDetail({
  item,
  onClose,
  onChanged,
  onOpenPaint,
}: {
  item: GalleryItem;
  onClose: () => void;
  onChanged: () => void;
  onOpenPaint: () => void;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<View>("2d");
  const [svg, setSvg] = useState<GallerySvg | null>(null);
  const [gcode, setGcode] = useState<GcodePreview3D | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [showTravels, setShowTravels] = useState(true);
  const [resetToken, setResetToken] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fail = (e: any) => setErr(String(e.message ?? e));

  useEffect(() => {
    api.gallerySvg(item.id).then(setSvg).catch(fail);
  }, [item.id]);

  useEffect(() => {
    if (view === "3d" && !gcode) api.galleryGcode3D(item.id).then(setGcode).catch(fail);
  }, [view, gcode, item.id]);

  const toPaint = () => {
    if (!svg || busy) return;
    setBusy(true);
    setErr(null);
    const name = item.title || item.filename.replace(/\.[^.]+$/, "");
    Promise.all([api.getCalibration(), api.createPage(name)])
      .then(([cal, page]) => {
        const { local } = localize(svg.polylines as Pt[][]);
        const scale = Math.min(
          1,
          (cal.plot_width * 0.9) / Math.max(svg.width, 1),
          (cal.plot_height * 0.9) / Math.max(svg.height, 1)
        );
        return api.savePage(page.id, {
          objects: [
            {
              id: crypto.randomUUID(),
              type: "image",
              data: { galleryId: item.id, name, basePolylines: local },
              cachedPolylines: local,
              transform: {
                x: cal.plot_width / 2,
                y: cal.plot_height / 2,
                rotation: 0,
                scale,
              },
              plotted: false,
            },
          ],
        });
      })
      .then(() => onOpenPaint())
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const setArchived = (archived: boolean) => {
    setBusy(true);
    api
      .galleryArchive(item.id, archived)
      .then(onChanged)
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const remove = () => {
    if (!window.confirm(t("gallery.confirmDelete"))) return;
    setBusy(true);
    api
      .galleryDelete(item.id)
      .then(onChanged)
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const m = item.metrics;

  return (
    <>
      <Modal
        className="gallery-modal"
        title={
          <>
            {item.title || t("gallery.untitled")} <ScoreBadge score={item.score} />
          </>
        }
        headerActions={
          <Segmented<View>
            value={view}
            onChange={setView}
            options={[
              { value: "2d", label: "SVG" },
              { value: "3d", label: "G-code" },
            ]}
          />
        }
        onClose={onClose}
        footer={
          <>
            <button className="ghost" disabled={busy} onClick={remove}>
              {t("gallery.delete")}
            </button>
            <button className="ghost" disabled={busy} onClick={() => setArchived(item.status === "active")}>
              {item.status === "active" ? t("gallery.archive") : t("gallery.unarchive")}
            </button>
            {view === "3d" && gcode && (
              <>
                <label className="g3d-toggle">
                  <input
                    type="checkbox"
                    checked={showTravels}
                    onChange={(e) => setShowTravels(e.target.checked)}
                  />
                  {t("g3d.travels")}
                </label>
                <button className="ghost" onClick={() => setResetToken((n) => n + 1)}>
                  {t("g3d.resetView")}
                </button>
                <button onClick={() => setFullscreen(true)}>{t("convert.fullscreen")}</button>
              </>
            )}
            <button className="primary" disabled={busy || !svg} onClick={toPaint}>
              {t("gallery.toPaint")}
            </button>
          </>
        }
      >
        <div className="gallery-detail">
          <div className="gallery-stage">
            {view === "2d" ? (
              svg ? (
                <PolylinePreview data={svg} className="gallery-stage-svg" />
              ) : (
                <p className="muted">{t("common.loading")}</p>
              )
            ) : gcode ? (
              <Gcode3D data={gcode} chrome={false} showTravels={showTravels} resetToken={resetToken} />
            ) : (
              <p className="muted">{t("common.loading")}</p>
            )}
          </div>
          <dl className="gallery-metrics">
            <dt>{t("gallery.m.duration")}</dt>
            <dd>{fmtDuration(m.duration_s)}</dd>
            <dt>{t("gallery.m.penLifts")}</dt>
            <dd>{m.pen_lifts}</dd>
            <dt>{t("gallery.m.drawLen")}</dt>
            <dd>{(m.draw_mm / 1000).toFixed(2)} m</dd>
            <dt>{t("gallery.m.travelLen")}</dt>
            <dd>{(m.travel_mm / 1000).toFixed(2)} m</dd>
            <dt>{t("gallery.m.size")}</dt>
            <dd>{fmtBytes(m.size_bytes)}</dd>
            <dt>{t("gallery.m.complexity")}</dt>
            <dd>
              {m.polyline_count} / {m.point_count}
            </dd>
            <dt>{t("gallery.m.score")}</dt>
            <dd>
              {t("score.time")} {item.score.time} · {t("score.lifts")} {item.score.lifts} ·{" "}
              {t("score.size")} {item.score.size} · {t("score.detail")} {item.score.detail}
            </dd>
          </dl>
          {err && <div className="banner err">{err}</div>}
        </div>
      </Modal>
      {fullscreen && gcode && (
        <div className="g3d-fullscreen" onClick={() => setFullscreen(false)}>
          <div className="g3d-fullscreen-view" onClick={(e) => e.stopPropagation()}>
            <Gcode3D data={gcode} chrome={false} showTravels={showTravels} />
          </div>
        </div>
      )}
    </>
  );
}
