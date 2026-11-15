import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, errorMessage, isAbortError } from "../../api/errors";
import type { PrinterStatus } from "../../api/types/printer";
import { isPrinterBusy } from "../../lib/printerState";
import { api, onAppEvent, type AppEvent, type GcodePreview3D, type Page, type PageIndex, type SceneObject } from "../../api";
import PaintCanvas, { type Tool, type ViewRotation } from "./PaintCanvas";
import MarkdownEditor from "../markdown/MarkdownEditor";
import ProjectPagePanel from "./ProjectPagePanel";
import ProjectOverviewPopup from "./ProjectOverviewPopup";
import GalleryPopup from "../gallery/GalleryPopup";
import Gcode3DOverlay from "../../components/Gcode3DOverlay";
import ColoringEditor from "../coloring/ColoringEditor";
import type { Gcode3DView } from "../../components/Gcode3D";
import { defaultSceneViewBox } from "./components/SceneView";
import { useLiveRegistryState } from "../stream/lib/liveRegistry";
import { useLiveStream } from "../stream/hooks/useLiveStream";
import { useLiveSource } from "../../hooks/useLiveSource";
import { localize, transformPolylines, type Pt, type Transform } from "./lib/geometry";
import { type TextFont } from "./lib/text";
import { objectStyle, randomTextSeed, textGeometryAsync } from "./lib/sceneObjects";
import { DEFAULT_VECTOR_STYLE, type FillStyle } from "./lib/styling";
import { bucketFillRegion } from "./lib/bucketFill";
import { useObjectOps } from "./hooks/useObjectOps";
import { usePaintPages } from "./hooks/usePaintPages";
import { usePaintShortcuts } from "./hooks/usePaintShortcuts";
import { type EraserBrush, ERASER_BRUSH_FACTOR } from "./lib/eraser";
import { useI18n } from "../../i18n";
import { useToasts } from "../../components/Toasts";
import { useConfirm, usePrompt } from "../../components/dialogs";
import { PaintImageModal, type ImageMode } from "./components/PaintImageModal";
import PaintContextPanel from "./components/PaintContextPanel";
import PaintToolRail, { paintTools } from "./components/PaintToolRail";
import PaintToolbar from "./components/PaintToolbar";
import PaintObjectMenu from "./components/PaintObjectMenu";
import PaintInfoModal from "./components/PaintInfoModal";
import { queueObjects, rememberPage, flushEdits, subscribeEdits, subscribeSaved, editState, discardEdits, cachedPage, refreshPage } from "../../api/pageEdits";
import { startImport, type AssetTask } from "../../api/assetTasks";
import { useLatestCallbacks } from "../../hooks/useLatestCallbacks";
import DelayedLoading from "../../components/DelayedLoading";
import CalibrationPressureDialog from "../control/CalibrationPressureDialog";
import { fitPageObjects } from "./lib/fitPage";
import { useProjectCalibration } from "../../state/ProjectCalibrationContext";

