import { useEffect, useRef, useState } from "react";
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
import { IDENTITY, bounds, localize, objectWorldBounds, transformPolylines, type Pt, type Transform } from "../paint/geometry";
import { TEXT_FONTS, type TextFont } from "../paint/text";
import {
  basePolylines,
  cloneObjects,
  objectStyle,
  textGeometryAsync,
  withStyledCache,
  zValue,
} from "../paint/sceneObjects";
import { DEFAULT_VECTOR_STYLE, buildStyledPolylines, normalizeStyle, type FillMode, type StrokeMode, type VectorStyle } from "../paint/styling";
import { useI18n } from "../i18n";
import { useToasts } from "./Toasts";
import { useConfirm, usePrompt } from "./dialogs";

const GRID_STEPS = [1, 5, 10, 25, 50];

type ImageMode = "edges" | "hatch" | "lines" | "dots" | "handwriting";

function pointSegmentDistance(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

function segmentsDistance(a0: Pt, a1: Pt, b0: Pt, b1: Pt) {
  const cross = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const intersects =
    Math.sign(cross(a0, a1, b0)) !== Math.sign(cross(a0, a1, b1)) &&
    Math.sign(cross(b0, b1, a0)) !== Math.sign(cross(b0, b1, a1));
  if (intersects) return 0;
  return Math.min(
    pointSegmentDistance(a0, b0, b1),
    pointSegmentDistance(a1, b0, b1),
    pointSegmentDistance(b0, a0, a1),
    pointSegmentDistance(b1, a0, a1)
  );
}

function lineNearPath(line: Pt[], path: Pt[], radius: number) {
  for (let i = 1; i < line.length; i++) {
    for (let j = 1; j < path.length; j++) {
      if (segmentsDistance(line[i - 1], line[i], path[j - 1], path[j]) <= radius) return true;
    }
  }
  return false;
}

function segmentNearPath(a: Pt, b: Pt, path: Pt[], radius: number) {
  for (let i = 1; i < path.length; i++) {
    if (segmentsDistance(a, b, path[i - 1], path[i]) <= radius) return true;
  }
  return false;
}

function eraseLinePieces(line: Pt[], path: Pt[], radius: number) {
  const out: Pt[][] = [];
  let current: Pt[] = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    if (segmentNearPath(a, b, path, radius)) {
      if (current.length >= 2) out.push(current);
      current = [b];
    } else {
      current.push(b);
    }
  }
  if (current.length >= 2) out.push(current);
  return out;
}

function eraseWorldPolylines(lines: Pt[][], path: Pt[], mode: "free" | "line", radius: number) {
  if (mode === "line") return lines.filter((line) => !lineNearPath(line, path, radius));
  return lines.flatMap((line) => eraseLinePieces(line, path, radius));
}

function samePolylines(a: Pt[][], b: Pt[][]) {
  return a.length === b.length && a.every((line, i) =>
    line.length === b[i].length && line.every((pt, j) => pt[0] === b[i][j][0] && pt[1] === b[i][j][1])
  );
}

