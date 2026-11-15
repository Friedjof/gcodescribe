import { useRef, useState } from "react";
import { type SceneObject } from "../../../../api";
import { cloneObjects, zValue } from "../../lib/sceneObjects";
import type { ObjectCommandContext } from "./useObjectCommandContext";
export function useSelectionCommands(context: ObjectCommandContext) {
    const { page, selectedIds, setPage, setSelectedIds, persist, remember } = context;
    const clipboard = useRef<SceneObject[]>([]);
    const [clipboardCount, setClipboardCount] = useState(0);
    const deleteSelected = () => {
        if (!page || selectedIds.length === 0)
            return;
        remember();
        const selected = new Set(selectedIds);
        const objects = page.objects.filter((o) => !selected.has(o.id));
        setPage({ ...page, objects });
        setSelectedIds([]);
        persist(page.id, objects);
    };
    const groupSelected = (ids = selectedIds) => {
        if (!page || ids.length < 2)
            return;
        remember();
        const selected = new Set(ids);
        const groupId = crypto.randomUUID();
        const objects = page.objects.map((obj) => (selected.has(obj.id) ? { ...obj, groupId } : obj));
        setPage({ ...page, objects });
        setSelectedIds(ids);
        persist(page.id, objects);
    };
    const ungroupSelected = (ids = selectedIds) => {
        if (!page || ids.length === 0)
            return;
        const selected = new Set(ids);
        const groupIds = new Set(page.objects
            .filter((obj) => selected.has(obj.id) && obj.groupId)
            .map((obj) => obj.groupId));
        if (groupIds.size === 0)
            return;
        remember();
        const objects = page.objects.map((obj) => groupIds.has(obj.groupId) ? { ...obj, groupId: undefined } : obj);
        setPage({ ...page, objects });
        setSelectedIds(page.objects.filter((obj) => groupIds.has(obj.groupId)).map((obj) => obj.id));
        persist(page.id, objects);
    };
    const copySelected = () => {
        if (!page || selectedIds.length === 0)
            return;
        const selected = new Set(selectedIds);
        clipboard.current = cloneObjects(page.objects.filter((obj) => selected.has(obj.id)));
        setClipboardCount(clipboard.current.length);
    };
    const cutSelected = () => {
        if (!page || selectedIds.length === 0)
            return;
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
        if (!page || source.length === 0)
            return;
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
        if (!page || selectedIds.length === 0)
            return;
        const selected = new Set(selectedIds);
        pasteObjects(page.objects.filter((obj) => selected.has(obj.id)));
    };
    const moveSelected = (dir: -1 | 1) => {
        if (!page || selectedIds.length === 0)
            return;
        const selected = new Set(selectedIds);
        const ordered = page.objects
            .map((obj, index) => ({ obj, index }))
            .sort((a, b) => zValue(a.obj, a.index) - zValue(b.obj, b.index));
        const movable = dir < 0
            ? ordered.some(({ obj }, i) => selected.has(obj.id) && i > 0 && !selected.has(ordered[i - 1].obj.id))
            : ordered.some(({ obj }, i) => selected.has(obj.id) && i < ordered.length - 1 && !selected.has(ordered[i + 1].obj.id));
        if (!movable)
            return;
        remember();
        if (dir < 0) {
            for (let i = 1; i < ordered.length; i++) {
                if (selected.has(ordered[i].obj.id) && !selected.has(ordered[i - 1].obj.id)) {
                    [ordered[i - 1], ordered[i]] = [ordered[i], ordered[i - 1]];
                }
            }
        }
        else {
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
        if (!page)
            return;
        const sel = new Set(ids);
        const objects = page.objects.map((o) => (sel.has(o.id) ? { ...o, plotted: true } : o));
        setPage({ ...page, objects });
        persist(page.id, objects);
    };
    return { clipboardCount, deleteSelected, groupSelected, ungroupSelected, copySelected, cutSelected,
        pasteObjects, duplicateSelected, moveSelected, markPlotted };
}