export default function Paint({
  visible = true,
  status,
  onAction,
  desktop = false,
}: {
  visible?: boolean;
  status?: PrinterStatus | null;
  onAction?: () => void;
  desktop?: boolean;
}) {
  const { t } = useI18n();
  const toast = useToasts();
  const defaultText = t("paint.text");
  const { index, setIndex, profile, agentRevision, loading: calibrationLoading, error: calibrationError, refresh } = useProjectCalibration();
  const [page, setPage] = useState<Page | null>(null);
  const projectMatches = !!page && page.projectId === index?.project?.id;
  const renderProfile = projectMatches && !calibrationLoading ? profile : null;
  const cal = projectMatches ? profile?.calibration ?? null : null;
  const [tool, setTool] = useState<Tool>("select");
  const [eraserBrush, setEraserBrush] = useState<EraserBrush>("small");
  const [fillStyle, setFillStyle] = useState<FillStyle>({ ...DEFAULT_VECTOR_STYLE.fill, enabled: true });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [, setSaveTick] = useState(0);
  useEffect(() => subscribeEdits(() => setSaveTick((n) => n + 1)), []);
  const saveState = page ? editState(page.id) : { pending: false, error: undefined, conflict: false };
  const [calibrating, setCalibrating] = useState(false);
  const [pressureOpen, setPressureOpen] = useState(false);
  useEffect(() => { setPressureOpen(false); }, [index?.project?.id, index?.project?.profileId]);
  const printerBusy = calibrating || isPrinterBusy(status);
  const [fullscreen, setFullscreen] = useState<GcodePreview3D | null>(null);
  const [gcode3dView, setGcode3dView] = useState<Gcode3DView>({ yaw: -0.7, pitch: 1.0, zoom: 1, panX: 0, panY: 0 });
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [plotError, setPlotError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null);
  const [imageImport, setImageImport] = useState<{ file: File; at: Pt; mode: ImageMode; detail: number;
    pageId: string; projectId: string; profileId: string; fingerprint: string } | null>(null);
  const [mdOpen, setMdOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [movePageId, setMovePageId] = useState<string | null>(null);
  const [viewRotation, setViewRotation] = useState<ViewRotation>(0);
  const [sizeLinked, setSizeLinked] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);
  const [pagesCollapsed, setPagesCollapsed] = useState(() => {
    try { return localStorage.getItem("paint-pages-collapsed") === "1"; } catch { return false; }
  });
  const [coloringOpen, setColoringOpen] = useState(false);
  const globalLive = useLiveRegistryState();
  const { confirm, ConfirmNode } = useConfirm();
  const { prompt, PromptNode } = usePrompt();

  const fail = (e: unknown) => { if (!isAbortError(e)) toast.error(errorMessage(e)); };
  const failPlot = (e: unknown) => {
    setPlotError(errorMessage(e));
    if (e instanceof ApiError && e.status === 409) { void refresh(true).catch(fail); }
  };
  useEffect(() => setPlotError(null), [page?.id]);
  const warnMissingGlyphs = (missing: string[]) => {
    const chars = Array.from(new Set(missing)).slice(0, 12).join(" ");
    toast.warn(t("paint.missingGlyphs", { chars, count: missing.length }));
  };

  const eraserRadius = useMemo(() => {
    if (eraserBrush === "point") return 0;
    const S = cal ? Math.max(cal.plot_width, cal.plot_height) : 300;
    return S * ERASER_BRUSH_FACTOR[eraserBrush];
  }, [eraserBrush, cal]);

  // persist objects (debounced) for a specific page id
  const persist = (pageId: string, objects: SceneObject[]) => {
    if (page) rememberPage(page);
    queueObjects(pageId, objects);
  };

  const ops = useObjectOps(page, cal, selectedIds, setPage, setSelectedIds, persist, fail, warnMissingGlyphs, defaultText, sizeLinked);

  const live = useLiveStream("designer", () => {
    if (!cal || !page) return null;
    return {
      cal,
      page: { id: page.id, name: page.name, objects: page.objects, grid: page.grid },
      meta: {
        sourceId: "designer",
        pageName: page.name,
        viewBox: defaultSceneViewBox(cal, viewRotation),
        viewRotation,
        mode: fullscreen ? "gcode3d" : "canvas",
      },
      gcode3d: fullscreen,
      gcode3dView: fullscreen ? gcode3dView : null,
    };
  });

  const activeToolMeta = paintTools(t).find((o) => o.value === tool);

  // Both fill tools produce a normal closed object with fill.enabled, so the
  // existing style/render/G-code pipeline (withStyledCache → buildStyledPolylines
  // → hatchFill) turns it into plottable hatch lines with no backend changes.
  // Guard against degenerate/empty polygons: an empty localize() yields NaN
  // centers, which serialise to null and crash the backend's transform math.
  const makeFillObject = (polygonWorld: Pt[][]): SceneObject | null => {
    const { local, cx, cy } = localize(polygonWorld);
    if (!local.some((line) => line.length >= 2) || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    return {
      id: crypto.randomUUID(),
      type: "fill",
      data: { basePolylines: local, style: { ...DEFAULT_VECTOR_STYLE, fill: { ...fillStyle, enabled: true } } },
      transform: { x: cx, y: cy, rotation: 0, scale: 1 },
      plotted: false,
    };
  };

  const handleBucketFill = (at: Pt) => {
    if (!page || !cal) return;
    const world = page.objects
      .filter((o) => !o.plotted)
      .flatMap((o) => transformPolylines((o.cachedPolylines ?? []) as Pt[][], o.transform ?? { x: 0, y: 0, rotation: 0, scale: 1 }));
    const poly = bucketFillRegion(world, at, cal.plot_width, cal.plot_height);
    const obj = poly && makeFillObject([poly]);
    if (!obj) { toast.error(t("paint.bucketFillFailed")); return; }
    ops.addObject(obj);
  };

  const handleAreaFill = (polygonWorld: Pt[]) => {
    if (polygonWorld.length < 3) return;
    const obj = makeFillObject([polygonWorld]);
    if (!obj) { toast.error(t("paint.bucketFillFailed")); return; }
    ops.addObject(obj);
  };

  const selectTool = (v: Tool) => {
    setTool(v);
    if (v !== "select") setSelectedIds([]);
  };

  const reloadIndex = () => refresh().catch(fail);
  const pageIdRef = useRef<string | null>(null);
  const lastAgentRevision = useRef(0);
  useEffect(() => { pageIdRef.current = page?.id ?? null; }, [page?.id]);
  useEffect(() => {
    if (!visible || !index) return;
    const id = index.activeId ?? index.order[0]?.id;
    if (!id || (id === pageIdRef.current && projectMatches && lastAgentRevision.current === agentRevision)) return;
    const controller = new AbortController();
    api.getPage(id, controller.signal).then(next => {
      if (controller.signal.aborted) return;
      ops.resetHistory();
      setSelectedIds([]);
      setPage(next);
      lastAgentRevision.current = agentRevision;
    }).catch(fail);
    return () => controller.abort();
  }, [visible, index?.project?.id, agentRevision]);

  // The shared context refreshes metadata and announces completed MCP changes.
  // Ordinary document writes keep the canvas's in-progress edits intact.
  const liveHandlerRef = useRef<(event: AppEvent) => void>(() => {});
  liveHandlerRef.current = (event: AppEvent) => {
    if (event.type === "document") {
      if (event.action === "import" && event.pageId) refreshPage(event.pageId).catch(fail);
      return;
    }
  };
  useEffect(() => onAppEvent((event) => liveHandlerRef.current(event)), []);
  useEffect(() => {
    const saved = (id: string) => {
      const next = cachedPage(id);
      if (next) setPage((previous) => previous?.id === id ? { ...previous, objects: next.objects, revision: next.revision } : previous);
    };
    const unsubscribeSaved = subscribeSaved(saved);
    const imported = (event: Event) => {
      const task = (event as CustomEvent<AssetTask>).detail;
      if (task.attached && task.target) void refreshPage(task.target.page_id).catch(fail);
    };
    window.addEventListener("gcs:asset-ready", imported);
    return () => { unsubscribeSaved(); window.removeEventListener("gcs:asset-ready", imported); };
  }, []);

  useLiveSource(live, {
    visible,
    hiddenReason: "designer-hidden",
    onError: toast.error,
    snapshotDeps: [cal, page?.id, page?.name, page?.grid, page?.objects, viewRotation, fullscreen, gcode3dView],
  });

  useEffect(() => {
    if (!visible || !cal || !page) return;
    if (!globalLive.active || globalLive.sourceId === "designer") return;
    live.start();
  }, [visible, cal, page?.id, globalLive.active, globalLive.sourceId]);

  const pageBlocked = !renderProfile;

  const showProject = async (next: PageIndex) => {
    const id = next.activeId ?? next.order[0]?.id;
    const nextPage = id ? await api.getPage(id) : null;
    setIndex(next); ops.resetHistory(); setSelectedIds([]);
    setPage(nextPage);
  };

  const pages = usePaintPages({
    page,
    setPage,
    setIndex,
    setSelectedIds,
    ops,
    reloadIndex,
    confirm,
    prompt,
    fail,
  });

  const setGrid = (patch: Partial<{ step: number; snap: boolean }>) => {
    if (!page) return;
    const grid = { ...page.grid, ...patch };
    setPage({ ...page, grid });
    api.savePage(page.id, { grid }).then(reloadIndex).catch(fail);
  };

  const setContinuous = (continuous: boolean) => {
    if (!page) return;
    setPage({ ...page, continuous });
    api.savePage(page.id, { continuous }).then(reloadIndex).catch(fail);
  };

  const generateJob = (objects?: SceneObject[]) => {
    setPlotError(null);
    if (!page) return Promise.reject(new Error(t("paint.noPage")));
    if (!renderProfile) return Promise.reject(new Error("Die aktuelle Projektkalibrierung wird noch geladen."));
    if (ops.processing) return Promise.reject(new Error(t("paint.processingGeometry")));
    setBusy(true);
    return flushEdits(page.id).then(() => api.pageGcode(page.id, renderProfile, objects))
      .then((job) => {
        toast.success(t("paint.jobCreated", { name: job.filename }));
        return job.filename;
      })
      .finally(() => setBusy(false));
  };

  const createGcode = () => {
    if (busy) return;
    generateJob().catch(failPlot);
  };

  const moveToCalibration = () => {
    if (!status?.online || busy || sending || printerBusy) return;
    setCalibrating(true);
    api.homeAndMoveToPosition("calibration", index?.project?.id)
      .then(() => onAction?.())
      .catch(fail)
      .finally(() => setCalibrating(false));
  };

  const directPlot = () => {
    if (busy || sending || printerBusy || pageBlocked) return;
    generateJob()
      .then((filename) => {
        setSending(true);
        return api.send(filename, true).then(() => toast.success(t("paint.jobStarted", { name: filename })));
      })
      .catch(failPlot)
      .finally(() => setSending(false));
  };

  const plotSelection = () => {
    if (!page || busy || sending || printerBusy || pageBlocked || selectedIds.length === 0) return;
    const ids = [...selectedIds];
    const subset = page.objects.filter((o) => ids.includes(o.id));
    if (subset.length === 0) return;
    generateJob(subset)
      .then((filename) => {
        setSending(true);
        return api.send(filename, true).then(() => {
          toast.success(t("paint.selectionPlotted", { name: filename }));
          ops.remember();
          ops.markPlotted(ids);
          setSelectedIds([]);
        });
      })
      .catch(failPlot)
      .finally(() => setSending(false));
  };

  const openFullscreen = () => {
    if (!page || loadingPreview || !renderProfile) return;
    setPlotError(null);
    setLoadingPreview(true);
    api.pagePreview3D(page.id, page.objects, renderProfile)
      .then(setFullscreen)
      .catch(failPlot)
      .finally(() => setLoadingPreview(false));
  };

  const fitDrawing = () => {
    if (!page || !cal || pageBlocked) return;
    const objects = fitPageObjects(page.objects, cal.plot_width, cal.plot_height);
    if (!objects) return;
    ops.remember();
    setPage({ ...page, objects });
    persist(page.id, objects);
    setPlotError(null);
  };

  const selectIds = (ids: string[]) => {
    setSelectedIds(ids);
    setMenu(null);
  };

  const updateObject = (id: string, transform: Transform) => {
    if (!page) return;
    const objects = page.objects.map((o) => (o.id === id ? { ...o, transform, plotted: false } : o));
    setPage({ ...page, objects });
    persist(page.id, objects);
  };

  const updateObjects = (updates: Map<string, Transform>) => {
    if (!page || updates.size === 0) return;
    const objects = page.objects.map((o) => {
      const transform = updates.get(o.id);
      return transform ? { ...o, transform, plotted: false } : o;
    });
    setPage({ ...page, objects });
    persist(page.id, objects);
  };

  const addTextObject = (at: Pt) => {
    const text = defaultText;
    const size = 12;
    const font: TextFont = "sans";
    const seed = randomTextSeed();
    textGeometryAsync(text, size, font, defaultText, false, seed)
      .then(({ local, cx, cy, feeds, missing }) => {
        if (missing?.length) warnMissingGlyphs(missing);
        ops.addObject({
          id: crypto.randomUUID(),
          type: "text",
          data: { text, mode: "single-line", size, font, seed, basePolylines: local, style: DEFAULT_VECTOR_STYLE },
          cachedPolylines: local,
          cachedFeeds: feeds,
          transform: { x: at[0] + cx, y: at[1] + cy, rotation: 0, scale: 1 },
          plotted: false,
        });
      })
      .catch(fail);
  };

  const openImageImport = (file: File, at: Pt) => {
    if (!page || !index?.project || !renderProfile?.fingerprint || page.projectId !== index.project.id
        || renderProfile.id !== index.project.profileId) return;
    setImageImport({ file, at, mode: "edges", detail: 2, pageId: page.id,
      projectId: index.project.id, profileId: renderProfile.id, fingerprint: renderProfile.fingerprint });
  };

  const pickImage = (file: File | undefined) => {
    if (!file || !cal) return;
    openImageImport(file, [cal.plot_width / 2, cal.plot_height / 2]);
  };

  const importImage = () => {
    if (!page || !cal || !imageImport || !index?.project || !renderProfile) return;
    if (imageImport.pageId !== page.id || imageImport.projectId !== page.projectId
        || imageImport.projectId !== index.project.id || renderProfile.id !== index.project.profileId
        || imageImport.profileId !== renderProfile.id || imageImport.fingerprint !== renderProfile.fingerprint) {
      setImageImport(null);
      fail(new Error("Die Zielseite oder Projektkalibrierung wurde geändert. Bitte das Bild erneut einfügen."));
      return;
    }
    setImageImport(null); setTool("select");
    startImport(imageImport.file, { mode: imageImport.mode, detail: imageImport.detail,
      target: { page_id: page.id, project_id: index.project.id, x: imageImport.at[0], y: imageImport.at[1],
        profile_id: renderProfile.id, fingerprint: renderProfile.fingerprint,
        width: cal.plot_width, height: cal.plot_height } })
      .catch(fail);
  };

  const insertMarkdown = (objs: SceneObject[], markdown: string) => {
    if (!page) return;
    ops.addObjects(objs);
    setPage((p) => (p ? { ...p, markdown } : p));
    api.savePage(page.id, { markdown }).then(reloadIndex).catch(fail);
    setMdOpen(false);
    setTool("select");
  };

  // Keyboard shortcuts — only active when this tab is visible and no modal
  // is open (otherwise Escape would also reset tool/selection).
  usePaintShortcuts({
    active: visible && !coloringOpen && !infoOpen && !imageImport && !projectsOpen,
    tool,
    setTool,
    selectedIds,
    setSelectedIds,
    closeMenu: () => setMenu(null),
    ops,
    page,
    defaultText,
  });

  const canvasHandlers = useLatestCallbacks({
    onSelect: selectIds, onAdd: ops.addObject, onUpdate: updateObject, onUpdateMany: updateObjects,
    onEditStart: ops.remember,
    onContextMenuSelection: (ids: string[], x: number, y: number) => { setSelectedIds(ids); setMenu({ ids, x, y }); },
    onImageDrop: openImageImport,
    onTextAdd: addTextObject, onBucketFill: handleBucketFill, onAreaFill: handleAreaFill, onErase: ops.eraseAcrossObjects,
  });
  if (calibrationError) return <div className="card banner err" role="alert">
    <strong>Projektkalibrierung konnte nicht geladen werden</strong><p>{calibrationError}</p>
    <button onClick={() => { void refresh(true).catch(fail); }}>Erneut laden</button>
  </div>;
  if (!cal || !index || !page) return <DelayedLoading />;

  const selectedObjects = page.objects.filter((o) => selectedIds.includes(o.id));
  const hasSelection = selectedObjects.length > 0;
  const selectedText = selectedObjects.length === 1 && selectedObjects[0].type === "text"
    ? selectedObjects[0]
    : null;
  const selectedObjectSize = selectedObjects.length === 1 ? ops.objectLocalSize(selectedObjects[0]) : null;
  const aspectLocked = selectedObjects.length === 1 && !!selectedObjects[0].data?.sourcePage;
  const selectedObjectRotation = selectedObjects.length === 1
    ? (() => {
        const raw = ((selectedObjects[0].transform?.rotation ?? 0) * 180) / Math.PI;
        const normalized = ((raw % 360) + 360) % 360;
        return normalized === 0 && raw > 0.0001 ? 360 : normalized;
      })()
    : null;
  const selectedStyle = ops.pendingStyle ?? (selectedObjects.length > 0 ? objectStyle(selectedObjects[0]) : DEFAULT_VECTOR_STYLE);

  const togglePagesCollapsed = () => {
    setPagesCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem("paint-pages-collapsed", next ? "1" : "0"); } catch {}
      return next;
    });
  };

  return (
    <div className={`paint${pagesCollapsed ? " pages-collapsed" : ""}`}>
      <PaintObjectMenu menu={menu} objects={page.objects} ops={ops} onClose={() => setMenu(null)} />
      {imageImport && (
        <PaintImageModal
          file={imageImport.file}
          mode={imageImport.mode}
          detail={imageImport.detail}
          importing={false}
          continuous={page.continuous !== false}
          onModeChange={(m) => setImageImport({ ...imageImport, mode: m })}
          onDetailChange={(d) => setImageImport({ ...imageImport, detail: d })}
          onContinuousChange={setContinuous}
          onCancel={() => setImageImport(null)}
          onImport={importImage}
        />

      )}
      <ProjectPagePanel
        index={index}
        activePageId={page.id}
        onOpenProjects={() => setProjectsOpen(true)}
        onOpen={pages.openPage}
        onNew={pages.newPage}
        onRename={pages.rename}
        onDuplicate={pages.duplicate}
        onRemove={pages.remove}
        onReorder={pages.reorder}
        onCreateGroup={pages.createGroup}
        onRenameGroup={pages.renameGroup}
        onDeleteGroup={pages.deleteGroup}
        onSetPageGroup={pages.setPageGroup}
        onSetGroupParent={pages.setGroupParent}
        onMove={(id) => { setMovePageId(id); setProjectsOpen(true); }}
        sidebarCollapsed={pagesCollapsed}
        onToggleSidebar={togglePagesCollapsed}
      />

      <section className="card paint-editor">
        <PaintToolbar
          page={page}
          desktop={desktop}
          liveState={live.state}
          liveViewers={live.viewers}
          onToggleLive={() => live.state === "live" || live.state === "connecting" ? live.stop("user-stopped") : live.start()}
          busy={busy || ops.processing}
          sending={sending}
          printerBusy={printerBusy}
          printerOnline={!!status?.online}
          calibrating={calibrating}
          pageBlocked={pageBlocked}
          loadingPreview={loadingPreview}
          hasSelection={hasSelection}
          onSetGrid={setGrid}
          onSetContinuous={setContinuous}
          onCreateGcode={createGcode}
          onDirectPlot={directPlot}
          onMoveToCalibration={moveToCalibration}
          onOpenPressure={() => setPressureOpen(true)}
          onPlotSelection={plotSelection}
          onOpenColoring={() => setColoringOpen(true)}
          onOpenFullscreen={openFullscreen}
          onOpenInfo={() => setInfoOpen(true)}
        />

        <p className="paint-profile-context muted">
          Projektprofil: <strong>{renderProfile?.name ?? "wird geladen …"}</strong>
          {renderProfile && <> · Ursprung X {cal.origin_x.toFixed(1)}, Y {cal.origin_y.toFixed(1)} mm
            · Fläche {cal.plot_width.toFixed(1)} × {cal.plot_height.toFixed(1)} mm</>}
        </p>

        {saveState.error && <div className="banner err save-status" role="alert">
          <span>{saveState.conflict ? t("save.conflict") : t("save.failed")}</span>
          <button onClick={() => flushEdits(page.id, !!saveState.conflict).catch(fail)}>{t(saveState.conflict ? "save.keepLocal" : "save.retry")}</button>
          <button onClick={() => discardEdits(page.id).then(setPage).catch(fail)}>{t("save.reload")}</button>
        </div>}
        {plotError && <div className="banner err paint-plot-error" role="alert">
          <div><strong>Plotprüfung fehlgeschlagen</strong><p>{plotError}</p></div>
          {plotError.includes("außerhalb der aktuellen Projektfläche") &&
            <button disabled={pageBlocked} onClick={fitDrawing}>Zeichnung proportional einpassen</button>}
          {/kalibrierung|profil|papier/i.test(plotError) &&
            <button onClick={() => { reloadIndex(); setProjectsOpen(true); }}>Projektprofil prüfen</button>}
          <button className="ghost" aria-label="Plot-Hinweis schließen" onClick={() => setPlotError(null)}>×</button>
        </div>}
        {ops.processing && <span className="geometry-status" role="status">{t("paint.processingGeometry")}</span>}

        <div className="paint-workspace">
          <PaintToolRail tool={tool} onToolChange={selectTool} />
          <div className="paint-canvas-wrap">
            {page.objects.length === 0 && (
              <div className="paint-empty-hint">
                <strong>{t("paint.emptyHint")}</strong>
                <button className="ghost" onClick={() => setGalleryOpen(true)}>▦ {t("gallery.button")}</button>
              </div>
            )}
            <PaintCanvas
              visible={visible}
              cal={cal}
              page={page}
              tool={tool}
              selectedIds={selectedIds}
              {...canvasHandlers}
              eraserRadius={eraserRadius}
              eraserIsPoint={eraserBrush === "point"}
              onCursorMove={live.state === "live" ? live.sendCursor : undefined}
              onCursorClick={live.state === "live" ? live.sendClick : undefined}
              viewRotation={viewRotation}
              onViewRotationChange={setViewRotation}
            />
          </div>

          <PaintContextPanel
            tool={tool}
            activeToolLabel={activeToolMeta ? activeToolMeta.label : ""}
            ops={ops}
            hasSelection={hasSelection}
            selectedObjects={selectedObjects}
            selectedObjectSize={selectedObjectSize}
            selectedObjectRotation={selectedObjectRotation}
            selectedStyle={selectedStyle}
            pressureMaxDepth={cal.pen_pressure_max_depth ?? 0}
            selectedText={selectedText}
            defaultText={defaultText}
            sizeLinked={sizeLinked || aspectLocked}
            aspectLocked={aspectLocked}
            onSizeLinkedToggle={() => setSizeLinked((v) => !v)}
            eraserBrush={eraserBrush}
            onEraserBrushChange={setEraserBrush}
            eraserRadius={eraserRadius}
            fillStyle={fillStyle}
            onFillStyleChange={(patch) => setFillStyle((f) => ({ ...f, ...patch }))}
            onOpenGallery={() => setGalleryOpen(true)}
            onOpenMarkdown={() => setMdOpen(true)}
            onPickImage={pickImage}
          />
        </div>

        <p className="muted hint">
          {tool === "select"
            ? t("paint.hint.select")
            : tool === "text"
              ? t("paint.hint.text")
            : tool === "bucketFill"
              ? t("paint.hint.bucketFill")
            : tool === "areaFill"
              ? t("paint.hint.areaFill")
            : t("paint.hint.draw")}
        </p>
      </section>
      {infoOpen && <PaintInfoModal onClose={() => setInfoOpen(false)} />}
      {visible && pressureOpen && <CalibrationPressureDialog
        projectId={index.project?.id} profileId={index.project?.profileId}
        canMove={!!status?.online && !busy && !sending && !isPrinterBusy(status)}
        onClose={() => setPressureOpen(false)} onBusyChange={setCalibrating} onAction={onAction} />}
      {fullscreen && <Gcode3DOverlay data={fullscreen} viewState={gcode3dView} onViewChange={setGcode3dView} onClose={() => setFullscreen(null)} />}
      {coloringOpen && cal && renderProfile && (
        <ColoringEditor
          cal={cal}
          page={page}
          activeProfile={renderProfile}
          initialRotation={viewRotation}
          onClose={() => setColoringOpen(false)}
          onCreated={(jobs) => toast.success(t("paint.coloringJobsCreated", { count: jobs.length }))}
          onColoringChange={(coloring) => setPage((p) => (p ? { ...p, coloring } : p))}
        />
      )}
      {mdOpen && (
        <MarkdownEditor
          cal={cal}
          pageId={page.id}
          initialMarkdown={page.markdown ?? ""}
          onClose={() => setMdOpen(false)}
          onInsert={insertMarkdown}
        />
      )}
      {galleryOpen && renderProfile && (
        <GalleryPopup
          cal={cal}
          status={status}
          activeProfile={renderProfile}
          onClose={() => setGalleryOpen(false)}
          onInsert={ops.addObject}
          onPlotted={() => { reloadIndex(); onAction?.(); }}
        />
      )}
      {projectsOpen && <ProjectOverviewPopup
        activeId={index.project?.id}
        movePageId={movePageId}
        beforeChange={async () => { await flushEdits(page.id); if (movePageId && movePageId !== page.id) await flushEdits(movePageId); }}
        onRefresh={reloadIndex}
        onActivate={showProject}
        confirm={confirm}
        onClose={() => { setProjectsOpen(false); setMovePageId(null); }}
      />}
      {ConfirmNode}
      {PromptNode}
    </div>
  );
}
