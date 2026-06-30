import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Calibration, type GcodePreview3D, type Page, type PageIndex, type SceneObject } from "../api";
import PaintCanvas, { type Tool, type ViewRotation } from "./PaintCanvas";
import MarkdownEditor from "./MarkdownEditor";
import PagePanel from "./PagePanel";
import GalleryPopup from "./GalleryPopup";
import PlotScore from "./PlotScore";
import Gcode3DOverlay from "./Gcode3DOverlay";
import ColoringEditor from "./ColoringEditor";
import type { Gcode3DView } from "./Gcode3D";
import Segmented from "./Segmented";
import LiveButton from "../stream/LiveButton";
import { defaultSceneViewBox } from "../paint/SceneView";
import { useLiveRegistryState } from "../stream/liveRegistry";
import { useLiveStream } from "../stream/useLiveStream";
import { localize, type Pt, type Transform } from "../paint/geometry";
import { type TextFont } from "../paint/text";
import { objectStyle, randomTextSeed, textGeometryAsync } from "../paint/sceneObjects";
import { DEFAULT_VECTOR_STYLE } from "../paint/styling";
import { useObjectOps } from "../paint/useObjectOps";
import { type EraserBrush, ERASER_BRUSH_FACTOR } from "../paint/eraser";
import { useI18n } from "../i18n";
import { useToasts } from "./Toasts";
import { useConfirm, usePrompt } from "./dialogs";
import { PaintImageModal, type ImageMode } from "./paint/PaintImageModal";
import { PaintTextPanel } from "./paint/PaintTextPanel";
import { PaintStylePanel } from "./paint/PaintStylePanel";

const GRID_STEPS = [1, 5, 10, 25, 50];

