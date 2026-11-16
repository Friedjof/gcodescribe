import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Page, type SceneObject } from "../../api";
import { startImport } from "../../api/assetTasks";
import { errorMessage, isAbortError } from "../../api/errors";
import { discardEdits, flushEdits, queueObjects, rememberPage } from "../../api/pageEdits";
import type { PrinterStatus } from "../../api/types/printer";
import type { PaintWorkspaceCommand } from "../../interface/commands";
import PanelResizeHandle from "../../components/editor/PanelResizeHandle";
import { useInterface } from "../../interface/InterfaceProvider";
import PaintEmptyState from "./components/PaintEmptyState";
import PaintDocumentStatus from "./components/PaintDocumentStatus";
import PaintCommandBar from "./components/PaintCommandBar";
import PaintLayoutControls from "./components/PaintLayoutControls";
import DelayedLoading from "../../components/DelayedLoading";
import type { Gcode3DView } from "../../components/Gcode3D";
import Gcode3DOverlay from "../../components/Gcode3DOverlay";
import { useToasts } from "../../components/Toasts";
import { useConfirm, usePrompt } from "../../components/dialogs";
import { useLatestCallbacks } from "../../hooks/useLatestCallbacks";
import { useLiveSource } from "../../hooks/useLiveSource";
import { useI18n } from "../../i18n";
import { isPrinterBusy } from "../../lib/printerState";
import { useProjectCalibration } from "../../state/ProjectCalibrationContext";
import ColoringEditor from "../coloring/ColoringEditor";
import CalibrationPressureDialog from "../control/CalibrationPressureDialog";
import GalleryPopup from "../gallery/GalleryPopup";
import MarkdownEditor from "../markdown/MarkdownEditor";
import { useLiveStream } from "../stream/hooks/useLiveStream";
import { useLiveRegistryState } from "../stream/lib/liveRegistry";
import PaintCanvas, { type Tool, type ViewRotation } from "./PaintCanvas";
import ProjectOverviewPopup from "./ProjectOverviewPopup";
import ProjectPagePanel from "./ProjectPagePanel";
import PaintPrecisionBar from "./components/PaintPrecisionBar";
import PaintContextPanel from "./components/PaintContextPanel";
import { PaintImageModal, type ImageMode } from "./components/PaintImageModal";
import PaintInfoModal from "./components/PaintInfoModal";
import PaintObjectMenu from "./components/PaintObjectMenu";
import PaintToolRail, { paintTools } from "./components/PaintToolRail";
import PaintToolbar from "./components/PaintToolbar";
import { defaultSceneViewBox } from "./components/SceneView";
import { useObjectOps } from "./hooks/useObjectOps";
import { usePaintCanvasActions } from "./hooks/usePaintCanvasActions";
import { usePaintDocument } from "./hooks/usePaintDocument";
import { usePaintJobs } from "./hooks/usePaintJobs";
import { usePaintPages } from "./hooks/usePaintPages";
import { usePaintShortcuts } from "./hooks/usePaintShortcuts";
import { ERASER_BRUSH_FACTOR, type EraserBrush } from "./lib/eraser";
import { type Pt } from "./lib/geometry";
import { objectStyle } from "./lib/sceneObjects";
import { DEFAULT_VECTOR_STYLE, type FillStyle } from "./lib/styling";

