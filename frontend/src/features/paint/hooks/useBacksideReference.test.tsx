// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Page, PageMeta } from "../../../api";
import { useBacksideReference } from "./useBacksideReference";
import { readBacksideSettings } from "../lib/backside";
const mocks = vi.hoisted(() => ({ getPage: vi.fn(), cachedPage: vi.fn(), edits: vi.fn(), saved: vi.fn() }));
vi.mock("../../../api", () => ({ api: { getPage: mocks.getPage } }));
vi.mock("../../../api/pageEdits", () => ({ cachedPage: mocks.cachedPage,
  subscribeEdits: mocks.edits, subscribeSaved: mocks.saved }));
const page = (id: string, projectId = "project") => ({ id, projectId, name: id, objects: [], grid: { step: 10, snap: false }, created: 0, modified: 1 }) as Page;
const pages = [{ id: "front", name: "Front", modified: 1 }, { id: "target", name: "Back", modified: 1 }] as PageMeta[];
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  mocks.getPage.mockImplementation(async id => page(id));
  mocks.cachedPage.mockReturnValue(undefined);
  mocks.edits.mockReturnValue(() => {}); mocks.saved.mockReturnValue(() => {});
});
afterEach(cleanup);
it("keeps the reference local to its target slide and never sends document or printer writes", async () => {
  const { result, rerender } = renderHook(({ target }) => useBacksideReference("project", target, pages, true), { initialProps: { target: "target" } });
  act(() => result.current.save({ sourceId: "front", edge: "long", opacity: .15, enabled: true }));
  await waitFor(() => expect(result.current.enabled).toBe(true));
  expect(readBacksideSettings("gcs.backside.v1:project:target")?.sourceId).toBe("front");
  rerender({ target: "other" });
  expect(result.current.settings).toBeNull(); expect(result.current.page).toBeNull();
  rerender({ target: "target" });
  await waitFor(() => expect(result.current.enabled).toBe(true));
  act(() => result.current.save({ ...result.current.settings!, enabled: false }));
  expect(result.current.enabled).toBe(false); expect(result.current.page).toBeNull();
});
it("discards late source reads after switching slides and aborts requests", async () => {
  let finish!: (value: Page) => void;
  mocks.getPage.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const { result, rerender } = renderHook(({ target }) => useBacksideReference("project", target, pages, true), { initialProps: { target: "target" } });
  act(() => result.current.save({ sourceId: "front", edge: "short", opacity: .2, enabled: true }));
  await waitFor(() => expect(mocks.getPage).toHaveBeenCalledOnce());
  const signal = mocks.getPage.mock.calls[0][1] as AbortSignal;
  rerender({ target: "other" });
  expect(signal.aborted).toBe(true);
  await act(async () => finish(page("front")));
  expect(result.current.page).toBeNull();
});
it("does not show a deleted, self-referencing or foreign-project slide", async () => {
  const { result } = renderHook(() => useBacksideReference("project", "target", pages, true));
  act(() => result.current.save({ sourceId: "target", edge: "long", opacity: .15, enabled: true }));
  expect(result.current.enabled).toBe(false); expect(mocks.getPage).not.toHaveBeenCalled();
  mocks.getPage.mockResolvedValue(page("front", "other-project"));
  act(() => result.current.save({ sourceId: "front", edge: "long", opacity: .15, enabled: true }));
  await waitFor(() => expect(result.current.error).toBe("backside.foreignSource"));
  expect(result.current.enabled).toBe(false);
  act(() => result.current.save({ sourceId: "deleted", edge: "long", opacity: .15, enabled: true }));
  expect(result.current.missing).toBe(true); expect(result.current.page).toBeNull();
});
it("survives unavailable browser storage and constrains persisted opacity", () => {
  localStorage.setItem("bad", "{broken"); expect(readBacksideSettings("bad")).toBeNull();
  localStorage.setItem("large", JSON.stringify({ sourceId: "front", edge: "long", opacity: 99 }));
  expect(readBacksideSettings("large")?.opacity).toBe(.4);
});
it("keeps newer local front-side drafts when a slower saved read finishes", async () => {
  let finish!: (value: Page) => void;
  mocks.getPage.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const { result } = renderHook(() => useBacksideReference("project", "target", pages, true));
  act(() => result.current.save({ sourceId: "front", edge: "long", opacity: .15, enabled: true }));
  await waitFor(() => expect(mocks.edits).toHaveBeenCalled());
  const draft = { ...page("front"), name: "New local draft", objects: [{ id: "new", type: "line" }] };
  mocks.cachedPage.mockReturnValue(draft);
  act(() => mocks.edits.mock.calls[mocks.edits.mock.calls.length - 1][0]());
  expect(result.current.page).toBe(draft);
  await act(async () => finish(page("front")));
  expect(result.current.page).toBe(draft);
});
