import { useRef } from "react";
import { api, type Page, type PageIndex } from "../../../api";
import { isAbortError } from "../../../api/errors";
import { flushEdits } from "../../../api/pageEdits";
import { useI18n } from "../../../i18n";
import type { PageNavigation, PageNavigationRequest } from "../lib/pageNavigation";
import type { ObjectOps } from "./useObjectOps";

/** Sidebar actions share the document loader's navigation and write ordering. */
export function usePaintPages({ page, setPage, setIndex, setSelectedIds, ops, reloadIndex,
  confirm, prompt, fail, navigation, onLoadingChange }: {
  page: Page | null;
  setPage: React.Dispatch<React.SetStateAction<Page | null>>;
  setIndex: (idx: PageIndex) => void;
  setSelectedIds: (ids: string[]) => void;
  ops: Pick<ObjectOps, "resetHistory">;
  reloadIndex: () => Promise<unknown>;
  confirm: (message: string) => Promise<boolean>;
  prompt: (message: string, defaultValue?: string) => Promise<string | null>;
  fail: (error: unknown) => void;
  navigation: PageNavigation;
  onLoadingChange?: (pageId: string | null) => void;
}) {
  const { t } = useI18n();
  const latestPage = useRef(page); latestPage.current = page;
  const loadSequence = useRef(0);
  const report = (error: unknown, current: () => boolean) => {
    if (current() && !isAbortError(error)) fail(error);
  };
  const publish = (request: PageNavigationRequest, next: Page | null, index?: PageIndex) => {
    if (!request.current()) return;
    if (index) setIndex(index);
    ops.resetHistory(); setSelectedIds([]); setPage(next);
  };
  const flushCurrent = async () => {
    if (latestPage.current) await flushEdits(latestPage.current.id);
  };
  const openPage = async (id: string) => {
    if (id === latestPage.current?.id && !navigation.pending) return;
    const request = navigation.begin();
    const sequence = ++loadSequence.current;
    onLoadingChange?.(id);
    // Fetch alongside activation, but only after the target's queued edits.
    // Returning to the displayed slide during a switch must read its saved state.
    const read = flushEdits(id).then(() => api.getPage(id, request.signal));
    void read.catch(() => {});
    try {
      await flushCurrent();
      const index = await navigation.enqueue(request.current, () => api.activatePage(id));
      if (!index || !request.current()) return;
      const next = await read;
      publish(request, next, index);
    } catch (error) { report(error, request.current); }
    finally { if (sequence === loadSequence.current) onLoadingChange?.(null); request.finish(); }
  };
  const newPage = async (folderId?: string | null) => {
    // Claim the intent before awaiting autosave, so a later click supersedes it.
    const request = navigation.begin();
    try {
      await flushCurrent();
      const next = await navigation.enqueue(request.current, () => api.createPage(undefined, folderId));
      if (!next || !request.current()) return;
      publish(request, next);
      await reloadIndex();
    } catch (error) { report(error, request.current); }
    finally { request.finish(); }
  };
  const duplicate = async (id: string) => {
    const request = navigation.begin();
    try {
      await flushEdits(id);
      if (!request.current()) return;
      await flushCurrent();
      const next = await navigation.enqueue(request.current, () => api.duplicatePage(id));
      if (!next || !request.current()) return;
      publish(request, next);
      await reloadIndex();
    } catch (error) { report(error, request.current); }
    finally { request.finish(); }
  };

  const rename = async (id: string, currentName: string) => {
    const inScope = navigation.captureScope();
    try {
      const name = (await prompt(t("paint.pageNamePrompt"), currentName))?.trim();
      if (!inScope() || !name || name === currentName) return;
      await flushEdits(id);
      const saved = await navigation.enqueue(inScope, () => api.savePage(id, { name }));
      if (!saved || !inScope()) return;
      // Metadata replies must not replace geometry edited while saving the name.
      setPage(previous => previous?.id === id ? { ...previous, name: saved.name,
        modified: saved.modified, revision: Math.max(previous.revision ?? 0, saved.revision ?? 0) } : previous);
      await reloadIndex();
    } catch (error) { report(error, inScope); }
  };
  const remove = async (id: string) => {
    const inScope = navigation.captureScope();
    let request: PageNavigationRequest | undefined;
    try {
      if (!await confirm(t("paint.deletePageConfirm")) || !inScope()) return;
      request = navigation.begin();
      const current = request.current;
      await flushEdits(id);
      const index = await navigation.enqueue(current, () => api.deletePage(id));
      if (!index || !current()) return;
      const active = latestPage.current;
      // Deleting a background page leaves the editor and its undo history alone.
      if (active && active.id !== id) {
        const nextIndex = index.activeId === active.id ? index :
          await navigation.enqueue(current, () => api.activatePage(active.id));
        if (nextIndex && current()) setIndex(nextIndex);
        return;
      }
      const nextId = index.activeId ?? index.order[0]?.id;
      const next = nextId ? await api.getPage(nextId, request.signal) : null;
      publish(request, next, index);
    } catch (error) { report(error, request?.current ?? inScope); }
    finally { request?.finish(); }
  };

  const updateIndex = async (mutation: () => Promise<PageIndex>) => {
    const inScope = navigation.captureScope(), current = navigation.capture();
    try {
      const index = await navigation.enqueue(inScope, mutation);
      if (!index || !inScope()) return;
      if (current()) setIndex(index);
      else await reloadIndex();
    } catch (error) { report(error, inScope); }
  };
  const reorder = (ids: string[]) => updateIndex(() => api.reorderPages(ids));
  const createGroup = (name: string, parentId?: string | null) => updateIndex(() => api.createGroup(name, parentId));
  const renameGroup = async (id: string, current: string) => {
    const inScope = navigation.captureScope();
    try {
      const name = (await prompt(t("paint.groupNamePrompt"), current))?.trim();
      if (inScope() && name && name !== current) await updateIndex(() => api.renameGroup(id, name));
    } catch (error) { report(error, inScope); }
  };
  const deleteGroup = async (id: string) => {
    const inScope = navigation.captureScope();
    try {
      if (await confirm(t("paint.deleteGroup") + "?") && inScope())
        await updateIndex(() => api.deleteGroup(id));
    } catch (error) { report(error, inScope); }
  };
  const setPageGroup = (id: string, groupId: string | null) => updateIndex(() => api.setPageGroup(id, groupId));
  const setGroupParent = (id: string, parentId: string | null) => updateIndex(() => api.setGroupParent(id, parentId));
  return { openPage, newPage, duplicate, rename, remove, reorder, createGroup, renameGroup,
    deleteGroup, setPageGroup, setGroupParent };
}