export default function Paint({
  visible = true,
  command,
  onCommandHandled,
  status,
  onAction,
  desktop = false,
}: {
  visible?: boolean;
  command?: PaintWorkspaceCommand | null;
  onCommandHandled?: () => void;
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
  const [pressureOpen, setPressureOpen] = useState(false);
  useEffect(() => { setPressureOpen(false); }, [index?.project?.id, index?.project?.profileId]);
  const [gcode3dView, setGcode3dView] = useState<Gcode3DView>({ yaw: -0.7, pitch: 1.0, zoom: 1, panX: 0, panY: 0 });
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null);
  const [imageImport, setImageImport] = useState<{ file: File; at: Pt; mode: ImageMode; detail: number;
    pageId: string; projectId: string; profileId: string; fingerprint: string } | null>(null);
  const [mdOpen, setMdOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [movePageId, setMovePageId] = useState<string | null>(null);
  const [viewRotation, setViewRotation] = useState<ViewRotation>(0);
  const [measurementsOpen, setMeasurementsOpen] = useState(() => {
    try { return localStorage.getItem("paint-precision-open") === "1"; } catch { return false; }
  });
  const toggleMeasurements = () => setMeasurementsOpen(current => {
    try { localStorage.setItem("paint-precision-open", current ? "0" : "1"); } catch { /* Keep working without storage. */ }
    return !current;
  });
  const [sizeLinked, setSizeLinked] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);
  const { preferences, update: updateInterface } = useInterface();
  const pagesCollapsed = !preferences.pagesPanel.open;
  const [pagesWidth, setPagesWidth] = useState(preferences.pagesPanel.width);
  const [propertiesWidth, setPropertiesWidth] = useState(preferences.propertiesPanel.width);
  useEffect(() => setPagesWidth(preferences.pagesPanel.width), [preferences.pagesPanel.width]);
  useEffect(() => setPropertiesWidth(preferences.propertiesPanel.width), [preferences.propertiesPanel.width]);
  const [coloringOpen, setColoringOpen] = useState(false);
  const globalLive = useLiveRegistryState();
  const { confirm, ConfirmNode } = useConfirm();
  const { prompt, PromptNode } = usePrompt();

  const fail = (e: unknown) => { if (!isAbortError(e)) toast.error(errorMessage(e)); };
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

  const { saveState, reloadIndex, showProject, prepareProjectChange, navigation } = usePaintDocument({ page, setPage, index, setIndex,
    projectMatches, visible, agentRevision, ops, setSelectedIds, fail });

  const { busy, sending, calibrating, setCalibrating, fullscreen, setFullscreen, loadingPreview, plotError,
    setPlotError, createGcode, directPlot, plotSelection, moveToCalibration, openFullscreen } = usePaintJobs({
      page, profile: renderProfile, projectId: index?.project?.id, visible, status,
      printerBusy: isPrinterBusy(status), ops, selectedIds, setSelectedIds, onAction, refresh, fail,
    });
  const printerBusy = calibrating || isPrinterBusy(status);

  const pageBlocked = !renderProfile;
  const { handleBucketFill, handleAreaFill, fitDrawing, updateObject, updateObjects, addTextObject } = usePaintCanvasActions({
    page, cal, pageBlocked, fillStyle, ops, setPage, persist, setPlotError, defaultText, warnMissingGlyphs, fail,
  });

  const insertText = (at: Pt) => {
    updateInterface(p => ({ ...p, propertiesPanel: { ...p.propertiesPanel, open: true } }));
    addTextObject(at);
  };

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

  const selectTool = (v: Tool) => {
    setTool(v);
    if (v !== "select") setSelectedIds([]);
  };

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


  const pages = usePaintPages({
    page,
    setPage,
    setIndex,
    setSelectedIds,
    ops,
    reloadIndex,
    navigation,
    confirm,
    prompt,
    fail,
  });

  const handledCommand = useRef<number | null>(null);
  useEffect(() => {
    if (!visible || !page || !renderProfile || !command || handledCommand.current === command.id) return;
    handledCommand.current = command.id;
    if (command.type === "projects") setProjectsOpen(true);
    else void pages.newPage();
    onCommandHandled?.();
  }, [visible, page?.id, renderProfile?.id, command?.id]);

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

  const selectIds = (ids: string[]) => {
    setSelectedIds(ids);
    setMenu(null);
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
    onTextAdd: insertText, onBucketFill: handleBucketFill, onAreaFill: handleAreaFill, onErase: ops.eraseAcrossObjects,
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
  const selectedStyle = ops.pendingStyle ?? (selectedObjects.length > 0 ? objectStyle(selectedObjects[0]) : DEFAULT_VECTOR_STYLE);

  const togglePagesCollapsed = () => updateInterface(p => ({ ...p, pagesPanel: { ...p.pagesPanel, open: !p.pagesPanel.open } }));

  return (
    <div className={`paint${pagesCollapsed ? " pages-collapsed" : ""}${!preferences.propertiesPanel.open ? " properties-collapsed" : ""}`}
      style={{ "--pages-width": `${pagesWidth}px`, "--properties-width": `${propertiesWidth}px` } as React.CSSProperties}>
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

      {!pagesCollapsed && <PanelResizeHandle label={t("interface.resizePages")} width={pagesWidth} min={180} max={400}
        onChange={setPagesWidth} onCommit={width => updateInterface(p => ({ ...p, pagesPanel: { ...p.pagesPanel, width } }))} />}
      <section className="card paint-editor">
        <PaintToolbar
          commands={<PaintCommandBar ops={ops} selected={selectedObjects} visible={visible}
            onText={() => { insertText([cal.plot_width / 2, cal.plot_height / 2]); setTool("select"); }}
            onGallery={() => setGalleryOpen(true)} onMarkdown={() => setMdOpen(true)} onImage={pickImage} />}
          viewControls={<PaintLayoutControls visible={visible} measurementsOpen={measurementsOpen} onToggleMeasurements={toggleMeasurements} />}
          guided={preferences.experience === "guided"}
          visible={visible}
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

        {measurementsOpen && <PaintPrecisionBar open showToggle={false} key={page.id} objects={selectedObjects} ops={ops} sizeLinked={sizeLinked}
          onSizeLinkedToggle={() => setSizeLinked(value => !value)} disabled={pageBlocked || ops.processing} />}

        <div className="paint-workspace">
          <PaintToolRail tool={tool} onToolChange={selectTool} guided={preferences.experience === "guided"} visible={visible} />
          <div className="paint-canvas-wrap">
            {page.objects.length === 0 && tool === "select" && <PaintEmptyState
              onText={() => { insertText([cal.plot_width / 2, cal.plot_height / 2]); setTool("select"); }}
              onDraw={() => selectTool("pen")} onImage={pickImage} />}
            <PaintCanvas
              statusContent={<PaintDocumentStatus page={page} profile={renderProfile} pending={saveState.pending} error={saveState.error} selection={selectedIds.length} />}
              visible={visible}
              gridVisible={preferences.canvas.gridVisible}
              showRulers={preferences.canvas.rulers}
              padding={preferences.canvas.padding}
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

          {preferences.propertiesPanel.open && <>
          <PanelResizeHandle label={t("interface.resizeProperties")} width={propertiesWidth} min={240} max={400} direction={-1}
            onChange={setPropertiesWidth} onCommit={width => updateInterface(p => ({ ...p, propertiesPanel: { ...p.propertiesPanel, width } }))} />
          <PaintContextPanel key={page.id}
            tool={tool}
            activeToolLabel={activeToolMeta ? activeToolMeta.label : ""}
            ops={ops}
            hasSelection={hasSelection}
            selectedObjects={selectedObjects}
            selectedStyle={selectedStyle}
            pressureMaxDepth={cal.pen_pressure_max_depth ?? 0}
            selectedText={selectedText}
            defaultText={defaultText}
            eraserBrush={eraserBrush}
            onEraserBrushChange={setEraserBrush}
            eraserRadius={eraserRadius}
            fillStyle={fillStyle}
            onFillStyleChange={(patch) => setFillStyle((f) => ({ ...f, ...patch }))}
          />
          </>}
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
        beforeChange={() => prepareProjectChange(movePageId)}
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
