import { req, ApiError } from "./client/req";
import type { Page, SceneObject } from "./types/paint";
type Entry = { base: Page; pins?: number; desired?: SceneObject[]; timer?: ReturnType<typeof setTimeout>; running?: Promise<void>; error?: string; conflict?: boolean };
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
// Leaving with an unresolved conflict or network failure must never silently lose edits.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => {
    if ([...entries.values()].some((e) => e.desired || e.running)) {
      event.preventDefault(); event.returnValue = "";
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) for (const id of entries.keys()) void flushEdits(id).catch(() => {});
  });
}
export const subscribeEdits = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const emit = () => listeners.forEach((fn) => fn());
export const editState = (id: string) => {
  const e = entries.get(id); return { pending: !!(e?.desired || e?.running), error: e?.error, conflict: e?.conflict };
};
export function rememberPage(page: Page) {
  const old = entries.get(page.id);
  if (!old?.desired && !old?.running && (page.revision ?? 0) >= (old?.base.revision ?? 0)) {
    if (old) old.base = page; else entries.set(page.id, { base: page });
  }
  for (const [id, e] of entries) {
    if (entries.size <= 3) break;
    if (id !== page.id && !e.desired && !e.running && !e.pins) entries.delete(id);
  }
  return cachedPage(page.id) ?? page;
}
export function retainPage(page: Page) {
  if (!entries.has(page.id)) rememberPage(page);
  const entry = entries.get(page.id)!;
  entry.pins = (entry.pins ?? 0) + 1;
  return () => { entry.pins = Math.max(0, (entry.pins ?? 0) - 1); };
}
export const cachedPage = (id: string) => {
  const entry = entries.get(id);
  return entry ? { ...entry.base, objects: entry.desired ?? entry.base.objects } : undefined;
};
export function objectChanges(before: SceneObject[], after: SceneObject[]) {
  const previous = new Map(before.map((o) => [o.id, o]));
  const ids = new Set(after.map((o) => o.id));
  const changes: Partial<SceneObject>[] = [];
  for (const object of after) {
    const old = previous.get(object.id);
    if (!old) { changes.push(object); continue; }
    if (old === object) continue;
    const patch: any = { id: object.id };
    for (const key of new Set([...Object.keys(old), ...Object.keys(object)])) {
      if ((old as any)[key] !== (object as any)[key]) patch[key] = (object as any)[key] ?? null;
    }
    if (Object.keys(patch).length > 1) changes.push(patch);
  }
  return { changes, removed: before.filter((o) => !ids.has(o.id)).map((o) => o.id) };
}
function merge(remote: SceneObject[], changes: Partial<SceneObject>[], removed: string[]) {
  const objects = new Map(remote.filter((o) => !removed.includes(o.id)).map((o) => [o.id, o]));
  for (const change of changes) objects.set(change.id!, { ...objects.get(change.id!), ...change } as SceneObject);
  return [...objects.values()];
}
const equal = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
export function queueObjects(id: string, objects: SceneObject[]) {
  const e = entries.get(id);
  if (!e) throw new Error("Document has not been loaded");
  e.desired = objects; clearTimeout(e.timer);
  e.timer = setTimeout(() => { void flushEdits(id).catch(() => {}); }, 500);
  emit();
}
export async function flushEdits(id: string, overwrite = false): Promise<void> {
  const e = entries.get(id);
  if (!e) return;
  clearTimeout(e.timer);
  if (e.running) { await e.running; return flushEdits(id, overwrite); }
  if (!e.desired) return;
  if (e.conflict && !overwrite) throw new Error(e.error);
  const send = async () => {
    const desired = e.desired!;
    const base = e.base;
    const delta = objectChanges(base.objects, desired);
    if (!delta.changes.length && !delta.removed.length) { e.desired = undefined; return; }
    let revision = base.revision ?? 0;
    let savedPage = base;
    let savedObjects = desired;
    const mutation = crypto.randomUUID();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await req<{ revision: number; modified: number }>(`/api/pages/${id}/objects`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...delta, revision, mutation_id: mutation }),
        });
        e.base = { ...savedPage, ...result, objects: savedObjects };
        // Preserve edits made while this request was in flight, including remote additions.
        if (e.desired === desired) e.desired = undefined;
        else if (e.desired) { const next = objectChanges(desired, e.desired); e.desired = merge(savedObjects, next.changes, next.removed); }
        e.error = undefined; e.conflict = false;
        window.dispatchEvent(new CustomEvent("gcs:page-saved", { detail: id }));
        return;
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409) throw error;
        const remote = await req<Page>(`/api/pages/${id}`);
        const old = new Map(base.objects.map((o) => [o.id, o]));
        const current = new Map(remote.objects.map((o) => [o.id, o]));
        const collision = delta.changes.some((patch) => Object.keys(patch).some((key) => key !== "id" &&
          !equal((old.get(patch.id!) as any)?.[key], (current.get(patch.id!) as any)?.[key]) &&
          !equal((patch as any)[key], (current.get(patch.id!) as any)?.[key]))) ||
          delta.removed.some((key) => current.has(key) && !equal(old.get(key), current.get(key)));
        if (collision && !overwrite) { e.conflict = true; throw new Error("save.conflict"); }
        if (overwrite) delta.changes = delta.changes.map((patch) => old.has(patch.id!) && !current.has(patch.id!) ? { ...old.get(patch.id!), ...patch } : patch);
        revision = remote.revision ?? 0;
        savedObjects = merge(remote.objects, delta.changes, delta.removed);
        savedPage = remote;
      }
    }
    throw new Error("save.conflict");
  };
  e.error = undefined;
  e.running = send().catch((error) => { e.error = String(error.message ?? error); throw error; });
  emit();
  try { await e.running; } finally { e.running = undefined; emit(); }
  if (e.desired) await flushEdits(id);
}
export async function discardEdits(id: string) {
  const e = entries.get(id); if (e?.running) await e.running.catch(() => {});
  clearTimeout(e?.timer); entries.delete(id);
  const page = rememberPage(await req<Page>(`/api/pages/${id}`)); emit(); return page;
}
export async function refreshPage(id: string) {
  await flushEdits(id);
  rememberPage(await req<Page>(`/api/pages/${id}`));
  window.dispatchEvent(new CustomEvent("gcs:page-saved", { detail: id }));
}
export async function appendObject(id: string, object: SceneObject) {
  if (!entries.has(id)) rememberPage(await req<Page>(`/api/pages/${id}`));
  await flushEdits(id);
  const page = cachedPage(id)!;
  if (!page.objects.some((o) => o.id === object.id)) queueObjects(id, [...page.objects, object]);
  await flushEdits(id);
  return cachedPage(id)!;
}
