import { cachedPage, queueObjects, rememberPage, retainPage } from "../../../api/pageEdits";
import { useI18n } from "../../../i18n";
import { useEffect, useRef, useState } from "react";
import { api, type Calibration, type Page, type SceneObject } from "../../../api";
import {
  type Pt,
  type Transform,
  IDENTITY,
  localBounds,
  localize,
  objectWorldBounds,
  transformPolylines,
} from "../lib/geometry";
import { isMaskObject, maskPolygon, subtractPolygon } from "../lib/masks";
import { type TextFont } from "../lib/text";
import {
  basePolylines,
  cloneObjects,
  keepsStrokeFeeds,
  objectStyle,
  randomTextSeed,
  textGeometryAsync,
  withStyledCache,
  zValue,
} from "../lib/sceneObjects";
import {
  DEFAULT_VECTOR_STYLE,
  normalizeStyle,
  type VectorStyle,
} from "../lib/styling";
import { samePolylines } from "../lib/eraser";

import { trimHistory } from "../lib/history";
import { geometryTask } from "../lib/geometryTasks";
import { sourcePageFrame } from "../lib/sourcePage";
import { resetImageBlankEdges, trimImageBlankEdges, type TrimSide } from "../lib/imageTrim";
import { hasPressureSamples, remapSegmentPressures, validSegmentPressures } from "../lib/pressure";

export interface ObjectOps {
  processing: boolean;
  pendingStyle?: VectorStyle;
  history: { undo: number; redo: number };
  clipboardCount: number;
  draftText: string | null;
  resetHistory: () => void;
  remember: () => void;
  undo: () => void;
  redo: () => void;
  addObject: (obj: SceneObject) => void;
  addObjects: (objs: SceneObject[]) => void;
  eraseAcrossObjects: (path: Pt[], mode: "free" | "line", radius: number) => void;
  updateTextObject: (id: string, patch: Partial<{ text: string; size: number; font: TextFont }>) => void;
  onTextInput: (id: string, text: string) => void;
  onFontOrSizeChange: (id: string, patch: Partial<{ text: string; size: number; font: TextFont }>) => void;
  deleteSelected: () => void;
  updateSelectedStyle: (patch: Partial<VectorStyle>) => void;
  setSelectedPressureEnabled: (enabled: boolean) => void;
  groupSelected: (ids?: string[]) => void;
  ungroupSelected: (ids?: string[]) => void;
  applyMaskStamp: (maskId: string) => void;
  convertSelectedToLines: () => void;
  copySelected: () => void;
  cutSelected: () => void;
  pasteObjects: (source?: SceneObject[]) => void;
  duplicateSelected: () => void;
  moveSelected: (dir: -1 | 1) => void;
  markPlotted: (ids: string[]) => void;
  selectionBounds: () => [number, number, number, number] | null;
  objectLocalSize: (obj: SceneObject) => { width: number; height: number; localWidth: number; localHeight: number } | null;
  setSelectedObjectSize: (axis: "width" | "height", target: number) => void;
  setSelectedObjectRotation: (degrees: number) => void;
  trimSelectedImage: (sides: TrimSide[]) => void;
  resetSelectedImageTrim: () => void;
  mapSelected: (fn: (t: Transform) => Transform) => void;
  fitSelected: () => void;
  centerSelected: () => void;
  nudgeSelected: (dx: number, dy: number) => void;
  editSelectedText: (edit: (text: string) => string) => boolean;
}

