// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, type Page, type PageIndex } from "../../../api";
import { flushEdits } from "../../../api/pageEdits";
import { usePageNavigation } from "./usePageNavigation";
import { usePaintPages } from "./usePaintPages";
vi.mock("../../../api/pageEdits", () => ({ flushEdits: vi.fn() }));
vi.mock("../../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
const page = (id: string): Page => ({ id, name: id, projectId: "project", objects: [],
  grid: { step: 10, snap: false }, created: 0, modified: 0 });
const index = (id: string, projectId = "project"): PageIndex => ({ activeId: id, order: [],
  project: { id: projectId, name: projectId, profileId: "profile", activeId: id, modified: 0, archived: false } });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
function setup() {
  const fail = vi.fn(), resetHistory = vi.fn(), reloadIndex = vi.fn().mockResolvedValue(undefined);
  const confirm = vi.fn().mockResolvedValue(true), prompt = vi.fn().mockResolvedValue("Renamed");
  const hook = renderHook(({ projectId, visible }) => {
    const [current, setPage] = useState<Page | null>(page("a"));
    const [currentIndex, setIndex] = useState(index("a"));
    const navigation = usePageNavigation(projectId, visible);
    const actions = usePaintPages({ page: current, setPage, setIndex, setSelectedIds: vi.fn(),
      ops: { resetHistory }, reloadIndex, confirm, prompt, fail, navigation });
    return { ...actions, page: current, index: currentIndex, setPage };
  }, { initialProps: { projectId: "project", visible: true } });
  return { ...hook, fail, resetHistory, reloadIndex, prompt, confirm };
}
beforeEach(() => { vi.mocked(flushEdits).mockReset().mockResolvedValue(undefined); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("keeps the latest opened page when an older page read completes last", async () => {
  const old = deferred<Page>();
  vi.spyOn(api, "activatePage").mockImplementation(async id => index(id));
  vi.spyOn(api, "getPage").mockImplementation(id => id === "b" ? old.promise : Promise.resolve(page(id)));
  const hook = setup();
  let first!: Promise<void>;
  act(() => { first = hook.result.current.openPage("b"); });
  await act(async () => {});
  await act(async () => hook.result.current.openPage("c"));
  await act(async () => { old.resolve(page("b")); await first; });
  expect(hook.result.current.page?.id).toBe("c");
  expect(hook.result.current.index.activeId).toBe("c");
  expect(hook.resetHistory).toHaveBeenCalledOnce();
});
it("cancels an older open when the user returns to the already displayed page", async () => {
  const old = deferred<Page>();
  const activate = vi.spyOn(api, "activatePage").mockImplementation(async id => index(id));
  vi.spyOn(api, "getPage").mockImplementation(id => id === "b" ? old.promise : Promise.resolve(page(id)));
  const hook = setup();
  let first!: Promise<void>;
  act(() => { first = hook.result.current.openPage("b"); });
  await act(async () => {});
  await act(async () => hook.result.current.openPage("a"));
  await act(async () => { old.resolve(page("b")); await first; });
  expect(hook.result.current.page?.id).toBe("a");
  expect(activate.mock.calls.map(([id]) => id)).toEqual(["b", "a"]);
});
it("waits for saved edits before reading a slide when returning during navigation", async () => {
  const save = deferred<void>();
  let saved = false;
  vi.mocked(flushEdits).mockReturnValue(save.promise);
  vi.spyOn(api, "activatePage").mockImplementation(async id => index(id));
  const read = vi.spyOn(api, "getPage").mockImplementation(async id => ({
    ...page(id), name: saved ? "Saved drawing" : "Old drawing",
  }));
  const hook = setup();
  let first!: Promise<void>, second!: Promise<void>;
  act(() => { first = hook.result.current.openPage("b"); });
  act(() => { second = hook.result.current.openPage("a"); });
  expect(read).not.toHaveBeenCalled();
  await act(async () => { saved = true; save.resolve(); await first; await second; });
  expect(hook.result.current.page?.id).toBe("a");
  expect(hook.result.current.page?.name).toBe("Saved drawing");
});
it.each(["new", "duplicate"])("does not let %s overtake a later open while autosave is pending", async action => {
  const save = deferred<void>();
  vi.mocked(flushEdits).mockReturnValue(save.promise);
  const create = vi.spyOn(api, "createPage").mockResolvedValue(page("new"));
  const duplicate = vi.spyOn(api, "duplicatePage").mockResolvedValue(page("copy"));
  vi.spyOn(api, "activatePage").mockImplementation(async id => index(id));
  vi.spyOn(api, "getPage").mockImplementation(async id => page(id));
  const hook = setup();
  let first!: Promise<void>, second!: Promise<void>;
  act(() => { first = action === "new" ? hook.result.current.newPage() : hook.result.current.duplicate("a");
    second = hook.result.current.openPage("b"); });
  await act(async () => { save.resolve(); await first; await second; });
  expect(create).not.toHaveBeenCalled(); expect(duplicate).not.toHaveBeenCalled();
  expect(hook.result.current.page?.id).toBe("b");
});
it("orders a later activation after an already running creation", async () => {
  const created = deferred<Page>(), calls: string[] = [];
  vi.spyOn(api, "createPage").mockImplementation(() => { calls.push("create"); return created.promise; });
  vi.spyOn(api, "activatePage").mockImplementation(async id => { calls.push(`activate:${id}`); return index(id); });
  vi.spyOn(api, "getPage").mockImplementation(async id => page(id));
  const hook = setup();
  let first!: Promise<void>, second!: Promise<void>;
  act(() => { first = hook.result.current.newPage(); });
  await act(async () => {});
  act(() => { second = hook.result.current.openPage("b"); });
  await act(async () => {});
  expect(calls).toEqual(["create"]);
  await act(async () => { created.resolve(page("new")); await first; await second; });
  expect(calls).toEqual(["create", "activate:b"]);
  expect(hook.result.current.page?.id).toBe("b");
});
it("does not replace the current page with a delayed rename response", async () => {
  const saved = deferred<Page>();
  vi.spyOn(api, "savePage").mockReturnValue(saved.promise);
  const hook = setup();
  let rename!: Promise<void>;
  act(() => { rename = hook.result.current.rename("a", "a"); });
  await act(async () => {});
  act(() => hook.result.current.setPage(page("b")));
  await act(async () => { saved.resolve({ ...page("a"), name: "Renamed" }); await rename; });
  expect(hook.result.current.page?.id).toBe("b");
});
it("preserves edits made during renaming the displayed page", async () => {
  const saved = deferred<Page>();
  vi.spyOn(api, "savePage").mockReturnValue(saved.promise);
  const hook = setup();
  let rename!: Promise<void>;
  act(() => { rename = hook.result.current.rename("a", "a"); });
  await act(async () => {});
  act(() => hook.result.current.setPage({ ...page("a"), objects: [{ id: "new", type: "pen" }] }));
  await act(async () => { saved.resolve({ ...page("a"), name: "Renamed", revision: 1 }); await rename; });
  expect(hook.result.current.page?.name).toBe("Renamed");
  expect(hook.result.current.page?.objects.map(object => object.id)).toEqual(["new"]);
});
it("ignores a deletion fallback that completes after a newer navigation", async () => {
  const fallback = deferred<Page>();
  vi.spyOn(api, "deletePage").mockResolvedValue(index("b"));
  vi.spyOn(api, "activatePage").mockImplementation(async id => index(id));
  vi.spyOn(api, "getPage").mockImplementation(id => id === "b" ? fallback.promise : Promise.resolve(page(id)));
  const hook = setup();
  let removal!: Promise<void>;
  act(() => { removal = hook.result.current.remove("a"); });
  await act(async () => {});
  await act(async () => hook.result.current.openPage("c"));
  await act(async () => { fallback.resolve(page("b")); await removal; });
  expect(hook.result.current.page?.id).toBe("c");
});
it("keeps the editor and undo history when deleting another page", async () => {
  vi.spyOn(api, "deletePage").mockResolvedValue(index("a"));
  const read = vi.spyOn(api, "getPage");
  const hook = setup();
  await act(async () => hook.result.current.remove("b"));
  expect(hook.result.current.page?.id).toBe("a");
  expect(hook.resetHistory).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});
it.each(["project", "hidden", "unmount"])("ignores pending replies after %s", async change => {
  const activation = deferred<PageIndex>();
  vi.spyOn(api, "activatePage").mockReturnValue(activation.promise);
  const read = vi.spyOn(api, "getPage").mockResolvedValue(page("b"));
  const hook = setup();
  let pending!: Promise<void>;
  act(() => { pending = hook.result.current.openPage("b"); });
  await act(async () => {});
  if (change === "unmount") hook.unmount();
  else hook.rerender({ projectId: change === "project" ? "other" : "project", visible: change !== "hidden" });
  await act(async () => { activation.resolve(index("b")); await pending; });
  expect(read).toHaveBeenCalledOnce();
  expect(read.mock.calls[0][1]?.aborted).toBe(true);
  expect(hook.resetHistory).not.toHaveBeenCalled();
  expect(hook.fail).not.toHaveBeenCalled();
});
it("recovers after an activation failure", async () => {
  vi.spyOn(api, "activatePage").mockRejectedValueOnce(new Error("offline")).mockResolvedValue(index("c"));
  vi.spyOn(api, "getPage").mockResolvedValue(page("c"));
  const hook = setup();
  await act(async () => hook.result.current.openPage("b"));
  expect(hook.result.current.page?.id).toBe("a");
  expect(hook.fail).toHaveBeenCalledOnce();
  await act(async () => hook.result.current.openPage("c"));
  expect(hook.result.current.page?.id).toBe("c");
});

it("keeps undo history when clicking the displayed page without a pending navigation", async () => {
  const activate = vi.spyOn(api, "activatePage");
  const hook = setup();
  await act(async () => hook.result.current.openPage("a"));
  expect(activate).not.toHaveBeenCalled();
  expect(hook.resetHistory).not.toHaveBeenCalled();
});
it("does not publish an old folder response into another project", async () => {
  const folder = deferred<PageIndex>();
  vi.spyOn(api, "createGroup").mockReturnValue(folder.promise);
  const hook = setup();
  let pending!: Promise<void>;
  act(() => { pending = hook.result.current.createGroup("folder"); });
  await act(async () => {});
  hook.rerender({ projectId: "other-project", visible: true });
  await act(async () => { folder.resolve(index("old-active")); await pending; });
  expect(hook.result.current.index.activeId).toBe("a");
  expect(hook.reloadIndex).not.toHaveBeenCalled();
});
