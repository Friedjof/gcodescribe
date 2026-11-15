import { req } from "./client/req";
import type { Page } from "./types/paint";
import { createPageEditStore } from "./documents/pageEditStore";
export { objectChanges } from "./documents/objectPatches";
const store = createPageEditStore({
    // A conflict/discard read must not reuse a GET started before the mutation.
    read: (id) => req<Page>(`/api/pages/${id}`, { signal: new AbortController().signal }),
    patch: (id, update) => req<{
        revision: number;
        modified: number;
    }>(`/api/pages/${id}/objects`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(update),
    }),
});
export const { subscribeEdits, subscribeSaved, editState, rememberPage, retainPage, cachedPage, queueObjects, flushEdits, discardEdits, refreshPage, appendObject } = store;
export function installPageEditLifecycle() {
    const beforeUnload = (event: BeforeUnloadEvent) => {
        if (store.hasPendingEdits()) {
            event.preventDefault();
            event.returnValue = "";
        }
    };
    const visibilityChanged = () => { if (document.hidden)
        void store.flushAll(); };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
        window.removeEventListener("beforeunload", beforeUnload);
        document.removeEventListener("visibilitychange", visibilityChanged);
    };
}
