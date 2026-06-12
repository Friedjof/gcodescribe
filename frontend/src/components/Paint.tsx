import { useEffect, useRef, useState } from "react";
import { api, type Calibration, type GcodePreview3D, type Page, type PageIndex, type SceneObject } from "../api";
import PaintCanvas, { type Tool } from "./PaintCanvas";
import PlotScore from "./PlotScore";
import Gcode3DOverlay from "./Gcode3DOverlay";
import Segmented from "./Segmented";
import { localize, type Pt, type Transform } from "../paint/geometry";
import { TEXT_FONTS, isOutlineFont, type TextFont } from "../paint/text";
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

const GRID_STEPS = [1, 5, 10, 25, 50];

type ImageMode = "edges" | "hatch" | "lines" | "dots";

export default function Paint() {
  const { t } = useI18n();
  const defaultText = t("paint.text");
  const [cal, setCal] = useState<Calibration | null>(null);
  const [index, setIndex] = useState<PageIndex | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [lastJob, setLastJob] = useState<string | null>(null);
  const [startedJob, setStartedJob] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState<GcodePreview3D | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null);
  const [imageImport, setImageImport] = useState<{ file: File; at: Pt; mode: ImageMode; detail: number } | null>(null);
  const [importingImage, setImportingImage] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const undoStack = useRef<SceneObject[][]>([]);
  const redoStack = useRef<SceneObject[][]>([]);
  const clipboard = useRef<SceneObject[]>([]);

  const tools: { value: Tool; label: string }[] = [
    { value: "select", label: t("paint.tool.select") },
    { value: "pen", label: t("paint.tool.pen") },
    { value: "line", label: t("paint.tool.line") },
    { value: "rect", label: t("paint.tool.rect") },
    { value: "circle", label: t("paint.tool.circle") },
    { value: "semicircle", label: t("paint.tool.semicircle") },
    { value: "text", label: t("paint.tool.text") },
  ];
  const imageModes: { value: ImageMode; label: string; description: string }[] = [
    { value: "edges", label: t("paint.image.edges"), description: t("paint.image.edgesDesc") },
    { value: "hatch", label: t("paint.image.hatch"), description: t("paint.image.hatchDesc") },
    { value: "lines", label: t("paint.image.lines"), description: t("paint.image.linesDesc") },
    { value: "dots", label: t("paint.image.dots"), description: t("paint.image.dotsDesc") },
  ];

  const fail = (e: any) => setErr(String(e.message ?? e));

  useEffect(() => {
    api.getCalibration().then(setCal).catch(fail);
    api
      .listPages()
      .then((idx) => {
        setIndex(idx);
        const id = idx.activeId ?? idx.order[0]?.id;
        if (id) return api.getPage(id).then(setPage);
      })
      .catch(fail);
  }, []);

  const reloadIndex = () => api.listPages().then(setIndex).catch(fail);

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
    undoStack.current = [];
    redoStack.current = [];
    setSelectedIds([]);
    api
      .activatePage(id)
      .then(setIndex)
      .then(() => api.getPage(id))
      .then(setPage)
      .catch(fail);
  };

  const newPage = () =>
    api.createPage().then((p) => {
      undoStack.current = [];
      redoStack.current = [];
      setPage(p);
      setSelectedIds([]);
      return reloadIndex();
    }).catch(fail);

  const duplicate = (id: string) =>
    api.duplicatePage(id).then((p) => {
      undoStack.current = [];
      redoStack.current = [];
      setPage(p);
      setSelectedIds([]);
      return reloadIndex();
    }).catch(fail);

  const rename = (id: string, current: string) => {
    const next = window.prompt(t("paint.pageNamePrompt"), current);
    if (next == null) return;
    const name = next.trim();
    if (!name || name === current) return;
    api.savePage(id, { name }).then((p) => {
      if (p.id === page?.id) setPage(p);
      return reloadIndex();
    }).catch(fail);
  };

  const remove = (id: string) => {
    if (!window.confirm(t("paint.deletePageConfirm"))) return;
    api.deletePage(id).then((idx) => {
      setIndex(idx);
      const nextId = idx.activeId ?? idx.order[0]?.id;
      undoStack.current = [];
      redoStack.current = [];
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

  const generateJob = () => {
    if (!page) return Promise.reject(new Error(t("paint.noPage")));
    setBusy(true);
    setErr(null);
    setStartedJob(null);
    return api.pageGcode(page.id)
      .then((job) => {
        setLastJob(job.filename);
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
        return api.send(filename, true).then(() => setStartedJob(filename));
      })
      .catch(fail)
      .finally(() => setSending(false));
  };

  // Render the page's G-code transiently (no job file) and show it fullscreen.
  const openFullscreen = () => {
    if (!page || loadingPreview) return;
    setLoadingPreview(true);
    setErr(null);
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

  const addTextObject = (at: Pt) => {
    const text = defaultText;
    const size = 12;
    const font: TextFont = "pdf-serif";
    textGeometryAsync(text, size, font, defaultText)
      .then(({ local, cx, cy }) => {
        addObject({
          id: crypto.randomUUID(),
          type: "text",
          data: { text, mode: "outline", size, font, basePolylines: local, style: DEFAULT_VECTOR_STYLE },
          cachedPolylines: local,
          transform: { x: at[0] + cx, y: at[1] + cy, rotation: 0, scale: 1 },
          plotted: false,
        });
      })
      .catch(fail);
  };

  const importImage = () => {
    if (!page || !imageImport || importingImage) return;
    setImportingImage(true);
    setErr(null);
    api.createSource(imageImport.file, imageImport.mode, imageImport.detail)
      .then((source) => api.sourcePreview(source.id, 1).then((preview) => ({ source, preview })))
      .then(({ source, preview }) => {
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
            sourceId: source.id,
            name: source.name,
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

  const updateTextObject = (id: string, patch: Partial<{ text: string; size: number; font: TextFont }>) => {
    if (!page) return;
    remember();
    const obj = page.objects.find((o) => o.id === id);
    if (!obj) return;
    const data = {
      text: String(obj.data?.text ?? defaultText),
      mode: isOutlineFont((patch.font ?? obj.data?.font ?? "pdf-serif") as TextFont) ? "outline" : "single-line",
      size: Number(obj.data?.size ?? 12),
      font: (obj.data?.font ?? "pdf-serif") as TextFont,
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

  const copySelected = () => {
    if (!page || selectedIds.length === 0) return;
    const selected = new Set(selectedIds);
    clipboard.current = cloneObjects(page.objects.filter((obj) => selected.has(obj.id)));
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
    restoreObjects(previous);
  };

  const redo = () => {
    if (!page || redoStack.current.length === 0) return;
    const next = redoStack.current.pop()!;
    undoStack.current.push(cloneObjects(page.objects));
    restoreObjects(next);
  };

  // Delete/Backspace removes the selected object (unless typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "Escape") {
        setMenu(null);
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
      <aside className="paint-pages">
        <div className="paint-pages-head">
          <h3>{t("paint.pages")}</h3>
          <button className="ghost" title={t("paint.newPage")} onClick={newPage}>＋</button>
        </div>
        <ul className="page-list">
          {index.order.map((m) => (
            <li key={m.id} className={m.id === page.id ? "active" : ""} onClick={() => openPage(m.id)}>
              <div className="page-info">
                <span className="page-name">{m.name}</span>
                <span className="muted">
                  {m.objectCount} {t("paint.objects")}{m.plottedCount > 0 && ` · ${m.plottedCount} ${t("paint.plotted")}`}
                </span>
              </div>
              <div className="page-acts" onClick={(e) => e.stopPropagation()}>
                <button className="ghost tiny" title={t("paint.rename")} onClick={() => rename(m.id, m.name)}>✎</button>
                <button className="ghost tiny" title={t("paint.duplicate")} onClick={() => duplicate(m.id)}>⧉</button>
                <button className="ghost tiny" title={t("paint.delete")} onClick={() => remove(m.id)}>✕</button>
              </div>
            </li>
          ))}
        </ul>
      </aside>

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
              <button className="primary" disabled={busy || sending} onClick={createGcode}>
                {busy ? t("paint.generating") : t("paint.generateGcode")}
              </button>
              <button className="primary" disabled={busy || sending} onClick={directPlot}>
                {busy ? t("paint.generating") : sending ? t("paint.starting") : t("paint.directPlot")}
              </button>
              <button disabled={loadingPreview} onClick={openFullscreen}>
                {loadingPreview ? t("common.loading") : t("convert.fullscreen")}
              </button>
            </div>
          </div>
        </div>

        <div className="paint-workspace">
          <div className="paint-canvas-wrap">
            <PlotScore pageId={page.id} objects={page.objects} />
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
            />
          </div>

          <aside className="paint-tools-card">
            <Segmented<Tool>
              value={tool}
              onChange={(t) => { setTool(t); if (t !== "select") setSelectedIds([]); }}
              options={tools}
              wrap
            />
            <div className="paint-tools-actions">
              <button className="ghost" disabled={!hasSelection} onClick={deleteSelected}
                title={hasSelection ? t("paint.deleteSelection") : t("paint.noSelection")}>
                🗑 {t("paint.delete")}{selectedObjects.length > 1 ? ` (${selectedObjects.length})` : ""}
              </button>
              <button className="ghost" disabled={!hasSelection} onClick={duplicateSelected}
                title={hasSelection ? t("paint.duplicateSelection") : t("paint.noSelection")}>
                ⧉ {t("paint.duplicate")}
              </button>
              <button className="ghost" disabled={selectedObjects.length < 2} onClick={() => groupSelected()}
                title={selectedObjects.length >= 2 ? t("paint.groupSelection") : t("paint.needTwoObjects")}>
                {t("paint.group")}
              </button>
              <button className="ghost" disabled={!selectedObjects.some((obj) => obj.groupId)} onClick={() => ungroupSelected()}
                title={selectedObjects.some((obj) => obj.groupId) ? t("paint.ungroupSelection") : t("paint.noGroupSelected")}>
                {t("paint.ungroup")}
              </button>
              <button className="ghost" disabled={!hasSelection} onClick={() => moveSelected(-1)}
                title={hasSelection ? t("paint.moveBack") : t("paint.noSelection")}>
                {t("paint.toBack")}
              </button>
              <button className="ghost" disabled={!hasSelection} onClick={() => moveSelected(1)}
                title={hasSelection ? t("paint.moveFront") : t("paint.noSelection")}>
                {t("paint.toFront")}
              </button>
            </div>

            <div className="paint-style-panel">
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
              <label className="field">
                {t("paint.style.pattern")}
                <select
                  disabled={!hasSelection || !selectedStyle.fill.enabled}
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
                  <input type="number" step={5} disabled={!hasSelection || !selectedStyle.fill.enabled}
                    value={selectedStyle.fill.angle}
                    onChange={(e) => updateSelectedStyle({ fill: { angle: Number(e.target.value) || 0 } as any })} />
                </label>
              )}
              <label className="field">{t("paint.style.spacing")}
                <input type="number" min={0.5} step={0.5} disabled={!hasSelection || !selectedStyle.fill.enabled}
                  value={selectedStyle.fill.mode === "dotted-fill" ? selectedStyle.fill.dotSpacing : selectedStyle.fill.spacing}
                  onChange={(e) => updateSelectedStyle({ fill: selectedStyle.fill.mode === "dotted-fill"
                    ? { dotSpacing: Number(e.target.value) || 1 } as any
                    : { spacing: Number(e.target.value) || 1 } as any })} />
              </label>
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
                  value={(selectedText.data?.font ?? "pdf-serif") as TextFont}
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
        {lastJob && <div className="banner ok">{t("paint.jobCreated", { name: lastJob })}</div>}
        {startedJob && <div className="banner ok">{t("paint.jobStarted", { name: startedJob })}</div>}
        {err && <div className="banner err">{err}</div>}
      </section>
      {fullscreen && <Gcode3DOverlay data={fullscreen} onClose={() => setFullscreen(null)} />}
    </div>
  );
}
