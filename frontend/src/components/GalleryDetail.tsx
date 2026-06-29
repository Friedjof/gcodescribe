import { useEffect, useState } from "react";
import { api, type Calibration, type GalleryItem, type GalleryPreview, type GcodePreview3D } from "../api";
import { fmtBytes, fmtDuration } from "../format";
import { useI18n } from "../i18n";
import { galleryItemObject } from "../paint/insertAsset";
import { polylinesObject } from "../games/utils";
import { parseStl, prepareMesh, resultToSvgLayers, type EdgeModel, type Mesh, type StlParams } from "../stl";
import StlEditor from "./StlEditor";
import StlView3D from "./StlView3D";
import Gcode3D from "./Gcode3D";
import type { Gcode3DView } from "./Gcode3D";
import Gcode3DOverlay from "./Gcode3DOverlay";
import LiveButton from "../stream/LiveButton";
import { useLiveStream } from "../stream/useLiveStream";
import Modal from "./Modal";
import PolylinePreview from "./PolylinePreview";
import ScoreBadge from "./ScoreBadge";
import Segmented from "./Segmented";
import { useToasts } from "./Toasts";
import { useConfirm, usePrompt } from "./dialogs";

type View = "2d" | "3d" | "original";
type RenderMode = "auto" | "vector" | "trace" | "edges" | "hatch" | "lines" | "dots" | "handwriting";

/** Popup inspection of one submission: 2D artwork by default, switchable to
 * the generated G-code in 3D (with fullscreen), plus admin actions. */
