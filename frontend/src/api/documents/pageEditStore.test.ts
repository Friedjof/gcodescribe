import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Page, SceneObject } from "../types/paint";
import { createPageEditStore, type PageEditTransport } from "./pageEditStore";
const object: SceneObject = { id: "text", type: "text", data: { text: "local" } };
const page = (id = "page"): Page => ({ id, name: id, objects: [], grid: { step: 10, snap: false }, created: 0, modified: 0 });
function setup() {
    const transport: PageEditTransport = {
        read: vi.fn().mockResolvedValue(page()),
        patch: vi.fn().mockResolvedValue({ revision: 1, modified: 1 }),
    };
    const store = createPageEditStore(transport);
    store.rememberPage(page());
    return { store, transport };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
it("retains pending work when discarding fails to load the server document", async () => {
    const { store, transport } = setup();
    store.queueObjects("page", [object]);
    vi.mocked(transport.read).mockRejectedValueOnce(new Error("offline"));
    await expect(store.discardEdits("page")).rejects.toThrow("offline");
    expect(store.cachedPage("page")?.objects).toEqual([object]);
    expect(store.editState("page")).toMatchObject({ pending: true, error: "offline" });
    await store.flushEdits("page");
    expect(transport.patch).toHaveBeenCalledOnce();
    expect(store.hasPendingEdits()).toBe(false);
});
it("does not discard edits entered while the replacement document loads", async () => {
    const { store, transport } = setup();
    let resolve!: (page: Page) => void;
    vi.mocked(transport.read).mockImplementation(() => new Promise((done) => { resolve = done; }));
    store.queueObjects("page", [object]);
    const discard = store.discardEdits("page");
    const newer = { ...object, data: { text: "newer" } };
    store.queueObjects("page", [newer]);
    resolve(page());
    await expect(discard).rejects.toThrow("save.conflict");
    expect(store.cachedPage("page")?.objects).toEqual([newer]);
});
it("publishes saved pages to subscribers and keeps stores independent", async () => {
    const { store } = setup();
    const other = setup().store;
    const saved = vi.fn();
    const unsubscribe = store.subscribeSaved(saved);
    store.queueObjects("page", [object]);
    await store.flushEdits("page");
    expect(saved).toHaveBeenCalledWith("page");
    expect(other.cachedPage("page")?.objects).toEqual([]);
    unsubscribe();
    await store.refreshPage("page");
    expect(saved).toHaveBeenCalledOnce();
});
