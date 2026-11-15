import { ApiError } from "../client/req";
import type { Page, SceneObject } from "../types/paint";
import { objectChanges, mergeObjects, equal, field, type ObjectPatch } from "./objectPatches";
export interface PageEditTransport {
    read(id: string): Promise<Page>;
    patch(id: string, update: {
        changes: ObjectPatch[];
        removed: string[];
        revision: number;
        mutation_id: string;
    }): Promise<{
        revision: number;
        modified: number;
    }>;
}
type Entry = {
    base: Page;
    pins?: number;
    version?: number;
    desired?: SceneObject[];
    timer?: ReturnType<typeof setTimeout>;
    running?: Promise<void>;
    error?: string;
    conflict?: boolean;
};
export function createPageEditStore(transport: PageEditTransport) {
    const entries = new Map<string, Entry>();
    const listeners = new Set<() => void>();
    const savedListeners = new Set<(id: string) => void>();
    const subscribeEdits = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
    const emit = () => listeners.forEach((fn) => fn());
    const editState = (id: string) => {
        const e = entries.get(id);
        return { pending: !!(e?.desired || e?.running), error: e?.error, conflict: e?.conflict };
    };
    function rememberPage(page: Page) {
        const old = entries.get(page.id);
        if (!old?.desired && !old?.running && (page.revision ?? 0) >= (old?.base.revision ?? 0)) {
            if (old)
                old.base = page;
            else
                entries.set(page.id, { base: page });
        }
        for (const [id, e] of entries) {
            if (entries.size <= 3)
                break;
            if (id !== page.id && !e.desired && !e.running && !e.pins)
                entries.delete(id);
        }
        return cachedPage(page.id) ?? page;
    }
    function retainPage(page: Page) {
        if (!entries.has(page.id))
            rememberPage(page);
        const entry = entries.get(page.id)!;
        entry.pins = (entry.pins ?? 0) + 1;
        return () => { entry.pins = Math.max(0, (entry.pins ?? 0) - 1); };
    }
    const cachedPage = (id: string) => {
        const entry = entries.get(id);
        return entry ? { ...entry.base, objects: entry.desired ?? entry.base.objects } : undefined;
    };
    function queueObjects(id: string, objects: SceneObject[]) {
        const e = entries.get(id);
        if (!e)
            throw new Error("Document has not been loaded");
        e.desired = objects;
        e.version = (e.version ?? 0) + 1;
        clearTimeout(e.timer);
        e.timer = setTimeout(() => { void flushEdits(id).catch(() => { }); }, 500);
        emit();
    }
    async function flushEdits(id: string, overwrite = false): Promise<void> {
        const e = entries.get(id);
        if (!e)
            return;
        clearTimeout(e.timer);
        if (e.running) {
            await e.running;
            return flushEdits(id, overwrite);
        }
        if (!e.desired)
            return;
        if (e.conflict && !overwrite)
            throw new Error(e.error);
        const send = async () => {
            const desired = e.desired!;
            const base = e.base;
            const delta = objectChanges(base.objects, desired);
            if (!delta.changes.length && !delta.removed.length) {
                e.desired = undefined;
                return;
            }
            let revision = base.revision ?? 0;
            let savedPage = base;
            let savedObjects = desired;
            const mutation = crypto.randomUUID();
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const result = await transport.patch(id, { ...delta, revision, mutation_id: mutation });
                    e.base = { ...savedPage, ...result, objects: savedObjects };
                    // Preserve edits made while this request was in flight, including remote additions.
                    if (e.desired === desired)
                        e.desired = undefined;
                    else if (e.desired) {
                        const next = objectChanges(desired, e.desired);
                        e.desired = mergeObjects(savedObjects, next.changes, next.removed);
                    }
                    e.error = undefined;
                    e.conflict = false;
                    savedListeners.forEach((listener) => listener(id));
                    return;
                }
                catch (error) {
                    if (!(error instanceof ApiError) || error.status !== 409)
                        throw error;
                    const remote = await transport.read(id);
                    const old = new Map(base.objects.map((o) => [o.id, o]));
                    const current = new Map(remote.objects.map((o) => [o.id, o]));
                    const collision = delta.changes.some((patch) => Object.keys(patch).some((key) => key !== "id" &&
                        !equal(field(old.get(patch.id), key), field(current.get(patch.id), key)) &&
                        !equal(patch[key], field(current.get(patch.id), key)))) ||
                        delta.removed.some((key) => current.has(key) && !equal(old.get(key), current.get(key)));
                    if (collision && !overwrite) {
                        e.conflict = true;
                        throw new Error("save.conflict");
                    }
                    if (overwrite)
                        delta.changes = delta.changes.map((patch) => old.has(patch.id!) && !current.has(patch.id!) ? { ...old.get(patch.id!), ...patch } : patch);
                    revision = remote.revision ?? 0;
                    savedObjects = mergeObjects(remote.objects, delta.changes, delta.removed);
                    savedPage = remote;
                }
            }
            throw new Error("save.conflict");
        };
        e.error = undefined;
        e.running = send().catch((error) => { e.error = error instanceof Error ? error.message : String(error); throw error; });
        emit();
        try {
            await e.running;
        }
        finally {
            e.running = undefined;
            emit();
        }
        if (e.desired)
            await flushEdits(id);
    }
    async function discardEdits(id: string) {
        const entry = entries.get(id);
        if (entry?.running) await entry.running.catch(() => {});
        clearTimeout(entry?.timer);
        entries.delete(id);
        const page = rememberPage(await transport.read(id));
        emit();
        return page;
    }
    async function refreshPage(id: string) {
        await flushEdits(id);
        rememberPage(await transport.read(id));
        savedListeners.forEach((listener) => listener(id));
    }
    async function appendObject(id: string, object: SceneObject) {
        if (!entries.has(id))
            rememberPage(await transport.read(id));
        await flushEdits(id);
        const page = cachedPage(id)!;
        if (!page.objects.some((o) => o.id === object.id))
            queueObjects(id, [...page.objects, object]);
        await flushEdits(id);
        return cachedPage(id)!;
    }
    return { subscribeEdits, editState, rememberPage, retainPage, cachedPage, queueObjects, flushEdits,
        discardEdits, refreshPage, appendObject,
        subscribeSaved: (listener: (id: string) => void) => {
            savedListeners.add(listener);
            return () => { savedListeners.delete(listener); };
        },
        hasPendingEdits: () => [...entries.values()].some((entry) => entry.desired || entry.running),
        flushAll: () => Promise.allSettled([...entries.keys()].map((id) => flushEdits(id))),
    };
}