export default function Paint({
  visible = true,
  status,
  onAction,
}: {
  visible?: boolean;
  status?: any;
  onAction?: () => void;
}) {
  const { t } = useI18n();
  const toast = useToasts();
  const defaultText = t("paint.text");
  const [cal, setCal] = useState<Calibration | null>(null);
  const [index, setIndex] = useState<PageIndex | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [tool, setTool] = useState<Tool>("select");
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
  const [clipboardCount, setClipboardCount] = useState(0);
  const [plotMenuOpen, setPlotMenuOpen] = useState(false);
  const plotMenuRef = useRef<HTMLDivElement>(null);
  const [coloringOpen, setColoringOpen] = useState(false);
  const globalLive = useLiveRegistryState();
  const { confirm, ConfirmNode } = useConfirm();
  const { prompt, PromptNode } = usePrompt();
  const saveTimer = useRef<number | undefined>(undefined);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const undoStack = useRef<SceneObject[][]>([]);
  const redoStack = useRef<SceneObject[][]>([]);
  const clipboard = useRef<SceneObject[]>([]);
  // The undo/redo stacks live in refs (mutating them must not re-render mid
  // edit); this state mirrors their depth so the toolbar buttons can enable
  // and disable in step with them.
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const syncHistory = () =>
    setHistory({ undo: undoStack.current.length, redo: redoStack.current.length });
  const resetHistory = () => {
    undoStack.current = [];
    redoStack.current = [];
    syncHistory();
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

  // Icon + name: the toolbar shows the glyph, the name lives in the tooltip.
  const tools: { value: Tool; label: string; icon: string }[] = [
    { value: "select", label: t("paint.tool.select"), icon: "⬚" },
    { value: "pen", label: t("paint.tool.pen"), icon: "✎" },
    { value: "erase", label: t("paint.tool.erase"), icon: "⌫" },
    { value: "eraseLine", label: t("paint.tool.eraseLine"), icon: "✂" },
    { value: "line", label: t("paint.tool.line"), icon: "╱" },
    { value: "rect", label: t("paint.tool.rect"), icon: "▭" },
    { value: "maskRect", label: t("paint.tool.maskRect"), icon: "▰" },
    { value: "maskCircle", label: t("paint.tool.maskCircle"), icon: "●" },
    { value: "circle", label: t("paint.tool.circle"), icon: "◯" },
    { value: "semicircle", label: t("paint.tool.semicircle"), icon: "◗" },
    { value: "text", label: t("paint.tool.text"), icon: "T" },
  ];
  const selectTools = tools.filter((o) => o.value === "select");
  const drawTools = tools.filter((o) => ["pen", "line", "rect", "maskRect", "maskCircle", "circle", "semicircle", "text"].includes(o.value));
  const eraseTools = tools.filter((o) => o.value === "erase" || o.value === "eraseLine");
  const imageModes: { value: ImageMode; label: string; description: string }[] = [
    { value: "handwriting", label: t("paint.image.handwriting"), description: t("paint.image.handwritingDesc") },
    { value: "edges", label: t("paint.image.edges"), description: t("paint.image.edgesDesc") },
    { value: "hatch", label: t("paint.image.hatch"), description: t("paint.image.hatchDesc") },
    { value: "lines", label: t("paint.image.lines"), description: t("paint.image.linesDesc") },
    { value: "dots", label: t("paint.image.dots"), description: t("paint.image.dotsDesc") },
  ];

  const fail = (e: any) => toast.error(String(e.message ?? e));

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

  // The Paint tab stays mounted while hidden (KEEP_ALIVE), so its mount effect
  // runs only once. Meanwhile the Games/Gallery tabs can create a new page and
  // make it active on the backend. When we become visible again, pick up that
  // newly activated page so the canvas shows what the user just sent over —
  // otherwise it keeps displaying the previously open page. Skip the reload when
  // the active page is already the one on screen, to preserve the undo stack and
  // any in-flight edits on normal tab returns.
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
          resetHistory();
          setSelectedIds([]);
          return api.getPage(id).then(autoAdoptStale).then(setPage);
        }
      })
      .catch(fail);
  }, [visible]);

  // The canvas is laid out in the open page's *own* profile coordinate space,
  // so its size must follow that profile — not the globally active one. When a
  // page from another (or archived) profile is opened, load that profile's
  // calibration so the bed resizes to match; legacy/missing pages fall back to
  // the active calibration. A token guards against a slow response from a
  // previously open page overwriting the current one.
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
    if (!visible || !cal || !page) return;
    if (!globalLive.active || globalLive.sourceId === "designer") return;
    live.start();
  }, [visible, cal, page?.id, globalLive.active, globalLive.sourceId]);

  // Close the "plot" split-button dropdown on outside click or Escape.
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

  // A "stale" page belongs to the *active* profile but was created before the
  // profile's last edit. Re-stamping it to the current fingerprint changes no
  // geometry, so we do it silently whenever such a page is opened — no manual
  // "adopt" click. Genuinely foreign profiles (other/archived/missing) still
  // require an explicit decision via the banner. If the drawing no longer fits
  // the changed plot area, adoption is refused (no force) and the page stays
  // stale so the banner can offer the forced adopt.
  const autoAdoptStale = (p: Page): Promise<Page> => {
    if (p.profileStatus !== "stale") return Promise.resolve(p);
    return api
      .adoptPageProfile(p.id, false)
      .then((updated) => {
        reloadIndex();
        return updated;
      })
      .catch(() => p);
  };

  // Reload calibration + index + page, e.g. after a profile switch (the
  // canvas size and the page's profile status both depend on it).
  const reloadAll = (pageId?: string) =>
    Promise.all([
      api.getCalibration().then(setCal),
      api.listPages().then(setIndex),
      pageId ? api.getPage(pageId).then(setPage) : Promise.resolve(null),
    ]);

  // G-code is only allowed when the page belongs to the active profile —
  // the backend enforces this too; the UI explains it and offers a way out.
  const pageBlocked = !!page?.profileStatus && page.profileStatus !== "active";

  const activatePageProfile = () => {
    if (!page?.profileId) return;
    api
      .activateProfile(page.profileId)
      .then(() => reloadAll(page.id))
      .catch(fail);
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

  // persist objects (debounced) for a specific page id
  const persist = (pageId: string, objects: SceneObject[]) => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      api.savePage(pageId, { objects }).then(reloadIndex).catch(fail);
    }, 500);
  };

  const openPage = (id: string) => {
    if (id === page?.id) return;
    window.clearTimeout(saveTimer.current);
    resetHistory();
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
      resetHistory();
      setPage(p);
      setSelectedIds([]);
      return reloadIndex();
    }).catch(fail);

  const duplicate = (id: string) =>
    api.duplicatePage(id).then((p) => {
      resetHistory();
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
      resetHistory();
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

  // Build a job for the whole page, or — when `objects` is given — for just
  // that subset (a selection plotted on its own).
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

  // Plot only the selected objects, then mark them plotted so they show dimmed
  // and the rest of the page can be plotted later. Lets you add elements to a
  // sheet that already has artwork and send just the new ones.
  const plotSelection = () => {
    if (!page || busy || sending || pageBlocked || selectedIds.length === 0) return;
    const ids = [...selectedIds];
    const subset = page.objects.filter((o) => ids.includes(o.id) && !o.plotted);
    if (subset.length === 0) return;
    generateJob(subset)
      .then((filename) => {
        setSending(true);
        return api.send(filename, true).then(() => {
          toast.success(t("paint.selectionPlotted", { name: filename }));
          remember();
          markPlotted(ids);
          setSelectedIds([]);
        });
      })
      .catch(fail)
      .finally(() => setSending(false));
  };

  // Flag objects as already plotted (dimmed, excluded from later plots). Undoable
  // via the surrounding remember() and persisted like any other edit.
  const markPlotted = (ids: string[]) => {
    if (!page) return;
    const sel = new Set(ids);
    const objects = page.objects.map((o) => (sel.has(o.id) ? { ...o, plotted: true } : o));
    setPage({ ...page, objects });
    persist(page.id, objects);
  };

  // Render the page's G-code transiently (no job file) and show it fullscreen.
  const openFullscreen = () => {
    if (!page || loadingPreview) return;
    setLoadingPreview(true);
    api.pagePreview3D(page.id, page.objects)
      .then(setFullscreen)
      .catch(fail)
      .finally(() => setLoadingPreview(false));
  };

  // --- object editing ---
  const remember = () => {
    if (!page) return;
    undoStack.current.push(cloneObjects(page.objects));
    redoStack.current = [];
    syncHistory();
  };

  const addObject = (obj: SceneObject) => {
    if (!page) return;
    remember();
    const nextZ = page.objects.reduce((max, o, i) => Math.max(max, zValue(o, i)), -1) + 1;
    const objects = [...page.objects, withStyledCache({ ...obj, zOrder: nextZ })];
    setPage({ ...page, objects });
    setSelectedIds([obj.id]);
    persist(page.id, objects);
  };

  // Insert several objects in one undo step (used by the markdown editor).
  const addObjects = (objs: SceneObject[]) => {
    if (!page || objs.length === 0) return;
    remember();
    let nextZ = page.objects.reduce((max, o, i) => Math.max(max, zValue(o, i)), -1) + 1;
    const styled = objs.map((obj) => withStyledCache({ ...obj, zOrder: nextZ++ }));
    const objects = [...page.objects, ...styled];
    setPage({ ...page, objects });
    setSelectedIds(styled.map((o) => o.id));
    persist(page.id, objects);
  };

  const insertMarkdown = (objs: SceneObject[], markdown: string) => {
    if (!page) return;
    addObjects(objs);
    setPage((p) => (p ? { ...p, markdown } : p));
    api.savePage(page.id, { markdown }).then(reloadIndex).catch(fail);
    setMdOpen(false);
    setTool("select");
  };

  const addTextObject = (at: Pt) => {
    const text = defaultText;
    const size = 12;
    const font: TextFont = "sans";
    textGeometryAsync(text, size, font, defaultText)
      .then(({ local, cx, cy }) => {
        addObject({
          id: crypto.randomUUID(),
          type: "text",
          data: { text, mode: "single-line", size, font, basePolylines: local, style: DEFAULT_VECTOR_STYLE },
          cachedPolylines: local,
          transform: { x: at[0] + cx, y: at[1] + cy, rotation: 0, scale: 1 },
          plotted: false,
        });
      })
      .catch(fail);
  };

  // Open the image-import dialog for a picked file, placed at the bed centre.
  const pickImage = (file: File | undefined) => {
    if (!file || !cal) return;
    setImageImport({ file, at: [cal.plot_width / 2, cal.plot_height / 2], mode: "edges", detail: 2 });
  };

  const importImage = () => {
    if (!page || !imageImport || importingImage) return;
    setImportingImage(true);
    // The designer image import lands the file in the unified gallery (as an
    // admin asset) and places its first page, replacing the old Sources store.
    api.galleryUpload(imageImport.file, "", { mode: imageImport.mode, detail: imageImport.detail })
      .then((item) => api.galleryPreview(item.id, 1).then((preview) => ({ item, preview })))
      .then(({ item, preview }) => {
        if (!preview.polylines.length) throw new Error(t("paint.noLinesImage"));
        const bounds = preview.bounds ?? [0, 0, preview.width, preview.height];
        const width = Math.max(bounds[2] - bounds[0], 1);
        const height = Math.max(bounds[3] - bounds[1], 1);
        const scale = Math.min(1, (cal!.plot_width * 0.6) / width, (cal!.plot_height * 0.6) / height);
        const { local } = localize(preview.polylines as Pt[][]);
        addObject({
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

  const selectIds = (ids: string[]) => {
    setSelectedIds(ids);
    setMenu(null);
  };

  const updateObject = (id: string, transform: Transform) => {
    if (!page) return;
    const objects = page.objects.map((o) => (o.id === id ? { ...o, transform } : o));
    setPage({ ...page, objects });
    persist(page.id, objects);
  };

  const updateObjects = (updates: Map<string, Transform>) => {
    if (!page || updates.size === 0) return;
    const objects = page.objects.map((o) => {
      const transform = updates.get(o.id);
      return transform ? { ...o, transform } : o;
    });
    setPage({ ...page, objects });
    persist(page.id, objects);
  };

  const eraseAcrossObjects = (path: Pt[], mode: "free" | "line", radius: number) => {
    if (!page || path.length < 2) return;
    let changed = false;
    const objects = page.objects.flatMap((obj) => {
      if (obj.plotted) return [obj];
      const local = ((obj.cachedPolylines as Pt[][] | undefined) ?? basePolylines(obj)).filter((line) => line.length >= 2);
      if (!local.length) return [obj];
      const transform = obj.transform ?? IDENTITY;
      const world = transformPolylines(local, transform);
      const erased = eraseWorldPolylines(world, path, mode, radius).filter((line) => line.length >= 2);
      if (samePolylines(erased, world)) return [obj];
      changed = true;
      if (!erased.length) return [];
      const { local: nextLocal, cx, cy } = localize(erased);
      return [{
        ...obj,
        data: { ...(obj.data ?? {}), basePolylines: nextLocal },
        cachedPolylines: nextLocal,
        transform: { x: cx, y: cy, rotation: 0, scale: 1 },
      }];
    });
    if (!changed) return;
    remember();
    setPage({ ...page, objects });
    setSelectedIds((ids) => ids.filter((id) => objects.some((obj) => obj.id === id)));
    persist(page.id, objects);
  };

  const updateTextObject = (id: string, patch: Partial<{ text: string; size: number; font: TextFont }>) => {
    if (!page) return;
    remember();
    const obj = page.objects.find((o) => o.id === id);
    if (!obj) return;
    const data = {
      text: String(obj.data?.text ?? defaultText),
      mode: "single-line",
      size: Number(obj.data?.size ?? 12),
      font: (obj.data?.font ?? "sans") as TextFont,
      ...patch,
    };
    textGeometryAsync(data.text, data.size, data.font, defaultText)
      .then(({ local }) => {
        const style = objectStyle(obj);
        const objects = page.objects.map((o) => o.id === id
          ? { ...o, data: { ...data, basePolylines: local, style }, cachedPolylines: buildStyledPolylines(local, style) }
          : o);
        setPage({ ...page, objects });
        persist(page.id, objects);
      })
      .catch(fail);
  };

  const editSelectedText = (edit: (text: string) => string) => {
    if (!page || selectedIds.length !== 1) return false;
    const obj = page.objects.find((o) => o.id === selectedIds[0]);
    if (!obj || obj.type !== "text") return false;
    updateTextObject(obj.id, { text: edit(String(obj.data?.text ?? defaultText)) });
    return true;
  };

  const deleteSelected = () => {
    if (!page || selectedIds.length === 0) return;
    remember();
    const selected = new Set(selectedIds);
    const objects = page.objects.filter((o) => !selected.has(o.id));
    setPage({ ...page, objects });
    setSelectedIds([]);
    persist(page.id, objects);
  };

  const updateSelectedStyle = (patch: Partial<VectorStyle>) => {
    if (!page || selectedIds.length === 0) return;
    remember();
    const selected = new Set(selectedIds);
    const objects = page.objects.map((obj) => {
      if (!selected.has(obj.id)) return obj;
      const style = normalizeStyle({
        ...objectStyle(obj),
        ...patch,
        stroke: { ...objectStyle(obj).stroke, ...(patch.stroke ?? {}) },
        fill: { ...objectStyle(obj).fill, ...(patch.fill ?? {}) },
      });
      const base = basePolylines(obj);
      return { ...obj, data: { ...(obj.data ?? {}), basePolylines: base, style }, cachedPolylines: buildStyledPolylines(base, style) };
    });
    setPage({ ...page, objects });
    persist(page.id, objects);
  };

  const groupSelected = (ids = selectedIds) => {
    if (!page || ids.length < 2) return;
    remember();
    const selected = new Set(ids);
    const groupId = crypto.randomUUID();
    const objects = page.objects.map((obj) => selected.has(obj.id) ? { ...obj, groupId } : obj);
    setPage({ ...page, objects });
    setSelectedIds(ids);
    setMenu(null);
    persist(page.id, objects);
  };

  const ungroupSelected = (ids = selectedIds) => {
    if (!page || ids.length === 0) return;
    const selected = new Set(ids);
    const groupIds = new Set(
      page.objects
        .filter((obj) => selected.has(obj.id) && obj.groupId)
        .map((obj) => obj.groupId)
    );
    if (groupIds.size === 0) return;
    remember();
    const objects = page.objects.map((obj) => groupIds.has(obj.groupId) ? { ...obj, groupId: undefined } : obj);
    setPage({ ...page, objects });
    setSelectedIds(page.objects.filter((obj) => groupIds.has(obj.groupId)).map((obj) => obj.id));
    setMenu(null);
    persist(page.id, objects);
  };

  const convertSelectedToLines = () => {
    if (!page || selectedIds.length === 0) return;
    const selected = new Set(selectedIds);
    const targets = page.objects.filter((obj) => selected.has(obj.id) && !obj.plotted);
    const targetIds = new Set(targets.map((obj) => obj.id));
    const converted: SceneObject[] = [];
    let nextZ = page.objects.reduce((max, o, i) => Math.max(max, zValue(o, i)), -1) + 1;
    for (const obj of targets) {
      const local = ((obj.cachedPolylines as Pt[][] | undefined) ?? basePolylines(obj)).filter((line) => line.length >= 2);
      if (!local.length) continue;
      const world = transformPolylines(local, obj.transform ?? IDENTITY);
      for (const line of world) {
        const { local: nextLocal, cx, cy } = localize([line]);
        converted.push({
          id: crypto.randomUUID(),
          type: "pen",
          data: { basePolylines: nextLocal, style: DEFAULT_VECTOR_STYLE },
          cachedPolylines: nextLocal,
          transform: { x: cx, y: cy, rotation: 0, scale: 1 },
          zOrder: nextZ++,
          plotted: false,
        });
      }
    }
    if (!converted.length) return;
    remember();
    const objects = [...page.objects.filter((obj) => !targetIds.has(obj.id)), ...converted];
    setPage({ ...page, objects });
    setSelectedIds(converted.map((obj) => obj.id));
    setMenu(null);
    persist(page.id, objects);
  };

  const copySelected = () => {
    if (!page || selectedIds.length === 0) return;
    const selected = new Set(selectedIds);
    clipboard.current = cloneObjects(page.objects.filter((obj) => selected.has(obj.id)));
    setClipboardCount(clipboard.current.length);
  };

  const cutSelected = () => {
    if (!page || selectedIds.length === 0) return;
    remember();
    const selected = new Set(selectedIds);
    clipboard.current = cloneObjects(page.objects.filter((obj) => selected.has(obj.id)));
    setClipboardCount(clipboard.current.length);
    const objects = page.objects.filter((obj) => !selected.has(obj.id));
    setPage({ ...page, objects });
    setSelectedIds([]);
    persist(page.id, objects);
  };

  const pasteObjects = (source = clipboard.current) => {
    if (!page || source.length === 0) return;
    remember();
    let nextZ = page.objects.reduce((max, o, i) => Math.max(max, zValue(o, i)), -1) + 1;
    const groupMap = new Map<string, string>();
    const copies = cloneObjects(source).map((obj) => ({
      ...obj,
      id: crypto.randomUUID(),
      zOrder: nextZ++,
      groupId: obj.groupId
        ? groupMap.get(obj.groupId) ?? groupMap.set(obj.groupId, crypto.randomUUID()).get(obj.groupId)
        : undefined,
      plotted: false,
      transform: {
        ...(obj.transform ?? { x: 0, y: 0, rotation: 0, scale: 1 }),
        x: (obj.transform?.x ?? 0) + 5,
        y: (obj.transform?.y ?? 0) + 5,
      },
    }));
    const objects = [...page.objects, ...copies];
    setPage({ ...page, objects });
    setSelectedIds(copies.map((obj) => obj.id));
    persist(page.id, objects);
  };

  const duplicateSelected = () => {
    if (!page || selectedIds.length === 0) return;
    const selected = new Set(selectedIds);
    pasteObjects(page.objects.filter((obj) => selected.has(obj.id)));
  };

  const moveSelected = (dir: -1 | 1) => {
    if (!page || selectedIds.length === 0) return;
    const selected = new Set(selectedIds);
    const ordered = page.objects
      .map((obj, index) => ({ obj, index }))
      .sort((a, b) => zValue(a.obj, a.index) - zValue(b.obj, b.index));
    const movable = dir < 0
      ? ordered.some(({ obj }, i) => selected.has(obj.id) && i > 0 && !selected.has(ordered[i - 1].obj.id))
      : ordered.some(({ obj }, i) => selected.has(obj.id) && i < ordered.length - 1 && !selected.has(ordered[i + 1].obj.id));
    if (!movable) return;
    remember();
    if (dir < 0) {
      for (let i = 1; i < ordered.length; i++) {
        if (selected.has(ordered[i].obj.id) && !selected.has(ordered[i - 1].obj.id)) {
          [ordered[i - 1], ordered[i]] = [ordered[i], ordered[i - 1]];
        }
      }
    } else {
      for (let i = ordered.length - 2; i >= 0; i--) {
        if (selected.has(ordered[i].obj.id) && !selected.has(ordered[i + 1].obj.id)) {
          [ordered[i], ordered[i + 1]] = [ordered[i + 1], ordered[i]];
        }
      }
    }
    const zById = new Map(ordered.map(({ obj }, zOrder) => [obj.id, zOrder]));
    const objects = page.objects.map((obj) => ({ ...obj, zOrder: zById.get(obj.id) ?? obj.zOrder ?? 0 }));
    setPage({ ...page, objects });
    persist(page.id, objects);
  };

  // Combined world bounding box of the current selection, or null if empty.
  const selectionBounds = (): [number, number, number, number] | null => {
    if (!page || selectedIds.length === 0) return null;
    const sel = new Set(selectedIds);
    let b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const obj of page.objects) {
      if (!sel.has(obj.id)) continue;
      const local = (obj.cachedPolylines as Pt[][] | undefined) ?? basePolylines(obj);
      if (!local.length) continue;
      const [x0, y0, x1, y1] = objectWorldBounds(local, obj.transform ?? IDENTITY);
      b = [Math.min(b[0], x0), Math.min(b[1], y0), Math.max(b[2], x1), Math.max(b[3], y1)];
    }
    return Number.isFinite(b[0]) ? b : null;
  };

  const objectLocalSize = (obj: SceneObject): { width: number; height: number; localWidth: number; localHeight: number } | null => {
    const local = (obj.cachedPolylines as Pt[][] | undefined) ?? basePolylines(obj);
    if (!local.length) return null;
    const flat = local.flat();
    if (!flat.length) return null;
    const [x0, y0, x1, y1] = bounds(flat);
    const t = obj.transform ?? IDENTITY;
    const sx = Math.abs(t.scaleX ?? t.scale);
    const sy = Math.abs(t.scaleY ?? t.scale);
    const localWidth = Math.max(x1 - x0, 0);
    const localHeight = Math.max(y1 - y0, 0);
    return {
      width: localWidth * sx,
      height: localHeight * sy,
      localWidth,
      localHeight,
    };
  };

  const setSelectedObjectSize = (axis: "width" | "height", target: number) => {
    if (!page || selectedIds.length !== 1 || !Number.isFinite(target) || target <= 0) return;
    const obj = page.objects.find((o) => o.id === selectedIds[0]);
    if (!obj) return;
    const size = objectLocalSize(obj);
    if (!size) return;
    const current = axis === "width" ? size.width : size.height;
    const base = axis === "width" ? size.localWidth : size.localHeight;
    if ((sizeLinked && current <= 0) || (!sizeLinked && base <= 0)) return;
    remember();
    const objects = page.objects.map((o) => {
      if (o.id !== obj.id) return o;
      const t = o.transform ?? IDENTITY;
      const sx = t.scaleX ?? t.scale;
      const sy = t.scaleY ?? t.scale;
      const factor = sizeLinked ? target / current : 1;
      const nextSx = sizeLinked
        ? sx * factor
        : axis === "width" ? Math.sign(sx || 1) * (target / base) : sx;
      const nextSy = sizeLinked
        ? sy * factor
        : axis === "height" ? Math.sign(sy || 1) * (target / base) : sy;
      return {
        ...o,
        transform: {
          ...t,
          scaleX: nextSx,
          scaleY: nextSy,
          scale: Math.max(Math.abs(nextSx), Math.abs(nextSy)),
        },
      };
    });
    setPage({ ...page, objects });
    persist(page.id, objects);
  };

  const setSelectedObjectRotation = (degrees: number) => {
    if (!page || selectedIds.length !== 1 || !Number.isFinite(degrees)) return;
    remember();
    const radians = (degrees * Math.PI) / 180;
    const objects = page.objects.map((o) =>
      o.id === selectedIds[0]
        ? { ...o, transform: { ...(o.transform ?? IDENTITY), rotation: radians } }
        : o
    );
    setPage({ ...page, objects });
    persist(page.id, objects);
  };

  const mapSelected = (fn: (t: Transform) => Transform) => {
    if (!page || selectedIds.length === 0) return;
    remember();
    const sel = new Set(selectedIds);
    const objects = page.objects.map((o) =>
      sel.has(o.id) && o.transform ? { ...o, transform: fn(o.transform) } : o
    );
    setPage({ ...page, objects });
    persist(page.id, objects);
  };

  // Scale the selection as large as it fits the plot area (keeping aspect) and
  // centre it. Scales each object's transform about the selection's centre.
  const fitSelected = () => {
    const b = selectionBounds();
    if (!b || !cal) return;
    const w = Math.max(b[2] - b[0], 0.001);
    const h = Math.max(b[3] - b[1], 0.001);
    const factor = Math.min((cal.plot_width * 0.95) / w, (cal.plot_height * 0.95) / h);
    const gcx = (b[0] + b[2]) / 2, gcy = (b[1] + b[3]) / 2;
    const tcx = cal.plot_width / 2, tcy = cal.plot_height / 2;
    mapSelected((t) => {
      const next: Transform = {
        ...t,
        x: tcx + (t.x - gcx) * factor,
        y: tcy + (t.y - gcy) * factor,
        scale: (t.scale ?? 1) * factor,
      };
      if (t.scaleX != null) next.scaleX = t.scaleX * factor;
      if (t.scaleY != null) next.scaleY = t.scaleY * factor;
      return next;
    });
  };

  // Move the selection so its bounding box is centred in the plot area.
  const centerSelected = () => {
    const b = selectionBounds();
    if (!b || !cal) return;
    const dx = cal.plot_width / 2 - (b[0] + b[2]) / 2;
    const dy = cal.plot_height / 2 - (b[1] + b[3]) / 2;
    mapSelected((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
  };

  // Nudge the selection by (dx, dy) mm without recording undo (the caller does).
  const nudgeSelected = (dx: number, dy: number) => {
    if (!page || selectedIds.length === 0) return;
    const sel = new Set(selectedIds);
    const objects = page.objects.map((o) =>
      sel.has(o.id) && o.transform ? { ...o, transform: { ...o.transform, x: o.transform.x + dx, y: o.transform.y + dy } } : o
    );
    setPage({ ...page, objects });
    persist(page.id, objects);
  };

  const restoreObjects = (objects: SceneObject[]) => {
    if (!page) return;
    setPage({ ...page, objects });
    setSelectedIds((ids) => ids.filter((id) => objects.some((obj) => obj.id === id)));
    persist(page.id, objects);
  };

  const undo = () => {
    if (!page || undoStack.current.length === 0) return;
    const previous = undoStack.current.pop()!;
    redoStack.current.push(cloneObjects(page.objects));
    syncHistory();
    restoreObjects(previous);
  };

  const redo = () => {
    if (!page || redoStack.current.length === 0) return;
    const next = redoStack.current.pop()!;
    undoStack.current.push(cloneObjects(page.objects));
    syncHistory();
    restoreObjects(next);
  };

  // Delete/Backspace removes the selected object (unless typing in a field).
  // Only while the tab is on screen: the component stays mounted when hidden,
  // so its shortcuts (incl. Ctrl+C/V preventDefault) must not fire on other tabs.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setMenu(null);
        if (tool !== "select") {
          setTool("select");
          return;
        }
        if (selectedIds.length > 0) setSelectedIds([]);
        return;
      }
      if (tool === "text" && selectedIds.length === 1 && !(e.ctrlKey || e.metaKey || e.altKey)) {
        if (e.key === "Backspace") {
          if (editSelectedText((text) => text.slice(0, -1))) e.preventDefault();
          return;
        }
        if (e.key === "Enter") {
          if (editSelectedText((text) => `${text}\n`)) e.preventDefault();
          return;
        }
        if (e.key.length === 1) {
          if (editSelectedText((text) => text === defaultText ? e.key : text + e.key)) e.preventDefault();
          return;
        }
      }
      const arrow: Record<string, [number, number]> = {
        ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      };
      if (arrow[e.key] && selectedIds.length > 0 && !(e.ctrlKey || e.metaKey || e.altKey)) {
        e.preventDefault();
        if (!e.repeat) remember(); // one undo step per burst, even when held
        const step = page?.grid.step || 1;
        const [sx, sy] = arrow[e.key];
        nudgeSelected(sx * step, sy * step);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.length > 0) {
        e.preventDefault();
        deleteSelected();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        e.preventDefault();
        copySelected();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") {
        e.preventDefault();
        cutSelected();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        e.preventDefault();
        pasteObjects();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
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
  const selectedObjectSize = selectedObjects.length === 1 ? objectLocalSize(selectedObjects[0]) : null;
  const selectedObjectRotation = selectedObjects.length === 1
    ? (() => {
        const raw = ((selectedObjects[0].transform?.rotation ?? 0) * 180) / Math.PI;
        const normalized = ((raw % 360) + 360) % 360;
        return normalized === 0 && raw > 0.0001 ? 360 : normalized;
      })()
    : null;
  const selectedStyle = selectedObjects.length > 0 ? objectStyle(selectedObjects[0]) : DEFAULT_VECTOR_STYLE;
  const canUngroupMenu = !!menu && page.objects.some((obj) => menu.ids.includes(obj.id) && obj.groupId);

  return (
    <div className="paint">
      {menu && (
        <div className="paint-context-menu" style={{ left: menu.x, top: menu.y }} onContextMenu={(e) => e.preventDefault()}>
          <button disabled={menu.ids.length < 2} onClick={() => groupSelected(menu.ids)}>{t("paint.group")}</button>
          <button disabled={!canUngroupMenu} onClick={() => ungroupSelected(menu.ids)}>{t("paint.ungroup")}</button>
        </div>
      )}
      {imageImport && (
        <div className="paint-modal-backdrop" onMouseDown={() => !importingImage && setImageImport(null)}>
          <div className="paint-import-modal" onMouseDown={(e) => e.stopPropagation()}>
            <h3>{t("paint.image.title")}</h3>
            <p className="muted">{imageImport.file.name}</p>
            <div className="paint-import-modes">
              {imageModes.map((mode) => (
                <button key={mode.value}
                  className={imageImport.mode === mode.value ? "active" : ""}
                  onClick={() => setImageImport({ ...imageImport, mode: mode.value })}>
                  <strong>{mode.label}</strong>
                  <span>{mode.description}</span>
                </button>
              ))}
            </div>
            <label className="field">
              {t("paint.image.detail")}
              <select value={imageImport.detail}
                onChange={(e) => setImageImport({ ...imageImport, detail: Number(e.target.value) })}>
                <option value={1}>{t("paint.image.low")}</option>
                <option value={2}>{t("paint.image.medium")}</option>
                <option value={3}>{t("paint.image.high")}</option>
              </select>
            </label>
            <div className="job-actions">
              <button className="ghost" disabled={importingImage} onClick={() => setImageImport(null)}>{t("paint.cancel")}</button>
              <button className="primary" disabled={importingImage} onClick={importImage}>
                {importingImage ? t("paint.converting") : t("paint.insert")}
              </button>
            </div>
          </div>
        </div>
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
            <div className="paint-job-actions">
              <LiveButton
                state={live.state}
                viewers={live.viewers}
                onClick={() => live.state === "live" || live.state === "connecting" ? live.stop("user-stopped") : live.start()}
              />
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
              onAdd={addObject}
              onUpdate={updateObject}
              onUpdateMany={updateObjects}
              onEditStart={remember}
              onContextMenuSelection={(ids, x, y) => { setSelectedIds(ids); setMenu({ ids, x, y }); }}
              onImageDrop={(file, at) => setImageImport({ file, at, mode: "edges", detail: 2 })}
              onTextAdd={addTextObject}
              onErase={eraseAcrossObjects}
              onCursorMove={live.state === "live" ? live.sendCursor : undefined}
              onCursorClick={live.state === "live" ? live.sendClick : undefined}
              viewRotation={viewRotation}
              onViewRotationChange={setViewRotation}
            />
            {live.error && <div className="banner err live-error">{live.error}</div>}
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
                <button className="ghost" disabled={!hasSelection} onClick={fitSelected}
                  title={hasSelection ? t("paint.fitSelection") : t("paint.noSelection")} aria-label={t("paint.fit")}>
                  ⛶
                </button>
                <button className="ghost" disabled={!hasSelection} onClick={centerSelected}
                  title={hasSelection ? t("paint.centerSelection") : t("paint.noSelection")} aria-label={t("paint.center")}>
                  ⌖
                </button>
                <button className="ghost" disabled={!hasSelection} onClick={() => moveSelected(-1)}
                  title={hasSelection ? t("paint.moveBack") : t("paint.noSelection")} aria-label={t("paint.toBack")}>
                  ⤓
                </button>
                <button className="ghost" disabled={!hasSelection} onClick={() => moveSelected(1)}
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
              <div className="paint-tools-actions compact">
                <button className="ghost" disabled={!hasSelection} onClick={deleteSelected}
                  title={hasSelection ? t("paint.deleteSelection") : t("paint.noSelection")} aria-label={t("paint.delete")}>
                  🗑{selectedObjects.length > 1 ? <span className="act-count">{selectedObjects.length}</span> : ""}
                </button>
                <button className="ghost" disabled={!hasSelection} onClick={convertSelectedToLines}
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
                <button className="ghost" disabled={history.undo === 0} onClick={undo}
                  title={t("paint.undo")} aria-label={t("paint.undo")}>
                  ↶
                </button>
                <button className="ghost" disabled={history.redo === 0} onClick={redo}
                  title={t("paint.redo")} aria-label={t("paint.redo")}>
                  ↷
                </button>
              <button className="ghost" disabled={!hasSelection} onClick={copySelected}
                title={hasSelection ? t("paint.copySelection") : t("paint.noSelection")} aria-label={t("paint.copy")}>
                ⧉
              </button>
              <button className="ghost" disabled={!hasSelection} onClick={cutSelected}
                title={hasSelection ? t("paint.cutSelection") : t("paint.noSelection")} aria-label={t("paint.cut")}>
                ✂
              </button>
              <button className="ghost" disabled={clipboardCount === 0} onClick={() => pasteObjects()}
                title={clipboardCount > 0 ? t("paint.pasteSelection") : t("paint.clipboardEmpty")} aria-label={t("paint.paste")}>
                ⎘{clipboardCount > 1 ? <span className="act-count">{clipboardCount}</span> : ""}
              </button>
              <button className="ghost" disabled={!hasSelection} onClick={duplicateSelected}
                title={hasSelection ? t("paint.duplicateSelection") : t("paint.noSelection")} aria-label={t("paint.duplicate")}>
                ⧉
              </button>
              <button className="ghost" disabled={selectedObjects.length < 2} onClick={() => groupSelected()}
                title={selectedObjects.length >= 2 ? t("paint.groupSelection") : t("paint.needTwoObjects")} aria-label={t("paint.group")}>
                ⊞
              </button>
              <button className="ghost" disabled={!selectedObjects.some((obj) => obj.groupId)} onClick={() => ungroupSelected()}
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

            <div className="paint-style-panel">
              <h4>{t("paint.object")}</h4>
              <div className="paint-size-fields">
                <label className="field">{t("common.width")}
                  <div className="input-unit">
                    <input
                      type="number"
                      min={0.1}
                      step={0.5}
                      disabled={!selectedObjectSize || selectedObjectSize.localWidth <= 0}
                      value={selectedObjectSize ? Number(selectedObjectSize.width.toFixed(1)) : ""}
                      onChange={(e) => {
                        if (e.target.value !== "") setSelectedObjectSize("width", Number(e.target.value));
                      }}
                    />
                    <em>mm</em>
                  </div>
                </label>
                <label className="field">{t("common.height")}
                  <div className="input-unit">
                    <input
                      type="number"
                      min={0.1}
                      step={0.5}
                      disabled={!selectedObjectSize || selectedObjectSize.localHeight <= 0}
                      value={selectedObjectSize ? Number(selectedObjectSize.height.toFixed(1)) : ""}
                      onChange={(e) => {
                        if (e.target.value !== "") setSelectedObjectSize("height", Number(e.target.value));
                      }}
                    />
                    <em>mm</em>
                  </div>
                </label>
                <label className="field">{t("common.rotation")}
                  <div className="input-unit">
                    <input
                      type="number"
                      min={0}
                      max={360}
                      step={1}
                      disabled={selectedObjectRotation == null}
                      value={selectedObjectRotation == null ? "" : Number(selectedObjectRotation.toFixed(1))}
                      onChange={(e) => {
                        if (e.target.value !== "") setSelectedObjectRotation(Number(e.target.value));
                      }}
                    />
                    <em>°</em>
                  </div>
                </label>
                <button
                  type="button"
                  className={`size-link ${sizeLinked ? "active" : ""}`}
                  aria-pressed={sizeLinked}
                  aria-label={t("paint.keepAspect")}
                  title={t("paint.keepAspect")}
                  onClick={() => setSizeLinked((v) => !v)}
                >
                  <svg className="size-link-ico" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    {!sizeLinked && <line className="size-link-cut" x1="3" y1="3" x2="21" y2="21" />}
                  </svg>
                </button>
              </div>

              <h4>{t("paint.style.line")}</h4>
              <label className="field">
                {t("paint.style.type")}
                <select
                  disabled={!hasSelection}
                  value={selectedStyle.stroke.mode}
                  onChange={(e) => updateSelectedStyle({ stroke: { mode: e.target.value as StrokeMode } as any })}
                >
                  <option value="solid">{t("paint.style.solid")}</option>
                  <option value="dashed">{t("paint.style.dashed")}</option>
                  <option value="dotted">{t("paint.style.dotted")}</option>
                </select>
              </label>
              {selectedStyle.stroke.mode === "dashed" && (
                <div className="fields compact">
                  <label className="field">{t("paint.style.dash")}
                    <input type="number" min={0.5} step={0.5} disabled={!hasSelection}
                      value={selectedStyle.stroke.dashLength}
                      onChange={(e) => updateSelectedStyle({ stroke: { dashLength: Number(e.target.value) || 1 } as any })} />
                  </label>
                  <label className="field">{t("paint.style.gap")}
                    <input type="number" min={0.5} step={0.5} disabled={!hasSelection}
                      value={selectedStyle.stroke.gapLength}
                      onChange={(e) => updateSelectedStyle({ stroke: { gapLength: Number(e.target.value) || 1 } as any })} />
                  </label>
                </div>
              )}
              {selectedStyle.stroke.mode === "dotted" && (
                <div className="fields compact">
                  <label className="field">{t("paint.style.spacing")}
                    <input type="number" min={0.5} step={0.5} disabled={!hasSelection}
                      value={selectedStyle.stroke.dotSpacing}
                      onChange={(e) => updateSelectedStyle({ stroke: { dotSpacing: Number(e.target.value) || 1 } as any })} />
                  </label>
                  <label className="field">{t("paint.size")}
                    <input type="number" min={0.2} step={0.2} disabled={!hasSelection}
                      value={selectedStyle.stroke.dotSize}
                      onChange={(e) => updateSelectedStyle({ stroke: { dotSize: Number(e.target.value) || 0.5 } as any })} />
                  </label>
                </div>
              )}

              <h4>{t("paint.style.fill")}</h4>
              <label className="check style-check">
                <input
                  type="checkbox"
                  disabled={!hasSelection}
                  checked={selectedStyle.fill.enabled}
                  onChange={(e) => updateSelectedStyle({ fill: { enabled: e.target.checked } as any })}
                />
                {t("paint.style.active")}
              </label>
              {selectedStyle.fill.enabled && (
                <div className="fields compact">
                  <label className="field">
                    {t("paint.style.pattern")}
                    <select
                      disabled={!hasSelection}
                      value={selectedStyle.fill.mode}
                      onChange={(e) => updateSelectedStyle({ fill: { mode: e.target.value as FillMode } as any })}
                    >
                      <option value="hatch">{t("paint.image.hatch")}</option>
                      <option value="dashed-hatch">{t("paint.style.dashedHatch")}</option>
                      <option value="dotted-fill">{t("paint.image.dots")}</option>
                    </select>
                  </label>
                  {selectedStyle.fill.mode !== "dotted-fill" && (
                    <label className="field">{t("paint.style.angle")}
                      <input type="number" step={5} disabled={!hasSelection}
                        value={selectedStyle.fill.angle}
                        onChange={(e) => updateSelectedStyle({ fill: { angle: Number(e.target.value) || 0 } as any })} />
                    </label>
                  )}
                  <label className="field">{t("paint.style.spacing")}
                    <input type="number" min={0.5} step={0.5} disabled={!hasSelection}
                      value={selectedStyle.fill.mode === "dotted-fill" ? selectedStyle.fill.dotSpacing : selectedStyle.fill.spacing}
                      onChange={(e) => updateSelectedStyle({ fill: selectedStyle.fill.mode === "dotted-fill"
                        ? { dotSpacing: Number(e.target.value) || 1 } as any
                        : { spacing: Number(e.target.value) || 1 } as any })} />
                  </label>
                </div>
              )}
            </div>
          </aside>
        </div>

        {selectedText && (
          <div className="paint-object-panel">
            <div className="field">
              <label>{t("paint.text")}</label>
              <textarea
                value={String(selectedText.data?.text ?? defaultText)}
                onChange={(e) => updateTextObject(selectedText.id, { text: e.target.value })}
                rows={3}
              />
            </div>
            <div className="fields">
              <div className="field">
                <label>{t("paint.font")}</label>
                <select
                  value={(selectedText.data?.font ?? "sans") as TextFont}
                  onChange={(e) => updateTextObject(selectedText.id, { font: e.target.value as TextFont })}
                >
                  {TEXT_FONTS.map((font) => (
                    <option key={font.value} value={font.value}>{t(font.labelKey)}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t("paint.size")}</label>
                <div className="input-unit">
                  <input
                    type="number"
                    min={3}
                    max={80}
                    step={1}
                    value={Number(selectedText.data?.size ?? 12)}
                    onChange={(e) => updateTextObject(selectedText.id, { size: Math.max(3, Number(e.target.value) || 12) })}
                  />
                  <em>mm</em>
                </div>
              </div>
            </div>
          </div>
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
          onInsert={addObject}
          onPlotted={() => { reloadIndex(); onAction?.(); }}
        />
      )}
      {ConfirmNode}
      {PromptNode}
    </div>
  );
}