export function useObjectOps(
  page: Page | null,
  cal: Calibration | null,
  selectedIds: string[],
  setPage: React.Dispatch<React.SetStateAction<Page | null>>,
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>,
  persist: (pageId: string, objects: SceneObject[]) => void,
  fail: (e: any) => void,
  warnMissingGlyphs: (missing: string[]) => void,
  defaultText: string,
  sizeLinked: boolean,
): ObjectOps {
  const { t } = useI18n();
  const latestPage = useRef(page); latestPage.current = page;
  const [processing, setProcessing] = useState(0);
  const stylePending = useRef(new Map<string, { style: VectorStyle; token: number }>());
  const textSequence = useRef(new Map<string, number>());
  const sequence = useRef(0);
  const commitAsync = (target: Page, replacements: Map<string, { before: SceneObject; after: SceneObject | null; geometryOnly?: boolean }>) => {
    const current = latestPage.current?.id === target.id ? latestPage.current : cachedPage(target.id);
    if (!current) return;
    let changed = false, skipped = false;
    const objects = current.objects.flatMap((object) => {
      const replacement = replacements.get(object.id);
      if (!replacement) return [object];
      const { before, after, geometryOnly } = replacement;
      if (object.plotted || object.data !== before.data || object.cachedPolylines !== before.cachedPolylines || (!geometryOnly && object.transform !== before.transform)) { skipped = true; return [object]; }
      changed = true;
      return after ? [{ ...after, transform: geometryOnly ? object.transform : after.transform }] : [];
    });
    if (skipped) fail(new Error(t("paint.editChanged")));
    if (!changed) return;
    if (latestPage.current?.id === target.id) {
      undoStack.current.push(cloneObjects(current.objects)); redoStack.current = []; syncHistory();
      latestPage.current = { ...current, objects }; setPage(latestPage.current);
      setSelectedIds((ids) => ids.filter((id) => objects.some((obj) => obj.id === id)));
    }
    queueObjects(target.id, objects);
  };
  const undoStack = useRef<SceneObject[][]>([]);
  const redoStack = useRef<SceneObject[][]>([]);
  const clipboard = useRef<SceneObject[]>([]);
  const draftTextRef = useRef<string | null>(null);
  const textDraftTimer = useRef<number | undefined>(undefined);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const [clipboardCount, setClipboardCount] = useState(0);
  const [draftText, setDraftText] = useState<string | null>(null);

  const syncHistory = () => {
    trimHistory(undoStack.current, redoStack.current);
    setHistory({ undo: undoStack.current.length, redo: redoStack.current.length });
  };

  const resetHistory = () => {
    undoStack.current = [];
    redoStack.current = [];
    syncHistory();
  };

  // Reset draft text whenever the selected object changes.
  useEffect(() => {
    const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
    const obj = selectedId
      ? page?.objects.find((o) => o.id === selectedId && o.type === "text")
      : null;
    clearTimeout(textDraftTimer.current);
    if (obj) {
      const txt = String(obj.data?.text ?? defaultText);
      draftTextRef.current = txt;
      setDraftText(txt);
    } else {
      draftTextRef.current = null;
      setDraftText(null);
    }
  }, [selectedIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const remember = () => {
    if (!page) return;
    undoStack.current.push(cloneObjects(page.objects));
    redoStack.current = [];
    syncHistory();
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

  const appendPrepared = (target: Page, prepared: SceneObject[]) => {
    const current = latestPage.current?.id === target.id ? latestPage.current : cachedPage(target.id);
    if (!current) return;
    let nextZ = current.objects.reduce((max, o, i) => Math.max(max, zValue(o, i)), -1) + 1;
    const added = prepared.filter((obj) => !current.objects.some((o) => o.id === obj.id)).map((obj) => ({ ...obj, zOrder: nextZ++ }));
    if (!added.length) return;
    const objects = [...current.objects, ...added];
    rememberPage(current);
    if (latestPage.current?.id === target.id) {
      undoStack.current.push(cloneObjects(current.objects)); redoStack.current = []; syncHistory();
      latestPage.current = { ...current, objects }; setPage(latestPage.current);
      setSelectedIds(added.map((obj) => obj.id));
    }
    queueObjects(target.id, objects);
  };

  const addObjects = (objs: SceneObject[]) => {
    if (!page || !objs.length) return;
    rememberPage(page);
    if (objs.every((obj) => keepsStrokeFeeds(objectStyle(obj)))) {
      appendPrepared(page, objs.map(withStyledCache));
      return;
    }
    const release = retainPage(page);
    setProcessing((n) => n + 1);
    Promise.all(objs.map(async (obj) => {
      const base = basePolylines(obj), style = objectStyle(obj);
      const geometry = await geometryTask<Pt[][]>({ kind: "style", lines: base, style });
      return { ...obj, data: { ...obj.data, basePolylines: base, style,
        cachedSegmentPressures: undefined, pressureEnabled: false }, cachedPolylines: geometry,
        cachedFeeds: keepsStrokeFeeds(style) ? obj.cachedFeeds : undefined };
    })).then((prepared) => appendPrepared(page, prepared)).catch(fail)
      .finally(() => { release(); setProcessing((n) => n - 1); });
  };
  const addObject = (obj: SceneObject) => addObjects([obj]);

  const eraseAcrossObjects = async (path: Pt[], mode: "free" | "line", radius: number) => {
    if (!page || path.length < 2) return;
    const release = retainPage(page);
    setProcessing((n) => n + 1);
    try {
      const replacements = new Map<string, { before: SceneObject; after: SceneObject | null }>();
      for (const obj of page.objects) {
        if (obj.plotted) continue;
        const local = (obj.cachedPolylines as Pt[][] | undefined) ?? basePolylines(obj);
        if (!local.length) continue;
        const transform = obj.transform ?? IDENTITY;
        const erased = await geometryTask<Pt[][]>({ kind: "erase", lines: local, transform, path, mode, radius });
        // Comparison is only on commit, never on pointer movement.
        if (samePolylines(erased, transformPolylines(local, transform))) continue;
        const { local: nextLocal, cx, cy } = localize(erased);
        const pressure = remapSegmentPressures(
          transformPolylines(basePolylines(obj), transform),
          validSegmentPressures(basePolylines(obj), obj.data?.baseSegmentPressures), erased,
        );
        replacements.set(obj.id, { before: obj, after: erased.length ? {
          ...obj, data: { ...(obj.data ?? {}), basePolylines: nextLocal,
            baseSegmentPressures: pressure, cachedSegmentPressures: pressure }, cachedPolylines: nextLocal,
          transform: { x: cx, y: cy, rotation: 0, scale: 1 },
        } : null });
      }
      commitAsync(page, replacements);
    } catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) fail(e); }
    finally { release(); setProcessing((n) => n - 1); }
  };

  const updateTextObject = (id: string, patch: Partial<{ text: string; size: number; font: TextFont }>) => {
    if (!page) return;
    const obj = page.objects.find((o) => o.id === id);
    if (!obj) return;
    const data = {
      text: String(obj.data?.text ?? defaultText),
      mode: "single-line",
      size: Number(obj.data?.size ?? 12),
      font: (obj.data?.font ?? "sans") as TextFont,
      // Keep a stable variant seed; older objects (and the default font) may not
      // have one yet, so mint it lazily the first time they are edited.
      seed: Number(obj.data?.seed ?? randomTextSeed()),
      ...patch,
    };
    const token = ++sequence.current;
    textSequence.current.set(id, token);
    const release = retainPage(page);
    setProcessing((n) => n + 1);
    textGeometryAsync(data.text, data.size, data.font, defaultText, false, data.seed)
      .then(async ({ local, feeds, missing }) => {
        if (missing?.length) warnMissingGlyphs(missing);
        const style = objectStyle(obj);
        const geometry = await geometryTask<Pt[][]>({ kind: "style", lines: local, style });
        if (textSequence.current.get(id) !== token) return;
        commitAsync(page, new Map([[id, { before: obj, geometryOnly: true, after: {
          ...obj, plotted: false, data: { ...data, basePolylines: local, style },
          cachedPolylines: geometry, cachedFeeds: keepsStrokeFeeds(style) ? feeds : undefined,
        } }]]));
      }).catch(fail).finally(() => { release(); setProcessing((n) => n - 1); });
  };

  const onTextInput = (id: string, text: string) => {
    draftTextRef.current = text;
    setDraftText(text);
    clearTimeout(textDraftTimer.current);
    textDraftTimer.current = window.setTimeout(() => updateTextObject(id, { text }), 350);
  };

  const onFontOrSizeChange = (id: string, patch: Partial<{ text: string; size: number; font: TextFont }>) => {
    clearTimeout(textDraftTimer.current);
    const textPatch = draftTextRef.current !== null ? { text: draftTextRef.current } : {};
    updateTextObject(id, { ...textPatch, ...patch });
  };

  // Applies a text edit without triggering a backend render on every keystroke.
  // Returns true if there was a text object selected (so the caller can preventDefault).
  const editSelectedText = (edit: (text: string) => string): boolean => {
    if (!page || selectedIds.length !== 1) return false;
    const obj = page.objects.find((o) => o.id === selectedIds[0]);
    if (!obj || obj.type !== "text") return false;
    const current = draftTextRef.current ?? String(obj.data?.text ?? defaultText);
    const next = edit(current);
    onTextInput(obj.id, next);
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

  const updateSelectedStyle = async (patch: Partial<VectorStyle>) => {
    if (!page || selectedIds.length === 0) return;
    const selected = new Set(selectedIds);
    const release = retainPage(page);
    setProcessing((n) => n + 1);
    try {
      const replacements = new Map<string, { before: SceneObject; after: SceneObject; geometryOnly: boolean }>();
      await Promise.all(page.objects.filter((obj) => selected.has(obj.id)).map(async (obj) => {
        const previous = stylePending.current.get(obj.id)?.style ?? objectStyle(obj);
        const style = normalizeStyle({ ...previous, ...patch,
          stroke: { ...previous.stroke, ...patch.stroke }, fill: { ...previous.fill, ...patch.fill } });
        const token = ++sequence.current;
        stylePending.current.set(obj.id, { style, token });
        const base = basePolylines(obj);
        const geometry = await geometryTask<Pt[][]>({ kind: "style", lines: base, style }, `style:${obj.id}`).catch((error) => {
          if (stylePending.current.get(obj.id)?.token === token) stylePending.current.delete(obj.id);
          throw error;
        });
        if (stylePending.current.get(obj.id)?.token !== token) return;
        stylePending.current.delete(obj.id);
        replacements.set(obj.id, { before: obj, geometryOnly: true, after: {
          ...obj, plotted: false, data: { ...(obj.data ?? {}), basePolylines: base, style,
            cachedSegmentPressures: keepsStrokeFeeds(style) ? validSegmentPressures(base, obj.data?.baseSegmentPressures) : undefined,
            pressureEnabled: keepsStrokeFeeds(style) ? obj.data?.pressureEnabled : false },
          cachedPolylines: geometry, cachedFeeds: keepsStrokeFeeds(style) ? obj.cachedFeeds : undefined,
        } });
      }));
      commitAsync(page, replacements);
    } catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) fail(e); }
    finally { release(); setProcessing((n) => n - 1); }
  };

  const setSelectedPressureEnabled = async (enabled: boolean) => {
    if (!page || selectedIds.length !== 1) return;
    const obj = page.objects.find((o) => o.id === selectedIds[0]);
    if (!obj || obj.plotted) return;
    const release = retainPage(page);
    setProcessing((n) => n + 1);
    try {
      const base = basePolylines(obj);
      let pressures = validSegmentPressures(base, obj.data?.baseSegmentPressures);
      if (enabled) {
        if (!(cal && (cal.pen_pressure_max_depth ?? 0) > 0)) throw new Error(t("paint.pressure.configure"));
        if (!keepsStrokeFeeds(objectStyle(obj))) throw new Error(t("paint.pressure.solidOnly"));
        if (!samePolylines(base, (obj.cachedPolylines ?? []) as Pt[][])) throw new Error(t("paint.pressure.changedGeometry"));
        if (!hasPressureSamples(pressures) && obj.data?.galleryId) {
          const original = await api.galleryStrokes(obj.data.galleryId, obj.data.galleryPage ?? 1);
          const originalLocal = original.polylines.map((line) => line.map(([x, y]) =>
            [x - original.width / 2, y - original.height / 2] as Pt));
          if (!samePolylines(base, originalLocal)) throw new Error(t("paint.pressure.changedGeometry"));
          pressures = validSegmentPressures(base, original.segmentPressures);
        }
        if (!hasPressureSamples(pressures)) throw new Error(t("paint.pressure.noData"));
      }
      commitAsync(page, new Map([[obj.id, { before: obj, geometryOnly: true, after: {
        ...obj, data: { ...obj.data, baseSegmentPressures: pressures,
          cachedSegmentPressures: keepsStrokeFeeds(objectStyle(obj)) ? pressures : undefined, pressureEnabled: enabled },
      } }]]));
    } catch (e) { fail(e); }
    finally { release(); setProcessing((n) => n - 1); }
  };

  const groupSelected = (ids = selectedIds) => {
    if (!page || ids.length < 2) return;
    remember();
    const selected = new Set(ids);
    const groupId = crypto.randomUUID();
    const objects = page.objects.map((obj) => (selected.has(obj.id) ? { ...obj, groupId } : obj));
    setPage({ ...page, objects });
    setSelectedIds(ids);
    persist(page.id, objects);
  };

  const ungroupSelected = (ids = selectedIds) => {
    if (!page || ids.length === 0) return;
    const selected = new Set(ids);
    const groupIds = new Set(
      page.objects
        .filter((obj) => selected.has(obj.id) && obj.groupId)
        .map((obj) => obj.groupId),
    );
    if (groupIds.size === 0) return;
    remember();
    const objects = page.objects.map((obj) =>
      groupIds.has(obj.groupId) ? { ...obj, groupId: undefined } : obj,
    );
    setPage({ ...page, objects });
    setSelectedIds(page.objects.filter((obj) => groupIds.has(obj.groupId)).map((obj) => obj.id));
    persist(page.id, objects);
  };

  const applyMaskStamp = (maskId: string) => {
    if (!page) return;
    const maskObj = page.objects.find((o) => o.id === maskId);
    if (!maskObj || !isMaskObject(maskObj)) return;
    const poly = maskPolygon(maskObj);
    if (!poly || poly.length < 3) return;
    const maskZ = zValue(maskObj, page.objects.indexOf(maskObj));
    remember();
    const nextObjects: typeof page.objects = [];
    for (let idx = 0; idx < page.objects.length; idx++) {
      const obj = page.objects[idx];
      if (obj.id === maskId) continue;
      if (obj.plotted || isMaskObject(obj)) { nextObjects.push(obj); continue; }
      if (zValue(obj, idx) >= maskZ) { nextObjects.push(obj); continue; }
      const world = transformPolylines((obj.cachedPolylines ?? []) as Pt[][], obj.transform ?? IDENTITY);
      const clipped = world.flatMap((line) => subtractPolygon(line, poly)).filter((l) => l.length >= 2);
      if (clipped.length === 0) continue;
      const { local: nextLocal, cx, cy } = localize(clipped);
      const pressure = remapSegmentPressures(
        transformPolylines(basePolylines(obj), obj.transform ?? IDENTITY),
        validSegmentPressures(basePolylines(obj), obj.data?.baseSegmentPressures), clipped,
      );
      nextObjects.push({
        ...obj,
        data: { ...(obj.data ?? {}), basePolylines: nextLocal,
          baseSegmentPressures: pressure, cachedSegmentPressures: pressure },
        cachedPolylines: nextLocal,
        transform: { x: cx, y: cy, scale: 1, rotation: 0 },
      });
    }
    setSelectedIds([]);
    setPage({ ...page, objects: nextObjects });
    persist(page.id, nextObjects);
  };

  const convertSelectedToLines = () => {
    if (!page || selectedIds.length === 0) return;
    const sel = new Set(selectedIds);
    const targetIds = new Set(
      page.objects.filter((o) => sel.has(o.id) && !o.plotted).map((o) => o.id),
    );
    if (!targetIds.size) return;
    const sorted = page.objects
      .map((obj, i) => ({ obj, i }))
      .sort((a, b) => zValue(a.obj, a.i) - zValue(b.obj, b.i))
      .map(({ obj }) => obj);
    const allConverted: SceneObject[] = [];
    const nextSorted: SceneObject[] = [];
    for (const obj of sorted) {
      if (!targetIds.has(obj.id)) { nextSorted.push(obj); continue; }
      const local = ((obj.cachedPolylines as Pt[][] | undefined) ?? basePolylines(obj)).filter((l) => l.length >= 2);
      if (!local.length) continue;
      const world = transformPolylines(local, obj.transform ?? IDENTITY);
      const pressure = remapSegmentPressures(transformPolylines(basePolylines(obj), obj.transform ?? IDENTITY),
        validSegmentPressures(basePolylines(obj), obj.data?.baseSegmentPressures), world);
      for (let lineIndex = 0; lineIndex < world.length; lineIndex++) {
        const line = world[lineIndex];
        const { local: nextLocal, cx, cy } = localize([line]);
        const newObj: SceneObject = {
          id: crypto.randomUUID(),
          type: "pen",
          data: { basePolylines: nextLocal, style: DEFAULT_VECTOR_STYLE,
            ...(pressure?.[lineIndex] ? { baseSegmentPressures: [pressure[lineIndex]],
              cachedSegmentPressures: [pressure[lineIndex]], pressureEnabled: obj.data?.pressureEnabled === true, strokeOrder: "source" } : {}) },
          cachedPolylines: nextLocal,
          transform: { x: cx, y: cy, rotation: 0, scale: 1 },
          plotted: false,
        };
        nextSorted.push(newObj);
        allConverted.push(newObj);
      }
    }
    if (!allConverted.length) return;
    remember();
    const objects = nextSorted.map((obj, zOrder) => ({ ...obj, zOrder }));
    setPage({ ...page, objects });
    setSelectedIds(allConverted.map((o) => o.id));
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
        ? groupMap.get(obj.groupId) ??
          groupMap.set(obj.groupId, crypto.randomUUID()).get(obj.groupId)
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
    const movable =
      dir < 0
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

  const markPlotted = (ids: string[]) => {
    if (!page) return;
    const sel = new Set(ids);
    const objects = page.objects.map((o) => (sel.has(o.id) ? { ...o, plotted: true } : o));
    setPage({ ...page, objects });
    persist(page.id, objects);
  };

  const selectionBounds = (): [number, number, number, number] | null => {
    if (!page || selectedIds.length === 0) return null;
    const sel = new Set(selectedIds);
    let b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const obj of page.objects) {
      if (!sel.has(obj.id)) continue;
      const local = sourcePageFrame(obj) ?? ((obj.cachedPolylines as Pt[][] | undefined) ?? basePolylines(obj));
      if (!local.length) continue;
      const [x0, y0, x1, y1] = objectWorldBounds(local, obj.transform ?? IDENTITY);
      b = [Math.min(b[0], x0), Math.min(b[1], y0), Math.max(b[2], x1), Math.max(b[3], y1)];
    }
    return Number.isFinite(b[0]) ? b : null;
  };

  const objectLocalSize = (
    obj: SceneObject,
  ): { width: number; height: number; localWidth: number; localHeight: number } | null => {
    const local = sourcePageFrame(obj) ?? ((obj.cachedPolylines as Pt[][] | undefined) ?? basePolylines(obj));
    if (!local.length) return null;
    const [x0, y0, x1, y1] = localBounds(local);
    const t = obj.transform ?? IDENTITY;
    const sx = Math.abs(t.scaleX ?? t.scale);
    const sy = Math.abs(t.scaleY ?? t.scale);
    const localWidth = Math.max(x1 - x0, 0);
    const localHeight = Math.max(y1 - y0, 0);
    return { width: localWidth * sx, height: localHeight * sy, localWidth, localHeight };
  };

  const setSelectedObjectSize = (axis: "width" | "height", target: number) => {
    if (!page || selectedIds.length !== 1 || !Number.isFinite(target) || target <= 0) return;
    const obj = page.objects.find((o) => o.id === selectedIds[0]);
    if (!obj) return;
    const size = objectLocalSize(obj);
    if (!size) return;
    const current = axis === "width" ? size.width : size.height;
    const base = axis === "width" ? size.localWidth : size.localHeight;
    const linked = sizeLinked || !!sourcePageFrame(obj);
    if ((linked && current <= 0) || (!linked && base <= 0)) return;
    remember();
    const objects = page.objects.map((o) => {
      if (o.id !== obj.id) return o;
      const t = o.transform ?? IDENTITY;
      const sx = t.scaleX ?? t.scale;
      const sy = t.scaleY ?? t.scale;
      const factor = linked ? target / current : 1;
      const nextSx = linked
        ? sx * factor
        : axis === "width"
          ? Math.sign(sx || 1) * (target / base)
          : sx;
      const nextSy = linked
        ? sy * factor
        : axis === "height"
          ? Math.sign(sy || 1) * (target / base)
          : sy;
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
        : o,
    );
    setPage({ ...page, objects });
    persist(page.id, objects);
  };

  const changeSelectedImage = (change: (obj: SceneObject) => SceneObject | null) => {
    if (!page || selectedIds.length !== 1) return;
    const obj = page.objects.find((o) => o.id === selectedIds[0]);
    if (!obj || obj.plotted) return;
    const next = change(obj);
    if (!next) return;
    remember();
    const objects = page.objects.map((item) => item.id === obj.id ? next : item);
    setPage({ ...page, objects });
    persist(page.id, objects);
  };

  const trimSelectedImage = (sides: TrimSide[]) =>
    changeSelectedImage((obj) => trimImageBlankEdges(obj, sides));

  const resetSelectedImageTrim = () =>
    changeSelectedImage(resetImageBlankEdges);

  const mapSelected = (fn: (t: Transform) => Transform) => {
    if (!page || selectedIds.length === 0) return;
    remember();
    const sel = new Set(selectedIds);
    const objects = page.objects.map((o) =>
      sel.has(o.id) && o.transform ? { ...o, transform: fn(o.transform) } : o,
    );
    setPage({ ...page, objects });
    persist(page.id, objects);
  };

  const fitSelected = () => {
    const b = selectionBounds();
    if (!b || !cal) return;
    const w = Math.max(b[2] - b[0], 0.001);
    const h = Math.max(b[3] - b[1], 0.001);
    const W = cal.plot_width, H = cal.plot_height;
    const factor = Math.min((W * 0.95) / w, (H * 0.95) / h);
    const gcx = (b[0] + b[2]) / 2, gcy = (b[1] + b[3]) / 2;
    // Scale in place around the selection's own center; shift only as far as
    // needed to keep the grown bounds on the sheet (no recentering).
    const nx0 = gcx + (b[0] - gcx) * factor, nx1 = gcx + (b[2] - gcx) * factor;
    const ny0 = gcy + (b[1] - gcy) * factor, ny1 = gcy + (b[3] - gcy) * factor;
    const dx = nx0 < 0 ? -nx0 : nx1 > W ? W - nx1 : 0;
    const dy = ny0 < 0 ? -ny0 : ny1 > H ? H - ny1 : 0;
    mapSelected((t) => {
      const next: Transform = {
        ...t,
        x: gcx + (t.x - gcx) * factor + dx,
        y: gcy + (t.y - gcy) * factor + dy,
        scale: (t.scale ?? 1) * factor,
      };
      if (t.scaleX != null) next.scaleX = t.scaleX * factor;
      if (t.scaleY != null) next.scaleY = t.scaleY * factor;
      return next;
    });
  };

  const centerSelected = () => {
    const b = selectionBounds();
    if (!b || !cal) return;
    const dx = cal.plot_width / 2 - (b[0] + b[2]) / 2;
    const dy = cal.plot_height / 2 - (b[1] + b[3]) / 2;
    mapSelected((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
  };

  const nudgeSelected = (dx: number, dy: number) => {
    if (!page || selectedIds.length === 0) return;
    const sel = new Set(selectedIds);
    const objects = page.objects.map((o) =>
      sel.has(o.id) && o.transform
        ? { ...o, transform: { ...o.transform, x: o.transform.x + dx, y: o.transform.y + dy } }
        : o,
    );
    setPage({ ...page, objects });
    persist(page.id, objects);
  };

  return {
    processing: processing > 0,
    pendingStyle: selectedIds.length ? stylePending.current.get(selectedIds[0])?.style : undefined,
    history,
    clipboardCount,
    draftText,
    resetHistory,
    remember,
    undo,
    redo,
    addObject,
    addObjects,
    eraseAcrossObjects,
    updateTextObject,
    onTextInput,
    onFontOrSizeChange,
    editSelectedText,
    deleteSelected,
    updateSelectedStyle,
    setSelectedPressureEnabled,
    groupSelected,
    ungroupSelected,
    applyMaskStamp,
    convertSelectedToLines,
    copySelected,
    cutSelected,
    pasteObjects,
    duplicateSelected,
    moveSelected,
    markPlotted,
    selectionBounds,
    objectLocalSize,
    setSelectedObjectSize,
    setSelectedObjectRotation,
    trimSelectedImage,
    resetSelectedImageTrim,
    mapSelected,
    fitSelected,
    centerSelected,
    nudgeSelected,
  };
}
