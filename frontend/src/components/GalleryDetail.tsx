import { useEffect, useState } from "react";
import { api, type GalleryItem, type GallerySvg, type GcodePreview3D } from "../api";
import { fmtBytes, fmtDuration } from "../format";
import { useI18n } from "../i18n";
import { galleryItemObject } from "../paint/insertAsset";
import Gcode3D from "./Gcode3D";
import Gcode3DOverlay from "./Gcode3DOverlay";
import Modal from "./Modal";
import PolylinePreview from "./PolylinePreview";
import ScoreBadge from "./ScoreBadge";
import Segmented from "./Segmented";
import { useConfirm, usePrompt } from "./dialogs";

type View = "2d" | "3d";

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
  const { confirm, ConfirmNode } = useConfirm();
  const { prompt, PromptNode } = usePrompt();

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
      .then(([cal, page]) =>
        api.savePage(page.id, { objects: [galleryItemObject(item, svg, cal)] })
      )
      .then(() => onOpenPaint())
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const editTitle = async () => {
    const next = await prompt(t("gallery.titlePrompt"), item.title);
    if (next == null || next.trim() === item.title) return;
    setBusy(true);
    api
      .gallerySetTitle(item.id, next)
      .then(onChanged)
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

  const remove = async () => {
    if (!await confirm(t("gallery.confirmDelete"))) return;
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
            {item.title || t("gallery.untitled")}{" "}
            <button className="ghost tiny" title={t("gallery.editTitle")} disabled={busy} onClick={editTitle}>
              ✎
            </button>{" "}
            <ScoreBadge score={item.score} />
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
          {m && item.score && (
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
          )}
          {err && <div className="banner err">{err}</div>}
        </div>
      </Modal>
      {fullscreen && gcode && (
        <Gcode3DOverlay data={gcode} showTravels={showTravels} onClose={() => setFullscreen(false)} />
      )}
      {ConfirmNode}
      {PromptNode}
    </>
  );
}
