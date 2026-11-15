// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { api, type Page, type PageIndex } from "../../../api";
import { usePaintDocument } from "./usePaintDocument";
import { usePaintPages } from "./usePaintPages";
vi.mock("../../../api/events", () => ({ onAppEvent: () => () => {} }));
vi.mock("../../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
const page = (id: string): Page => ({ id, name: id, projectId: "project", objects: [],
  grid: { step: 10, snap: false }, created: 0, modified: 0 });
const index = (id: string, projectId = "project"): PageIndex => ({ activeId: id, order: [],
  project: { id: projectId, name: "project", profileId: "profile", activeId: id, modified: 0, archived: false } });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
function setup(initialPage: Page | null = null) {
  const fail = vi.fn(), resetHistory = vi.fn();
  const hook = renderHook(({ visible }) => {
    const [current, setPage] = useState(initialPage);
    const [currentIndex, setIndex] = useState(index("a"));
    const document = usePaintDocument({ page: current, setPage, index: currentIndex, setIndex,
      projectMatches: current?.projectId === currentIndex.project?.id, visible,
      agentRevision: 0, ops: { resetHistory }, setSelectedIds: vi.fn(), fail });
    const pages = usePaintPages({ page: current, setPage, setIndex, setSelectedIds: vi.fn(),
      ops: { resetHistory }, reloadIndex: document.reloadIndex, confirm: vi.fn(), prompt: vi.fn(), fail,
      navigation: document.navigation });
    return { ...document, ...pages, page: current, index: currentIndex, setIndex };
  }, { initialProps: { visible: true } });
  return { ...hook, fail, resetHistory };
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("does not let the initial read overwrite a later sidebar navigation", async () => {
  const initial = deferred<Page>();
  vi.spyOn(api, "getPage").mockImplementation(id => id === "a" ? initial.promise : Promise.resolve(page(id)));
  vi.spyOn(api, "activatePage").mockResolvedValue(index("b"));
  const hook = setup();
  await act(async () => hook.result.current.openPage("b"));
  await act(async () => initial.resolve(page("a")));
  expect(hook.result.current.page?.id).toBe("b");
  expect(hook.result.current.index.activeId).toBe("b");
  expect(hook.fail).not.toHaveBeenCalled();
});
it("ignores an old metadata refresh after a newer page activation", async () => {
  const refresh = deferred<PageIndex>();
  const list = vi.spyOn(api, "listPages").mockReturnValue(refresh.promise);
  vi.spyOn(api, "activatePage").mockResolvedValue(index("b"));
  vi.spyOn(api, "getPage").mockResolvedValue(page("b"));
  const hook = setup(page("a"));
  let pending!: Promise<void>;
  act(() => { pending = hook.result.current.reloadIndex(); });
  await act(async () => hook.result.current.openPage("b"));
  await act(async () => { refresh.resolve(index("a")); await pending; });
  expect(list.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  expect(hook.result.current.index.activeId).toBe("b");
});
it("does not let a delayed project page replace a newer sidebar page", async () => {
  const projectPage = deferred<Page>();
  vi.spyOn(api, "getPage").mockImplementation(id => id === "project-page" ? projectPage.promise : Promise.resolve(page(id)));
  vi.spyOn(api, "activatePage").mockResolvedValue(index("b"));
  const hook = setup(page("a"));
  let result!: Promise<unknown>;
  act(() => { result = hook.result.current.showProject(index("project-page")).catch(error => error); });
  await act(async () => {});
  await act(async () => hook.result.current.openPage("b"));
  await act(async () => { projectPage.resolve(page("project-page")); await result; });
  expect(hook.result.current.page?.id).toBe("b");
  expect(hook.result.current.index.activeId).toBe("b");
});
it("waits for a running sidebar mutation before handing off a project change", async () => {
  const creation = deferred<Page>();
  vi.spyOn(api, "createPage").mockReturnValue(creation.promise);
  const hook = setup(page("a"));
  let create!: Promise<void>, prepare!: Promise<void>;
  act(() => { create = hook.result.current.newPage(); });
  await act(async () => {});
  let prepared = false;
  act(() => { prepare = hook.result.current.prepareProjectChange().then(() => { prepared = true; }); });
  await act(async () => {});
  expect(prepared).toBe(false);
  await act(async () => { creation.resolve(page("new")); await create; await prepare; });
  expect(prepared).toBe(true);
  expect(hook.result.current.page?.id).toBe("a");
});
it("ignores an initial read even when the transport resolves after hiding the view", async () => {
  const initial = deferred<Page>();
  vi.spyOn(api, "getPage").mockReturnValue(initial.promise);
  const hook = setup();
  hook.rerender({ visible: false });
  await act(async () => initial.resolve(page("a")));
  expect(hook.result.current.page).toBeNull();
  expect(hook.resetHistory).not.toHaveBeenCalled();
});

it("accepts its own project switch when the shared context announces it before the page loads", async () => {
  const projectPage = deferred<Page>();
  vi.spyOn(api, "getPage").mockReturnValue(projectPage.promise);
  const hook = setup(page("a"));
  const next = index("new", "other-project");
  let pending!: Promise<void>;
  act(() => { pending = hook.result.current.showProject(next); });
  await act(async () => {});
  act(() => hook.result.current.setIndex(next));
  await act(async () => { projectPage.resolve({ ...page("new"), projectId: "other-project" }); await pending; });
  expect(hook.result.current.page?.id).toBe("new");
  expect(hook.result.current.index.project?.id).toBe("other-project");
  expect(hook.fail).not.toHaveBeenCalled();
});

it("ignores an index read started during navigation if it finishes after the new page commits", async () => {
  const pageRead = deferred<Page>(), indexRead = deferred<PageIndex>();
  vi.spyOn(api, "activatePage").mockResolvedValue(index("b"));
  vi.spyOn(api, "getPage").mockReturnValue(pageRead.promise);
  vi.spyOn(api, "listPages").mockReturnValue(indexRead.promise);
  const hook = setup(page("a"));
  let opening!: Promise<void>, refreshing!: Promise<void>;
  act(() => { opening = hook.result.current.openPage("b"); });
  await act(async () => {});
  act(() => { refreshing = hook.result.current.reloadIndex(); });
  await act(async () => { pageRead.resolve(page("b")); await opening; });
  await act(async () => { indexRead.resolve(index("a")); await refreshing; });
  expect(hook.result.current.index.activeId).toBe("b");
  expect(hook.result.current.page?.id).toBe("b");
});