export default function GalleryDetail({
  item,
  visible = true,
  autoLive = false,
  onClose,
  onChanged,
  onOpenPaint,
  onOpenAiDesigner,
  aiEnabled = false,
  desktop = false,
}: {
  item: GalleryItem;
  visible?: boolean;
  autoLive?: boolean;
  onClose: () => void;
  onChanged: () => void;
  onOpenPaint: () => void;
  onOpenAiDesigner?: (itemId: string) => void;
  aiEnabled?: boolean;
  desktop?: boolean;
}) {
  const { t } = useI18n();
  const toast = useToasts();
  const [view, setView] = useState<View>("2d");
  const [svg, setSvg] = useState<GalleryPreview | null>(null);
  const [gcode, setGcode] = useState<GcodePreview3D | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [showTravels, setShowTravels] = useState(true);
  const [resetToken, setResetToken] = useState(0);
  const [renderMode, setRenderMode] = useState<RenderMode>((item.mode || "auto") as RenderMode);
  const [renderDetail, setRenderDetail] = useState(item.detail || 2);
  const [renderContinuous, setRenderContinuous] = useState(item.continuous !== false);
  const [gcode3dView, setGcode3dView] = useState<Gcode3DView>({ yaw: -0.7, pitch: 1.0, zoom: 1, panX: 0, panY: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [stlEdit, setStlEdit] = useState<{ buf: ArrayBuffer; params?: StlParams; cal: Calibration } | null>(null);
  const [stlSaving, setStlSaving] = useState(false);
  const [stlSpin, setStlSpin] = useState<{ mesh: Mesh; model: EdgeModel } | null>(null);
  const { confirm, ConfirmNode } = useConfirm();
  const { prompt, PromptNode } = usePrompt();

  const fail = (e: any) => setErr(String(e.message ?? e));

  const openStlEditor = () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const url = api.galleryOriginalUrl(item.id);
    Promise.all([api.getCalibration(), fetch(url).then((r) => r.arrayBuffer())])
      .then(([cal, buf]) =>
        setStlEdit({ buf, cal, params: (item.stl_params as unknown as StlParams) ?? undefined })
      )
      .catch(fail)
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    setSvg(null);
    setGcode(null);
    setStlSpin(null);
    setRenderMode((item.mode || "auto") as RenderMode);
    setRenderDetail(item.detail || 2);
    setRenderContinuous(item.continuous !== false);
    // Page-1 preview works for every kind (single-image submissions and
    // multi-page admin assets alike); `/svg` only exists for image.svg items.
    api.galleryPreview(item.id, 1).then(setSvg).catch(fail);
  }, [item.id, item.mode, item.detail, item.continuous, item.lines]);

  // Load the original STL once, to show a slowly auto-rotating 3D preview.
  useEffect(() => {
    if (item.kind !== "stl" || view !== "original" || stlSpin) return;
    let alive = true;
    fetch(api.galleryOriginalUrl(item.id))
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        if (!alive) return;
        const mesh = parseStl(buf);
        if (mesh.triangles.length) setStlSpin({ mesh, model: prepareMesh(mesh) });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [item.kind, item.id, view, stlSpin]);

  useEffect(() => {
    if (view === "3d" && !gcode) api.galleryGcode3D(item.id).then(setGcode).catch(fail);
  }, [view, gcode, item.id]);

  useEffect(() => {
    if (err) toast.error(err);
  }, [err, toast]);

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

  const rerender = () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    api
      .galleryRender(item.id, renderMode, renderDetail, renderContinuous)
      .then(() => {
        setSvg(null);
        setGcode(null);
        return api.galleryPreview(item.id, 1).then(setSvg);
      })
      .then(onChanged)
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const m = item.metrics;
  const hasGcode = item.pages.length > 0;
  const originalUrl = item.original ? api.galleryOriginalUrl(item.id) : null;
  const originalPreviewable = !!item.original && (
    item.original.mime.startsWith("image/") || item.original.kind === "svg"
  );

  const live = useLiveStream("gallery", () => {
    const width = Math.max(svg?.width ?? 1, 1);
    const height = Math.max(svg?.height ?? 1, 1);
    const cal = {
      bed_width: width,
      bed_height: height,
      z_max: 200,
      plot_width: width,
      plot_height: height,
      origin_x: 0,
      origin_y: 0,
      pen_up_z: 5,
      pen_down_z: 0,
      pen_calibrated: false,
      travel_feed: 1000,
      draw_feed: 1000,
      z_feed: 1000,
      fit_to_area: true,
      flip_y: false,
      trust_axis_home: false,
      park_after_plot: true,
      paper_corners: {},
      paper_margin: 0,
      obstacles: [],
      merge_tolerance: 0.5,
    };
    return {
      cal,
      page: { id: `gallery-${item.id}`, name: item.title || item.filename, objects: [], grid: { step: 10, snap: false } },
      meta: { sourceId: "gallery", mode: view === "3d" && gcode ? "gcode3d" : "gallery", pageName: item.title || item.filename },
      gcode3d: view === "3d" ? gcode : null,
      gcode3dView: view === "3d" && gcode ? gcode3dView : null,
      gallery: { title: item.title || item.filename, preview: svg, gcode3d: view === "3d" ? gcode : null },
    };
  });

  useEffect(() => {
    if (!autoLive || live.activeSourceId === "gallery") return;
    if (view === "2d" && svg) live.start();
    if (view === "3d" && gcode) live.start();
  }, [autoLive, view, svg, gcode, live.activeSourceId]);

  useEffect(() => {
    if (live.error) toast.error(live.error);
  }, [live.error, toast]);

  useEffect(() => {
    if (live.state === "live") live.sendSnapshot("snapshot");
  }, [view, svg, gcode, gcode3dView, showTravels, live.state]);

  useEffect(() => {
    if (visible || live.state !== "live") return;
    live.sendPlaceholder("gallery-hidden");
  }, [visible, live.state]);

  const close = () => {
    if (live.state === "live") live.sendPlaceholder("gallery-closed");
    onClose();
  };

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
          <div className="gallery-modal-actions">
            {!desktop && (
              <LiveButton
                state={live.state}
                viewers={live.viewers}
                onClick={() => live.state === "live" || live.state === "connecting" ? live.stop("user-stopped") : live.start()}
              />
            )}
            {(hasGcode || item.original) && (
              <Segmented<View>
                value={view}
                onChange={setView}
                options={[
                  { value: "2d", label: "SVG" },
                  ...(hasGcode ? [{ value: "3d" as View, label: "G-code" }] : []),
                  ...(item.original ? [{ value: "original" as View, label: t("gallery.original") }] : []),
                ]}
              />
            )}
          </div>
        }
        onClose={close}
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
            {originalUrl && (
              <a className="button ghost" href={originalUrl} download={item.original?.filename}>
                {t("gallery.downloadOriginal")}
              </a>
            )}
            {aiEnabled && onOpenAiDesigner && item.original?.mime.startsWith("image/") && (
              <button
                className="ghost"
                disabled={busy}
                onClick={() => { onOpenAiDesigner(item.id); onClose(); }}
              >
                {t("gallery.toAiDesigner")}
              </button>
            )}
            <button className="primary" disabled={busy || !svg} onClick={toPaint}>
              {t("gallery.toPaint")}
            </button>
          </>
        }
      >
        <div className="gallery-detail">
          <div className="gallery-stage">
            {view === "original" ? (
              item.kind === "stl" ? (
                stlSpin ? (
                  <StlView3D
                    mesh={stlSpin.mesh}
                    model={stlSpin.model}
                    azimuth={(item.stl_params?.azimuth as number) ?? Math.PI / 4}
                    elevation={(item.stl_params?.elevation as number) ?? Math.PI / 6}
                    fov={(item.stl_params?.fov as number) ?? (45 * Math.PI) / 180}
                    up={((item.stl_params?.up as "z" | "y") ?? "z")}
                    distanceFactor={(item.stl_params?.distanceFactor as number) ?? 2.6}
                    featureAngleDeg={(item.stl_params?.featureAngleDeg as number) ?? 25}
                    showTriangles={false}
                    shading
                    opacity={1}
                    showBox={false}
                    autoRotate
                  />
                ) : (
                  <p className="muted">{t("common.loading")}</p>
                )
              ) : originalUrl && item.original ? (
                <div className="gallery-original">
                  {originalPreviewable ? (
                    <img src={originalUrl} alt={item.original.filename} />
                  ) : (
                    <div className="gallery-original-file">
                      <strong>{item.original.filename}</strong>
                      <span className="muted">{item.original.mime}</span>
                    </div>
                  )}
                  <p className="muted">
                    {item.original.filename} · {fmtBytes(item.original.size)}
                  </p>
                </div>
              ) : (
                <p className="muted">{t("gallery.noOriginal")}</p>
              )
            ) : view === "2d" ? (
              svg ? (
                <PolylinePreview data={svg} className="gallery-stage-svg" />
              ) : (
                <p className="muted">{t("common.loading")}</p>
              )
            ) : gcode ? (
              <Gcode3D data={gcode} chrome={false} showTravels={showTravels} resetToken={resetToken} viewState={gcode3dView} onViewChange={setGcode3dView} />
            ) : (
              <p className="muted">{t("common.loading")}</p>
            )}
          </div>
          {item.kind === "stl" ? (
            <div className="gallery-render-controls">
              <span className="muted">{t("stl.title")}</span>
              <button className="primary" disabled={busy || !item.original} onClick={openStlEditor}>
                {t("stl.reedit")}
              </button>
            </div>
          ) : (
          <div className="gallery-render-controls">
            <span className="muted">{t("gallery.renderMode")}</span>
            <Segmented<RenderMode>
              value={renderMode}
              onChange={setRenderMode}
              options={[
                { value: "auto", label: t("gallery.modeAuto") },
                { value: "vector", label: t("gallery.modeVector") },
                { value: "trace", label: t("gallery.modeTrace") },
                { value: "edges", label: t("paint.image.edges") },
                { value: "hatch", label: t("paint.image.hatch") },
                { value: "lines", label: t("paint.image.lines") },
                { value: "dots", label: t("paint.image.dots") },
                { value: "handwriting", label: t("gallery.modeHandwriting") },
              ]}
            />
            {renderMode !== "vector" && (
              <Segmented
                value={renderDetail}
                onChange={setRenderDetail}
                options={[
                  { value: 1, label: t("paint.image.low") },
                  { value: 2, label: t("paint.image.medium") },
                  { value: 3, label: t("paint.image.high") },
                ]}
              />
            )}
            <Segmented<string>
              value={renderContinuous ? "continuous" : "faithful"}
              onChange={(v) => setRenderContinuous(v === "continuous")}
              options={[
                { value: "continuous", label: t("slice.continuous") },
                { value: "faithful", label: t("slice.faithful") },
              ]}
            />
            <button className="primary" disabled={busy || !item.original} onClick={rerender}>
              {busy ? t("common.loading") : t("gallery.rerender")}
            </button>
          </div>
          )}
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
        </div>
      </Modal>
      {fullscreen && gcode && (
        <Gcode3DOverlay data={gcode} showTravels={showTravels} viewState={gcode3dView} onViewChange={setGcode3dView} onClose={() => setFullscreen(false)} />
      )}
      {stlEdit && (
        <StlEditor
          cal={stlEdit.cal}
          saving={stlSaving}
          initialStl={stlEdit.buf}
          initialParams={stlEdit.params}
          initialName={item.filename}
          onClose={() => setStlEdit(null)}
          onInsert={(template, coloring) => {
            setBusy(true);
            api.createPage(template.name)
              .then((page) => api.savePage(page.id, {
                objects: [polylinesObject(template.lines)],
                ...(coloring ? { coloring } : {}),
              }))
              .then(() => { setStlEdit(null); onOpenPaint(); })
              .catch(fail)
              .finally(() => setBusy(false));
          }}
          onSaveGallery={({ params, result }) => {
            setStlSaving(true);
            api.galleryUpdateStl(item.id, params, resultToSvgLayers(result))
              .then(() => { setStlEdit(null); toast.success(t("stl.saved")); onChanged(); })
              .catch(fail)
              .finally(() => setStlSaving(false));
          }}
        />
      )}
      {ConfirmNode}
      {PromptNode}
    </>
  );
}