export default function Paint({
  visible = true,
  status,
  onAction,
  desktop = false,
}: {
  visible?: boolean;
  status?: any;
  onAction?: () => void;
  desktop?: boolean;
}) {
  const { t } = useI18n();
  const toast = useToasts();
  const defaultText = t("paint.text");
  const [cal, setCal] = useState<Calibration | null>(null);
  const [index, setIndex] = useState<PageIndex | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [eraserBrush, setEraserBrush] = useState<EraserBrush>("small");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [fullscreen, setFullscreen] = useState<GcodePreview3D | null>(null);
  const [gcode3dView, setGcode3dView] = useState<Gcode3DView>({ yaw: -0.7, pitch: 1.0, zoom: 1, panX: 0, panY: 0 });
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null);
  const [imageImport, setImageImport] = useState<{ file: File; at: Pt; mode: ImageMode; detail: number } | null>(null);
  const [importingImage, setImportingImage] = useState(false);
  const [mdOpen, setMdOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [viewRotation, setViewRotation] = useState<ViewRotation>(0);
  const [sizeLinked, setSizeLinked] = useState(true);
  const [plotMenuOpen, setPlotMenuOpen] = useState(false);
  const [pagesCollapsed, setPagesCollapsed] = useState(() => {
    try { return localStorage.getItem("paint-pages-collapsed") === "1"; } catch { return false; }
  });
  const plotMenuRef = useRef<HTMLDivElement>(null);
  const [coloringOpen, setColoringOpen] = useState(false);
  const globalLive = useLiveRegistryState();
  const { confirm, ConfirmNode } = useConfirm();
  const { prompt, PromptNode } = usePrompt();
  const saveTimer = useRef<number | undefined>(undefined);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const fail = (e: any) => toast.error(String(e.message ?? e));
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
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      api.savePage(pageId, { objects }).then(reloadIndex).catch(fail);
    }, 500);
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

  const tools: { value: Tool; label: string; icon: string }[] = [
    { value: "select", label: t("paint.tool.select"), icon: "⬚" },
    { value: "pen", label: t("paint.tool.pen"), icon: "✎" },
    { value: "erase", label: t("paint.tool.erase"), icon: "⌫" },
    { value: "eraseLine", label: t("paint.tool.eraseLine"), icon: "✂" },
    { value: "line", label: t("paint.tool.line"), icon: "╱" },
    { value: "rect", label: t("paint.tool.rect"), icon: "▭" },
    { value: "maskRect", label: t("paint.tool.maskRect"), icon: "▰" },
    { value: "circle", label: t("paint.tool.circle"), icon: "◯" },
    { value: "semicircle", label: t("paint.tool.semicircle"), icon: "◗" },
    { value: "text", label: t("paint.tool.text"), icon: "T" },
    { value: "maskCircle", label: t("paint.tool.maskCircle"), icon: "●" },
  ];
  const selectTools = tools.filter((o) => o.value === "select");
  const drawTools = tools.filter((o) => ["pen", "line", "rect", "maskRect", "maskCircle", "circle", "semicircle", "text"].includes(o.value));
  const eraseTools = tools.filter((o) => o.value === "erase" || o.value === "eraseLine");

  useEffect(() => {
    api.getCalibration().then(setCal).catch(fail);
    api
      .listPages()
      .then((idx) => {
        setIndex(idx);
        const id = idx.activeId ?? idx.order[0]?.id;
        if (id) return api.getPage(id).then(autoAdoptStale).then(setPage);
      })
      .catch(fail);
  }, []);

  const reloadIndex = () => api.listPages().then(setIndex).catch(fail);

  const pageIdRef = useRef<string | null>(null);
  useEffect(() => {
    pageIdRef.current = page?.id ?? null;
  }, [page?.id]);
  useEffect(() => {
    if (!visible) return;
    api
      .listPages()
      .then((idx) => {
        setIndex(idx);
        const id = idx.activeId ?? idx.order[0]?.id;
        if (id && id !== pageIdRef.current) {
          ops.resetHistory();
          setSelectedIds([]);
          return api.getPage(id).then(autoAdoptStale).then(setPage);
        }
      })
      .catch(fail);
  }, [visible]);

  const calReqRef = useRef(0);
  useEffect(() => {
    if (!page) return;
    const token = ++calReqRef.current;
    const apply = (next: Calibration) => {
      if (calReqRef.current === token) setCal(next);
    };
    (page.profileId
      ? api.getProfile(page.profileId).then((p) => p.calibration)
      : api.getCalibration()
    )
      .then(apply)
      .catch(() => api.getCalibration().then(apply).catch(fail));
  }, [page?.profileId, page?.profileFingerprint]);

  useEffect(() => {
    if (live.state === "live") live.sendSnapshot("snapshot");
  }, [cal, page?.id, page?.name, page?.grid, page?.objects, viewRotation, fullscreen, gcode3dView, live.state]);

  useEffect(() => {
    if (visible || live.state !== "live") return;
    live.sendPlaceholder("designer-hidden");
  }, [visible, live.state]);

  useEffect(() => {
    if (live.error) toast.error(live.error);
  }, [live.error, toast]);

  useEffect(() => {
    if (!visible || !cal || !page) return;
    if (!globalLive.active || globalLive.sourceId === "designer") return;
    live.start();
  }, [visible, cal, page?.id, globalLive.active, globalLive.sourceId]);

  useEffect(() => {
    if (!plotMenuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!plotMenuRef.current?.contains(e.target as Node)) setPlotMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPlotMenuOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [plotMenuOpen]);

  const autoAdoptStale = (p: Page): Promise<Page> => {
    if (p.profileStatus !== "stale") return Promise.resolve(p);
    return api
      .adoptPageProfile(p.id, false)
      .then((updated) => { reloadIndex(); return updated; })
      .catch(() => p);
  };

  const reloadAll = (pageId?: string) =>
    Promise.all([
      api.getCalibration().then(setCal),
      api.listPages().then(setIndex),
      pageId ? api.getPage(pageId).then(setPage) : Promise.resolve(null),
    ]);

  const pageBlocked = !!page?.profileStatus && page.profileStatus !== "active";

  const activatePageProfile = () => {
    if (!page?.profileId) return;
    api.activateProfile(page.profileId).then(() => reloadAll(page.id)).catch(fail);
  };

  const adoptPageProfile = () => {
    if (!page) return;
    api
      .adoptPageProfile(page.id, false, index?.activeProfile)
      .then(() => reloadAll(page.id))
      .catch((e: any) => {
        const message = String(e.message ?? e);
        confirm(`${message}\n\n${t("paint.adoptForceConfirm")}`).then((ok) => {
          if (!ok) return;
          api
            .adoptPageProfile(page.id, true, index?.activeProfile)
            .then(() => reloadAll(page.id))
            .catch(fail);
        });
      });
  };

  const openPage = (id: string) => {
    if (id === page?.id) return;
    window.clearTimeout(saveTimer.current);
    ops.resetHistory();
    setSelectedIds([]);
    api
      .activatePage(id)
      .then(setIndex)
      .then(() => api.getPage(id))
      .then(autoAdoptStale)
      .then(setPage)
      .catch(fail);
  };

  const newPage = () =>
    api.createPage().then((p) => {
      ops.resetHistory();
      setPage(p);
      setSelectedIds([]);
      return reloadIndex();
    }).catch(fail);

  const duplicate = (id: string) =>
    api.duplicatePage(id).then((p) => {
      ops.resetHistory();
      setPage(p);
      setSelectedIds([]);
      return reloadIndex();
    }).catch(fail);

  const rename = async (id: string, current: string) => {
    const next = await prompt(t("paint.pageNamePrompt"), current);
    if (next == null) return;
    const name = next.trim();
    if (!name || name === current) return;
    api.savePage(id, { name }).then((p) => {
      if (p.id === page?.id) setPage(p);
      return reloadIndex();
    }).catch(fail);
  };

  const remove = async (id: string) => {
    if (!await confirm(t("paint.deletePageConfirm"))) return;
    api.deletePage(id).then((idx) => {
      setIndex(idx);
      const nextId = idx.activeId ?? idx.order[0]?.id;
      ops.resetHistory();
      setSelectedIds([]);
      if (nextId) return api.getPage(nextId).then(setPage);
      setPage(null);
    }).catch(fail);
  };

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
    if (!page) return Promise.reject(new Error(t("paint.noPage")));
    setBusy(true);
    return api.pageGcode(page.id, index?.activeProfile, objects)
      .then((job) => {
        toast.success(t("paint.jobCreated", { name: job.filename }));
        return job.filename;
      })
      .finally(() => setBusy(false));
  };

  const createGcode = () => {
    if (busy) return;
    generateJob().catch(fail);
  };

  const directPlot = () => {
    if (busy || sending) return;
    generateJob()
      .then((filename) => {
        setSending(true);
        return api.send(filename, true).then(() => toast.success(t("paint.jobStarted", { name: filename })));
      })
      .catch(fail)
      .finally(() => setSending(false));
  };

  const plotSelection = () => {
    if (!page || busy || sending || pageBlocked || selectedIds.length === 0) return;
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
      .catch(fail)
      .finally(() => setSending(false));
  };

  const openFullscreen = () => {
    if (!page || loadingPreview) return;
    setLoadingPreview(true);
    api.pagePreview3D(page.id, page.objects)
      .then(setFullscreen)
      .catch(fail)
      .finally(() => setLoadingPreview(false));
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

  const pickImage = (file: File | undefined) => {
    if (!file || !cal) return;
    setImageImport({ file, at: [cal.plot_width / 2, cal.plot_height / 2], mode: "edges", detail: 2 });
  };

  const importImage = () => {
    if (!page || !imageImport || importingImage) return;
    setImportingImage(true);
    api.galleryUpload(imageImport.file, "", { mode: imageImport.mode, detail: imageImport.detail })
      .then((item) => api.galleryPreview(item.id, 1).then((preview) => ({ item, preview })))
      .then(({ item, preview }) => {
        if (!preview.polylines.length) throw new Error(t("paint.noLinesImage"));
        const bounds = preview.bounds ?? [0, 0, preview.width, preview.height];
        const width = Math.max(bounds[2] - bounds[0], 1);
        const height = Math.max(bounds[3] - bounds[1], 1);
        const scale = Math.min(1, (cal!.plot_width * 0.6) / width, (cal!.plot_height * 0.6) / height);
        const { local } = localize(preview.polylines as Pt[][]);
        ops.addObject({
          id: crypto.randomUUID(),
          type: "image",
          data: {
            galleryId: item.id,
            galleryPage: 1,
            name: item.filename,
            mode: imageImport.mode,
            detail: imageImport.detail,
            width: preview.width,
            height: preview.height,
            basePolylines: local,
            style: DEFAULT_VECTOR_STYLE,
          },
          cachedPolylines: local,
          transform: {
            x: imageImport.at[0] + ((bounds[0] + bounds[2]) / 2 - bounds[0]) * scale,
            y: imageImport.at[1] + ((bounds[1] + bounds[3]) / 2 - bounds[1]) * scale,
            rotation: 0,
            scale,
          },
          plotted: false,
        });
        setImageImport(null);
        setTool("select");
      })
      .catch(fail)
      .finally(() => setImportingImage(false));
  };

  const insertMarkdown = (objs: SceneObject[], markdown: string) => {
    if (!page) return;
    ops.addObjects(objs);
    setPage((p) => (p ? { ...p, markdown } : p));
    api.savePage(page.id, { markdown }).then(reloadIndex).catch(fail);
    setMdOpen(false);
    setTool("select");
  };

  // Keyboard shortcuts — only active when this tab is visible.
  useEffect(() => {
    if (!visible || coloringOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setMenu(null);
        if (tool !== "select") { setTool("select"); return; }
        if (selectedIds.length > 0) setSelectedIds([]);
        return;
      }
      if (tool === "text" && selectedIds.length === 1 && !(e.ctrlKey || e.metaKey || e.altKey)) {
        if (e.key === "Backspace") {
          if (ops.editSelectedText((text) => text.slice(0, -1))) e.preventDefault();
          return;
        }
        if (e.key === "Enter") {
          if (ops.editSelectedText((text) => `${text}\n`)) e.preventDefault();
          return;
        }
        if (e.key.length === 1) {
          if (ops.editSelectedText((text) => text === defaultText ? e.key : text + e.key)) e.preventDefault();
          return;
        }
      }
      const arrow: Record<string, [number, number]> = {
        ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      };
      if (arrow[e.key] && selectedIds.length > 0 && !(e.ctrlKey || e.metaKey || e.altKey)) {
        e.preventDefault();
        if (!e.repeat) ops.remember();
        const step = page?.grid.step || 1;
        const [sx, sy] = arrow[e.key];
        ops.nudgeSelected(sx * step, sy * step);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.length > 0) {
        e.preventDefault();
        ops.deleteSelected();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") { e.preventDefault(); ops.copySelected(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") { e.preventDefault(); ops.cutSelected(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") { e.preventDefault(); ops.pasteObjects(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") { e.preventDefault(); ops.duplicateSelected(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) ops.redo(); else ops.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); ops.redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!cal || !index || !page) return <div className="card">{t("paint.loading")}</div>;

  const selectedObjects = page.objects.filter((o) => selectedIds.includes(o.id));
  const hasSelection = selectedObjects.length > 0;
  const selectedText = selectedObjects.length === 1 && selectedObjects[0].type === "text"
    ? selectedObjects[0]
    : null;
  const selectedObjectSize = selectedObjects.length === 1 ? ops.objectLocalSize(selectedObjects[0]) : null;
  const selectedObjectRotation = selectedObjects.length === 1
    ? (() => {
        const raw = ((selectedObjects[0].transform?.rotation ?? 0) * 180) / Math.PI;
        const normalized = ((raw % 360) + 360) % 360;
        return normalized === 0 && raw > 0.0001 ? 360 : normalized;
      })()
    : null;
  const selectedStyle = selectedObjects.length > 0 ? objectStyle(selectedObjects[0]) : DEFAULT_VECTOR_STYLE;
  const canUngroupMenu = !!menu && page.objects.some((obj) => menu.ids.includes(obj.id) && obj.groupId);
  const menuMaskId = menu?.ids.length === 1
    ? page?.objects.find((o) => o.id === menu.ids[0] && (o.type === "mask" || o.data?.mask === "erase"))?.id ?? null
    : null;

  const togglePagesCollapsed = () => {
    setPagesCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem("paint-pages-collapsed", next ? "1" : "0"); } catch {}
      return next;
    });
  };

  return (
    <div className={`paint${pagesCollapsed ? " pages-collapsed" : ""}`}>
      {menu && (
        <div className="paint-context-menu" style={{ left: menu.x, top: menu.y }} onContextMenu={(e) => e.preventDefault()}>
          {menuMaskId && (
            <button onClick={() => { ops.applyMaskStamp(menuMaskId); setMenu(null); }}>{t("paint.applyMask")}</button>
          )}
          <button disabled={menu.ids.length < 2} onClick={() => { ops.groupSelected(menu.ids); setMenu(null); }}>{t("paint.group")}</button>
          <button disabled={!canUngroupMenu} onClick={() => { ops.ungroupSelected(menu.ids); setMenu(null); }}>{t("paint.ungroup")}</button>
        </div>
      )}
      {imageImport && (
        <PaintImageModal
          file={imageImport.file}
          mode={imageImport.mode}
          detail={imageImport.detail}
          importing={importingImage}
          continuous={page.continuous !== false}
          onModeChange={(m) => setImageImport({ ...imageImport, mode: m })}
          onDetailChange={(d) => setImageImport({ ...imageImport, detail: d })}
          onContinuousChange={setContinuous}
          onCancel={() => setImageImport(null)}
          onImport={importImage}
        />
      )}
      <PagePanel
        index={index}
        activePageId={page.id}
        activeProfileId={index.activeProfile?.id}
        activeProfileName={index.activeProfile?.name}
        onOpen={openPage}
        onNew={newPage}
        onRename={rename}
        onDuplicate={duplicate}
        onRemove={remove}
        onReorder={(ids) => api.reorderPages(ids).then(setIndex).catch(fail)}
        sidebarCollapsed={pagesCollapsed}
        onToggleSidebar={togglePagesCollapsed}
      />

      <section className="card paint-editor">
        <div className="paint-toolbar">
          <h2>{page.name}</h2>
          <div className="paint-grid-ctl">
            <span className="muted">{t("paint.grid")}</span>
            <Segmented
              value={page.grid.step}
              onChange={(step) => setGrid({ step })}
              options={GRID_STEPS.map((s) => ({ value: s, label: String(s) }))}
              suffix={<em className="muted">mm</em>}
            />
            <label className="switch-label">
              <span className="muted">{t("paint.snap")}</span>
              <button className={`switch ${page.grid.snap ? "on" : ""}`}
                onClick={() => setGrid({ snap: !page.grid.snap })} aria-pressed={page.grid.snap}>
                <i />
              </button>
            </label>
            <label className="switch-label" title={t("paint.continuousHint")}>
              <span className="muted">{t("paint.slice")}</span>
              <Segmented<string>
                value={page.continuous !== false ? "continuous" : "faithful"}
                onChange={(v) => setContinuous(v === "continuous")}
                options={[
                  { value: "continuous", label: t("slice.continuous") },
                  { value: "faithful", label: t("slice.faithful") },
                ]}
              />
            </label>
            <div className="paint-job-actions">
              {!desktop && (
                <LiveButton
                  state={live.state}
                  viewers={live.viewers}
                  onClick={() => live.state === "live" || live.state === "connecting" ? live.stop("user-stopped") : live.start()}
                />
              )}
              <button
                className="primary"
                disabled={busy || sending || pageBlocked}
                title={pageBlocked ? t("paint.gcodeBlocked") : ""}
                onClick={createGcode}
              >
                {busy ? t("paint.generating") : t("paint.generateGcode")}
              </button>
              <div className="split-button" ref={plotMenuRef}>
                <button
                  className="primary split-main"
                  disabled={busy || sending || pageBlocked}
                  title={pageBlocked ? t("paint.gcodeBlocked") : ""}
                  onClick={directPlot}
                >
                  {busy ? t("paint.generating") : sending ? t("paint.starting") : t("paint.directPlot")}
                </button>
                <button
                  className="primary split-toggle"
                  disabled={busy || sending || pageBlocked}
                  aria-haspopup="menu"
                  aria-expanded={plotMenuOpen}
                  aria-label={t("paint.plotSelection")}
                  onClick={() => setPlotMenuOpen((v) => !v)}
                >
                  ▾
                </button>
                {plotMenuOpen && (
                  <div className="split-menu" role="menu">
                    <button
                      role="menuitem"
                      disabled={busy || sending || pageBlocked || !hasSelection}
                      title={!hasSelection ? t("paint.noSelection") : pageBlocked ? t("paint.gcodeBlocked") : t("paint.plotSelectionHint")}
                      onClick={() => { setPlotMenuOpen(false); plotSelection(); }}
                    >
                      {t("paint.plotSelection")}
                    </button>
                    <button
                      role="menuitem"
                      disabled={busy || sending || pageBlocked || page.objects.length === 0}
                      title={page.objects.length === 0 ? t("paint.emptyHint") : pageBlocked ? t("paint.gcodeBlocked") : t("paint.coloringHint")}
                      onClick={() => { setPlotMenuOpen(false); setColoringOpen(true); }}
                    >
                      {t("paint.coloring")}
                    </button>
                  </div>
                )}
              </div>
              <button disabled={loadingPreview} onClick={openFullscreen}>
                {loadingPreview ? t("common.loading") : t("convert.fullscreen")}
              </button>
            </div>
          </div>
        </div>

        {pageBlocked && (
          <div className="banner warn profile-banner">
            <span>
              {page.profileStatus === "other"
                ? t("paint.pageOtherProfile", { name: page.profileName ?? "?" })
                : page.profileStatus === "stale"
                  ? t("paint.pageStale")
                  : page.profileStatus === "archived"
                    ? t("paint.pageArchivedProfile", { name: page.profileName ?? "?" })
                    : page.profileId
                      ? t("paint.pageMissingProfile", { name: page.profileName ?? "?" })
                      : t("paint.pageNoProfileHint")}
            </span>
            {page.profileStatus === "other" && page.profileId && (
              <button onClick={activatePageProfile}>
                {t("paint.activateProfile", { name: page.profileName ?? "?" })}
              </button>
            )}
            <button onClick={adoptPageProfile}>{t("paint.adoptProfile")}</button>
          </div>
        )}

        <div className="paint-workspace">
          <div className="paint-canvas-wrap">
            <PlotScore pageId={page.id} objects={page.objects} />
            {page.objects.length === 0 && (
              <div className="paint-empty-hint">
                <strong>{t("paint.emptyHint")}</strong>
                <button className="ghost" onClick={() => setGalleryOpen(true)}>▦ {t("gallery.button")}</button>
              </div>
            )}
            <PaintCanvas
              cal={cal}
              page={page}
              tool={tool}
              selectedIds={selectedIds}
              onSelect={selectIds}
              onAdd={ops.addObject}
              onUpdate={updateObject}
              onUpdateMany={updateObjects}
              onEditStart={ops.remember}
              onContextMenuSelection={(ids, x, y) => { setSelectedIds(ids); setMenu({ ids, x, y }); }}
              onImageDrop={(file, at) => setImageImport({ file, at, mode: "edges", detail: 2 })}
              onTextAdd={addTextObject}
              onErase={ops.eraseAcrossObjects}
              eraserRadius={eraserRadius}
              eraserIsPoint={eraserBrush === "point"}
              onCursorMove={live.state === "live" ? live.sendCursor : undefined}
              onCursorClick={live.state === "live" ? live.sendClick : undefined}
              viewRotation={viewRotation}
              onViewRotationChange={setViewRotation}
            />
          </div>

          <aside className="paint-tools-card">
            <div className="paint-tool-section">
              <h4>{t("paint.section.arrange")}</h4>
              <Segmented<Tool>
                value={tool}
                onChange={(t) => { setTool(t); if (t !== "select") setSelectedIds([]); }}
                options={selectTools.map((o) => ({ value: o.value, label: o.icon, title: o.label }))}
                className="paint-tool-grid single"
              />
              <div className="paint-tools-actions compact">
                <button className="ghost" disabled={!hasSelection} onClick={ops.fitSelected}
                  title={hasSelection ? t("paint.fitSelection") : t("paint.noSelection")} aria-label={t("paint.fit")}>
                  ⛶
                </button>
                <button className="ghost" disabled={!hasSelection} onClick={ops.centerSelected}
                  title={hasSelection ? t("paint.centerSelection") : t("paint.noSelection")} aria-label={t("paint.center")}>
                  ⌖
                </button>
                <button className="ghost" disabled={!hasSelection} onClick={() => ops.moveSelected(-1)}
                  title={hasSelection ? t("paint.moveBack") : t("paint.noSelection")} aria-label={t("paint.toBack")}>
                  ⤓
                </button>
                <button className="ghost" disabled={!hasSelection} onClick={() => ops.moveSelected(1)}
                  title={hasSelection ? t("paint.moveFront") : t("paint.noSelection")} aria-label={t("paint.toFront")}>
                  ⤒
                </button>
              </div>
            </div>

            <div className="paint-tool-section">
              <h4>{t("paint.section.create")}</h4>
              <Segmented<Tool>
                value={tool}
                onChange={(t) => { setTool(t); if (t !== "select") setSelectedIds([]); }}
                options={drawTools.map((o) => ({ value: o.value, label: o.icon, title: o.label }))}
                className="paint-tool-grid"
              />
            </div>

            <div className="paint-tool-section">
              <h4>{t("paint.section.erase")}</h4>
              <Segmented<Tool>
                value={tool}
                onChange={(t) => { setTool(t); if (t !== "select") setSelectedIds([]); }}
                options={eraseTools.map((o) => ({ value: o.value, label: o.icon, title: o.label }))}
                className="paint-tool-grid erase"
              />
              {(tool === "erase" || tool === "eraseLine") && (
                <>
                  <Segmented<EraserBrush>
                    value={eraserBrush}
                    onChange={setEraserBrush}
                    options={[
                      { value: "point", label: t("paint.coloringBrushPoint"), title: t("paint.coloringBrushPoint") },
                      { value: "small",  label: t("paint.coloringBrushSmall"),  title: t("paint.coloringBrushSize") },
                      { value: "medium", label: t("paint.coloringBrushMedium"), title: t("paint.coloringBrushSize") },
                      { value: "large",  label: t("paint.coloringBrushLarge"),  title: t("paint.coloringBrushSize") },
                    ]}
                    className="paint-tool-grid"
                  />
                  {eraserBrush !== "point" && (
                    <div className="coloring-brush-hint">⌀ {Math.round(eraserRadius * 2)} mm</div>
                  )}
                </>
              )}
              <div className="paint-tools-actions compact">
                <button className="ghost" disabled={!hasSelection} onClick={ops.deleteSelected}
                  title={hasSelection ? t("paint.deleteSelection") : t("paint.noSelection")} aria-label={t("paint.delete")}>
                  🗑{selectedObjects.length > 1 ? <span className="act-count">{selectedObjects.length}</span> : ""}
                </button>
                <button className="ghost" disabled={!hasSelection} onClick={ops.convertSelectedToLines}
                  title={hasSelection ? t("paint.convertToLines") : t("paint.noSelection")} aria-label={t("paint.convertToLines")}>
                  ⇄
                </button>
              </div>
            </div>

            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = ""; }}
            />
            <div className="paint-tool-section">
              <h4>{t("paint.section.clipboard")}</h4>
              <div className="paint-tools-actions">
                <button className="ghost" disabled={ops.history.undo === 0} onClick={ops.undo}
                  title={t("paint.undo")} aria-label={t("paint.undo")}>
                  ↶
                </button>
                <button className="ghost" disabled={ops.history.redo === 0} onClick={ops.redo}
                  title={t("paint.redo")} aria-label={t("paint.redo")}>
                  ↷
                </button>
                <button className="ghost" disabled={!hasSelection} onClick={ops.copySelected}
                  title={hasSelection ? t("paint.copySelection") : t("paint.noSelection")} aria-label={t("paint.copy")}>
                  ⧉
                </button>
                <button className="ghost" disabled={!hasSelection} onClick={ops.cutSelected}
                  title={hasSelection ? t("paint.cutSelection") : t("paint.noSelection")} aria-label={t("paint.cut")}>
                  ✂
                </button>
                <button className="ghost" disabled={ops.clipboardCount === 0} onClick={() => ops.pasteObjects()}
                  title={ops.clipboardCount > 0 ? t("paint.pasteSelection") : t("paint.clipboardEmpty")} aria-label={t("paint.paste")}>
                  ⎘{ops.clipboardCount > 1 ? <span className="act-count">{ops.clipboardCount}</span> : ""}
                </button>
                <button className="ghost" disabled={!hasSelection} onClick={ops.duplicateSelected}
                  title={hasSelection ? t("paint.duplicateSelection") : t("paint.noSelection")} aria-label={t("paint.duplicate")}>
                  ⧉
                </button>
                <button className="ghost" disabled={selectedObjects.length < 2} onClick={() => ops.groupSelected()}
                  title={selectedObjects.length >= 2 ? t("paint.groupSelection") : t("paint.needTwoObjects")} aria-label={t("paint.group")}>
                  ⊞
                </button>
                <button className="ghost" disabled={!selectedObjects.some((obj) => obj.groupId)} onClick={() => ops.ungroupSelected()}
                  title={selectedObjects.some((obj) => obj.groupId) ? t("paint.ungroupSelection") : t("paint.noGroupSelected")} aria-label={t("paint.ungroup")}>
                  ⊟
                </button>
              </div>
              <div className="paint-asset-row">
                <button className="ghost" title={t("gallery.button")} aria-label={t("gallery.button")}
                  onClick={() => setGalleryOpen(true)}>▦</button>
                <button className="ghost" title={t("paint.imageImport")} aria-label={t("paint.imageImport")}
                  onClick={() => imageInputRef.current?.click()}>🖼</button>
                <button className="ghost" title={t("paint.md.button")} aria-label={t("paint.md.button")}
                  onClick={() => setMdOpen(true)}>⌶</button>
              </div>
            </div>

            <PaintStylePanel
              hasSelection={hasSelection}
              selectedObjectSize={selectedObjectSize}
              selectedObjectRotation={selectedObjectRotation}
              selectedStyle={selectedStyle}
              sizeLinked={sizeLinked}
              onSizeLinkedToggle={() => setSizeLinked((v) => !v)}
              onWidthChange={(v) => ops.setSelectedObjectSize("width", v)}
              onHeightChange={(v) => ops.setSelectedObjectSize("height", v)}
              onRotationChange={ops.setSelectedObjectRotation}
              onStyleChange={ops.updateSelectedStyle}
            />
          </aside>
        </div>

        {selectedText && (
          <PaintTextPanel
            selectedText={selectedText}
            draftText={ops.draftText}
            defaultText={defaultText}
            onTextInput={ops.onTextInput}
            onFontOrSizeChange={ops.onFontOrSizeChange}
          />
        )}

        <p className="muted hint">
          {tool === "select"
            ? t("paint.hint.select")
            : tool === "text"
              ? t("paint.hint.text")
            : t("paint.hint.draw")}
        </p>
      </section>
      {fullscreen && <Gcode3DOverlay data={fullscreen} viewState={gcode3dView} onViewChange={setGcode3dView} onClose={() => setFullscreen(null)} />}
      {coloringOpen && cal && (
        <ColoringEditor
          cal={cal}
          page={page}
          activeProfile={index?.activeProfile}
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
      {galleryOpen && (
        <GalleryPopup
          cal={cal}
          status={status}
          activeProfile={index?.activeProfile}
          onClose={() => setGalleryOpen(false)}
          onInsert={ops.addObject}
          onPlotted={() => { reloadIndex(); onAction?.(); }}
        />
      )}
      {ConfirmNode}
      {PromptNode}
    </div>
  );
}
