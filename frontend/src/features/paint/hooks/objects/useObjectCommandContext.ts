import { useRef, useState } from "react";
import { type Calibration, type Page, type SceneObject } from "../../../../api";
import { cachedPage, queueObjects, rememberPage } from "../../../../api/pageEdits";
import { useI18n } from "../../../../i18n";
import { cloneObjects, zValue } from "../../lib/sceneObjects";
import { trimHistory } from "../../lib/history";
export interface ObjectCommandOptions {
    page: Page | null;
    cal: Calibration | null;
    selectedIds: string[];
    setPage: React.Dispatch<React.SetStateAction<Page | null>>;
    setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
    persist: (pageId: string, objects: SceneObject[]) => void;
    fail: (error: unknown) => void;
    warnMissingGlyphs: (missing: string[]) => void;
    defaultText: string;
    sizeLinked: boolean;
}
export function useObjectCommandContext(options: ObjectCommandOptions) {
    const { page, selectedIds, setPage, setSelectedIds, persist, fail } = options;
    const { t } = useI18n();
    const latestPage = useRef(page);
    latestPage.current = page;
    const latestSelection = useRef(selectedIds); latestSelection.current = selectedIds;
    const [processing, setProcessing] = useState(0);
    const commitAsync = (target: Page, replacements: Map<string, {
        before: SceneObject;
        after: SceneObject | null;
        geometryOnly?: boolean;
    }>) => {
        const current = latestPage.current?.id === target.id ? latestPage.current : cachedPage(target.id);
        if (!current)
            return;
        let changed = false, skipped = false;
        const objects = current.objects.flatMap((object) => {
            const replacement = replacements.get(object.id);
            if (!replacement)
                return [object];
            const { before, after, geometryOnly } = replacement;
            if (object.plotted || object.data !== before.data || object.cachedPolylines !== before.cachedPolylines || (!geometryOnly && object.transform !== before.transform)) {
                skipped = true;
                return [object];
            }
            changed = true;
            return after ? [{ ...after, transform: geometryOnly ? object.transform : after.transform }] : [];
        });
        if (skipped)
            fail(new Error(t("paint.editChanged")));
        if (!changed)
            return;
        if (latestPage.current?.id === target.id) {
            undoStack.current.push(cloneObjects(current.objects));
            redoStack.current = [];
            syncHistory();
            latestPage.current = { ...current, objects };
            setPage(latestPage.current);
            setSelectedIds((ids) => ids.filter((id) => objects.some((obj) => obj.id === id)));
        }
        queueObjects(target.id, objects);
    };
    const undoStack = useRef<SceneObject[][]>([]);
    const redoStack = useRef<SceneObject[][]>([]);
    const [history, setHistory] = useState({ undo: 0, redo: 0 });
    const syncHistory = () => {
        trimHistory(undoStack.current, redoStack.current);
        setHistory({ undo: undoStack.current.length, redo: redoStack.current.length });
    };
    const resetHistory = () => {
        undoStack.current = [];
        redoStack.current = [];
        syncHistory();
    };
    const remember = (objects = page?.objects) => {
        if (!objects) return;
        undoStack.current.push(cloneObjects(objects));
        redoStack.current = [];
        syncHistory();
    };
    const restoreObjects = (objects: SceneObject[]) => {
        if (!page)
            return;
        setPage({ ...page, objects });
        setSelectedIds((ids) => ids.filter((id) => objects.some((obj) => obj.id === id)));
        persist(page.id, objects);
    };
    const undo = () => {
        if (!page || undoStack.current.length === 0)
            return;
        const previous = undoStack.current.pop()!;
        redoStack.current.push(cloneObjects(page.objects));
        syncHistory();
        restoreObjects(previous);
    };
    const redo = () => {
        if (!page || redoStack.current.length === 0)
            return;
        const next = redoStack.current.pop()!;
        undoStack.current.push(cloneObjects(page.objects));
        syncHistory();
        restoreObjects(next);
    };
    const appendPrepared = (target: Page, prepared: SceneObject[]) => {
        const current = latestPage.current?.id === target.id ? latestPage.current : cachedPage(target.id);
        if (!current)
            return;
        let nextZ = current.objects.reduce((max, o, i) => Math.max(max, zValue(o, i)), -1) + 1;
        const added = prepared.filter((obj) => !current.objects.some((o) => o.id === obj.id)).map((obj) => ({ ...obj, zOrder: nextZ++ }));
        if (!added.length)
            return;
        const objects = [...current.objects, ...added];
        rememberPage(current);
        if (latestPage.current?.id === target.id) {
            undoStack.current.push(cloneObjects(current.objects));
            redoStack.current = [];
            syncHistory();
            latestPage.current = { ...current, objects };
            setPage(latestPage.current);
            setSelectedIds(added.map((obj) => obj.id));
        }
        queueObjects(target.id, objects);
    };
    return { ...options, t, latestPage, latestSelection, processing, setProcessing, commitAsync, appendPrepared,
        history, remember, resetHistory, undo, redo };
}
export type ObjectCommandContext = ReturnType<typeof useObjectCommandContext>;
