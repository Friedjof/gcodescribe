import { useRef } from "react";
import { api, type SceneObject } from "../../../../api";
import { rememberPage, retainPage } from "../../../../api/pageEdits";
import { samePolylines } from "../../lib/eraser";
import { IDENTITY, localize, transformPolylines, type Pt } from "../../lib/geometry";
import { isMaskObject, maskPolygon, subtractPolygon } from "../../lib/masks";
import { basePolylines, keepsStrokeFeeds, objectStyle, withStyledCache, zValue } from "../../lib/sceneObjects";
import { DEFAULT_VECTOR_STYLE, normalizeStyle, type VectorStyle, } from "../../lib/styling";
import { geometryTask } from "../../lib/geometryTasks";
import { hasPressureSamples, remapSegmentPressures, validSegmentPressures } from "../../lib/pressure";
import type { ObjectCommandContext } from "./useObjectCommandContext";
import type { ClipResult } from "../../lib/clipToPlot";
export function useGeometryCommands(context: ObjectCommandContext) {
    const { page, cal, selectedIds, setPage, setSelectedIds, persist, remember, appendPrepared, setProcessing, commitAsync, fail, t } = context;
    const stylePending = useRef(new Map<string, {
        style: VectorStyle;
        token: number;
    }>());
    const sequence = useRef(0);
    const latestCalibration = useRef(cal); latestCalibration.current = cal;
    const clipToPlot = async () => {
        if (!page || !cal || context.processing) return false;
        const release = retainPage(page);
        setProcessing(n => n + 1);
        try {
            const replacements = new Map<string, { before: SceneObject; after: SceneObject | null }>();
            for (const obj of page.objects) {
                if (obj.plotted || isMaskObject(obj)) continue;
                const lines = (obj.cachedPolylines ?? basePolylines(obj)) as Pt[][];
                const result = await geometryTask<ClipResult>({ kind: "clip", lines,
                    transform: obj.transform ?? IDENTITY, width: cal.plot_width, height: cal.plot_height,
                    pressures: validSegmentPressures(lines, obj.data?.cachedSegmentPressures)
                        ?? validSegmentPressures(lines, obj.data?.baseSegmentPressures), feeds: obj.cachedFeeds });
                if (!result.changed) continue;
                replacements.set(obj.id, { before: obj, after: result.lines.length ? {
                    ...obj, type: "freehand", transform: { ...IDENTITY }, cachedPolylines: result.lines,
                    cachedFeeds: result.feeds, data: { basePolylines: result.lines, style: DEFAULT_VECTOR_STYLE,
                        baseSegmentPressures: result.pressures, cachedSegmentPressures: result.pressures,
                        pressureEnabled: obj.data?.pressureEnabled, strokeOrder: obj.data?.strokeOrder,
                        template: obj.data?.template, name: obj.data?.name },
                } : null });
            }
            if (context.latestPage.current?.id === page.id && (
                latestCalibration.current?.plot_width !== cal.plot_width || latestCalibration.current?.plot_height !== cal.plot_height
            )) throw new Error(t("paint.clipAreaChanged"));
            return replacements.size ? commitAsync(page, replacements) : true;
        } catch (error) { fail(error); return false; }
        finally { release(); setProcessing(n => n - 1); }
    };
    const addObjects = (objs: SceneObject[]) => {
        if (!page || !objs.length)
            return;
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
        if (!page || path.length < 2)
            return;
        const release = retainPage(page);
        setProcessing((n) => n + 1);
        try {
            const replacements = new Map<string, {
                before: SceneObject;
                after: SceneObject | null;
            }>();
            for (const obj of page.objects) {
                if (obj.plotted)
                    continue;
                const local = (obj.cachedPolylines as Pt[][] | undefined) ?? basePolylines(obj);
                if (!local.length)
                    continue;
                const transform = obj.transform ?? IDENTITY;
                const erased = await geometryTask<Pt[][]>({ kind: "erase", lines: local, transform, path, mode, radius });
                // Comparison is only on commit, never on pointer movement.
                if (samePolylines(erased, transformPolylines(local, transform)))
                    continue;
                const { local: nextLocal, cx, cy } = localize(erased);
                const pressure = remapSegmentPressures(transformPolylines(basePolylines(obj), transform), validSegmentPressures(basePolylines(obj), obj.data?.baseSegmentPressures), erased);
                replacements.set(obj.id, { before: obj, after: erased.length ? {
                        ...obj, data: { ...(obj.data ?? {}), basePolylines: nextLocal,
                            baseSegmentPressures: pressure, cachedSegmentPressures: pressure }, cachedPolylines: nextLocal,
                        transform: { x: cx, y: cy, rotation: 0, scale: 1 },
                    } : null });
            }
            commitAsync(page, replacements);
        }
        catch (e) {
            if (!(e instanceof DOMException && e.name === "AbortError"))
                fail(e);
        }
        finally {
            release();
            setProcessing((n) => n - 1);
        }
    };
    const updateSelectedStyle = async (patch: Partial<VectorStyle>) => {
        if (!page || selectedIds.length === 0)
            return;
        const selected = new Set(selectedIds);
        const release = retainPage(page);
        setProcessing((n) => n + 1);
        try {
            const replacements = new Map<string, {
                before: SceneObject;
                after: SceneObject;
                geometryOnly: boolean;
            }>();
            await Promise.all(page.objects.filter((obj) => selected.has(obj.id)).map(async (obj) => {
                const previous = stylePending.current.get(`${page.id}:${obj.id}`)?.style ?? objectStyle(obj);
                const style = normalizeStyle({ ...previous, ...patch,
                    stroke: { ...previous.stroke, ...patch.stroke }, fill: { ...previous.fill, ...patch.fill } });
                const token = ++sequence.current;
                stylePending.current.set(`${page.id}:${obj.id}`, { style, token });
                const base = basePolylines(obj);
                const geometry = await geometryTask<Pt[][]>({ kind: "style", lines: base, style }, `style:${page.id}:${obj.id}`).catch((error) => {
                    if (stylePending.current.get(`${page.id}:${obj.id}`)?.token === token)
                        stylePending.current.delete(`${page.id}:${obj.id}`);
                    throw error;
                });
                if (stylePending.current.get(`${page.id}:${obj.id}`)?.token !== token)
                    return;
                stylePending.current.delete(`${page.id}:${obj.id}`);
                replacements.set(obj.id, { before: obj, geometryOnly: true, after: {
                        ...obj, plotted: false, data: { ...(obj.data ?? {}), basePolylines: base, style,
                            cachedSegmentPressures: keepsStrokeFeeds(style) ? validSegmentPressures(base, obj.data?.baseSegmentPressures) : undefined,
                            pressureEnabled: keepsStrokeFeeds(style) ? obj.data?.pressureEnabled : false },
                        cachedPolylines: geometry, cachedFeeds: keepsStrokeFeeds(style) ? obj.cachedFeeds : undefined,
                    } });
            }));
            commitAsync(page, replacements);
        }
        catch (e) {
            if (!(e instanceof DOMException && e.name === "AbortError"))
                fail(e);
        }
        finally {
            release();
            setProcessing((n) => n - 1);
        }
    };
    const setSelectedPressureEnabled = async (enabled: boolean) => {
        if (!page || selectedIds.length !== 1)
            return;
        const obj = page.objects.find((o) => o.id === selectedIds[0]);
        if (!obj || obj.plotted)
            return;
        const release = retainPage(page);
        setProcessing((n) => n + 1);
        try {
            const base = basePolylines(obj);
            let pressures = validSegmentPressures(base, obj.data?.baseSegmentPressures);
            if (enabled) {
                if (!(cal && (cal.pen_pressure_max_depth ?? 0) > 0))
                    throw new Error(t("paint.pressure.configure"));
                if (!keepsStrokeFeeds(objectStyle(obj)))
                    throw new Error(t("paint.pressure.solidOnly"));
                if (!samePolylines(base, (obj.cachedPolylines ?? []) as Pt[][]))
                    throw new Error(t("paint.pressure.changedGeometry"));
                if (!hasPressureSamples(pressures) && obj.data?.galleryId) {
                    const original = await api.galleryStrokes(obj.data.galleryId, obj.data.galleryPage ?? 1);
                    const originalLocal = original.polylines.map((line) => line.map(([x, y]) => [x - original.width / 2, y - original.height / 2] as Pt));
                    if (!samePolylines(base, originalLocal))
                        throw new Error(t("paint.pressure.changedGeometry"));
                    pressures = validSegmentPressures(base, original.segmentPressures);
                }
                if (!hasPressureSamples(pressures))
                    throw new Error(t("paint.pressure.noData"));
            }
            commitAsync(page, new Map([[obj.id, { before: obj, geometryOnly: true, after: {
                            ...obj, data: { ...obj.data, baseSegmentPressures: pressures,
                                cachedSegmentPressures: keepsStrokeFeeds(objectStyle(obj)) ? pressures : undefined, pressureEnabled: enabled },
                        } }]]));
        }
        catch (e) {
            fail(e);
        }
        finally {
            release();
            setProcessing((n) => n - 1);
        }
    };
    const applyMaskStamp = (maskId: string) => {
        if (!page)
            return;
        const maskObj = page.objects.find((o) => o.id === maskId);
        if (!maskObj || !isMaskObject(maskObj))
            return;
        const poly = maskPolygon(maskObj);
        if (!poly || poly.length < 3)
            return;
        const maskZ = zValue(maskObj, page.objects.indexOf(maskObj));
        remember();
        const nextObjects: typeof page.objects = [];
        for (let idx = 0; idx < page.objects.length; idx++) {
            const obj = page.objects[idx];
            if (obj.id === maskId)
                continue;
            if (obj.plotted || isMaskObject(obj)) {
                nextObjects.push(obj);
                continue;
            }
            if (zValue(obj, idx) >= maskZ) {
                nextObjects.push(obj);
                continue;
            }
            const world = transformPolylines((obj.cachedPolylines ?? []) as Pt[][], obj.transform ?? IDENTITY);
            const clipped = world.flatMap((line) => subtractPolygon(line, poly)).filter((l) => l.length >= 2);
            if (clipped.length === 0)
                continue;
            const { local: nextLocal, cx, cy } = localize(clipped);
            const pressure = remapSegmentPressures(transformPolylines(basePolylines(obj), obj.transform ?? IDENTITY), validSegmentPressures(basePolylines(obj), obj.data?.baseSegmentPressures), clipped);
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
        if (!page || selectedIds.length === 0)
            return;
        const sel = new Set(selectedIds);
        const targetIds = new Set(page.objects.filter((o) => sel.has(o.id) && !o.plotted).map((o) => o.id));
        if (!targetIds.size)
            return;
        const sorted = page.objects
            .map((obj, i) => ({ obj, i }))
            .sort((a, b) => zValue(a.obj, a.i) - zValue(b.obj, b.i))
            .map(({ obj }) => obj);
        const allConverted: SceneObject[] = [];
        const nextSorted: SceneObject[] = [];
        for (const obj of sorted) {
            if (!targetIds.has(obj.id)) {
                nextSorted.push(obj);
                continue;
            }
            const local = ((obj.cachedPolylines as Pt[][] | undefined) ?? basePolylines(obj)).filter((l) => l.length >= 2);
            if (!local.length)
                continue;
            const world = transformPolylines(local, obj.transform ?? IDENTITY);
            const pressure = remapSegmentPressures(transformPolylines(basePolylines(obj), obj.transform ?? IDENTITY), validSegmentPressures(basePolylines(obj), obj.data?.baseSegmentPressures), world);
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
        if (!allConverted.length)
            return;
        remember();
        const objects = nextSorted.map((obj, zOrder) => ({ ...obj, zOrder }));
        setPage({ ...page, objects });
        setSelectedIds(allConverted.map((o) => o.id));
        persist(page.id, objects);
    };
    return { addObjects, addObject, eraseAcrossObjects, updateSelectedStyle, setSelectedPressureEnabled,
        applyMaskStamp, convertSelectedToLines, clipToPlot,
        pendingStyle: selectedIds.length ? stylePending.current.get(`${page?.id}:${selectedIds[0]}`)?.style : undefined };
}
