import { flushEdits, cachedPage } from "../../../api/pageEdits";
import { useEffect, useRef } from "react";
import { api, type Page, type PageIndex } from "../../../api";
import { useI18n } from "../../../i18n";
import type { ObjectOps } from "./useObjectOps";

/** Page and folder CRUD handlers for the page sidebar. Pure orchestration —
 * all state (page, index, selection) stays in Paint. */
export function usePaintPages({
  page,
  setPage,
  setIndex,
  setSelectedIds,
  ops,
  reloadIndex,
  confirm,
  prompt,
  fail,
}: {
  page: Page | null;
  setPage: React.Dispatch<React.SetStateAction<Page | null>>;
  setIndex: (idx: PageIndex) => void;
  setSelectedIds: (ids: string[]) => void;
  ops: Pick<ObjectOps, "resetHistory">;
  reloadIndex: () => Promise<unknown>;
  confirm: (message: string) => Promise<boolean>;
  prompt: (message: string, defaultValue?: string) => Promise<string | null>;
  fail: (e: any) => void;
}) {
  const { t } = useI18n();

  const openSequence = useRef(0);
  const activation = useRef<Promise<unknown>>(Promise.resolve());
  const read = useRef<AbortController>();
  useEffect(() => () => read.current?.abort(), []);
  const openPage = (id: string) => {
    if (id === page?.id) return;
    const sequence = ++openSequence.current;
    read.current?.abort();
    const controller = new AbortController(); read.current = controller;
    (page ? flushEdits(page.id) : Promise.resolve()).then(async () => {
      if (sequence !== openSequence.current) return;
      ops.resetHistory(); setSelectedIds([]);
      const cached = cachedPage(id);
      if (cached) setPage(cached);
      const nextActivation = activation.current.catch(() => {}).then(() =>
        sequence === openSequence.current ? api.activatePage(id) : null);
      activation.current = nextActivation;
      const idx = await nextActivation;
      if (!idx || sequence !== openSequence.current) return;
      setIndex(idx);
      const next = await api.getPage(id, controller.signal);
      if (sequence === openSequence.current) setPage(next);
    }).catch((error) => { if (error.name !== "AbortError") fail(error); });
  };

  const newPage = async (folderId?: string | null) => {
    try {
      if (page) await flushEdits(page.id);
      const sequence = ++openSequence.current;
      read.current?.abort(); await activation.current.catch(() => {});
      const next = await api.createPage(undefined, folderId);
      if (sequence !== openSequence.current) return;
      ops.resetHistory(); setPage(next); setSelectedIds([]);
      await reloadIndex();
    } catch (e) { fail(e); }
  };

  const duplicate = async (id: string) => {
    try {
      await flushEdits(id);
      if (page) await flushEdits(page.id);
      const sequence = ++openSequence.current;
      read.current?.abort(); await activation.current.catch(() => {});
      const next = await api.duplicatePage(id);
      if (sequence !== openSequence.current) return;
      ops.resetHistory(); setPage(next); setSelectedIds([]);
      await reloadIndex();
    } catch (e) { fail(e); }
  };

  const rename = async (id: string, current: string) => {
    const next = await prompt(t("paint.pageNamePrompt"), current);
    if (next == null) return;
    const name = next.trim();
    if (!name || name === current) return;
    flushEdits(id).then(() => api.savePage(id, { name })).then((p) => {
      if (p.id === page?.id) setPage(p);
      return reloadIndex();
    }).catch(fail);
  };

  const remove = async (id: string) => {
    if (!await confirm(t("paint.deletePageConfirm"))) return;
    flushEdits(id).then(() => api.deletePage(id)).then((idx) => {
      setIndex(idx);
      const nextId = idx.activeId ?? idx.order[0]?.id;
      ops.resetHistory();
      setSelectedIds([]);
      if (nextId) return api.getPage(nextId).then(setPage);
      setPage(null);
    }).catch(fail);
  };

  const reorder = (ids: string[]) => {
    api.reorderPages(ids).then(setIndex).catch(fail);
  };

  const createGroup = (name: string, parentId?: string | null) => {
    api.createGroup(name, parentId).then(setIndex).catch(fail);
  };

  const renameGroup = async (id: string, current: string) => {
    const next = await prompt(t("paint.groupNamePrompt"), current);
    if (next == null) return;
    const name = next.trim();
    if (!name || name === current) return;
    api.renameGroup(id, name).then(setIndex).catch(fail);
  };

  const deleteGroup = async (id: string) => {
    if (!await confirm(t("paint.deleteGroup") + "?")) return;
    api.deleteGroup(id).then(setIndex).catch(fail);
  };

  const setPageGroup = (id: string, groupId: string | null) => {
    api.setPageGroup(id, groupId).then(setIndex).catch(fail);
  };

  const setGroupParent = (id: string, parentId: string | null) => {
    api.setGroupParent(id, parentId).then(setIndex).catch(fail);
  };

  return {
    openPage,
    newPage,
    duplicate,
    rename,
    remove,
    reorder,
    createGroup,
    renameGroup,
    deleteGroup,
    setPageGroup,
    setGroupParent,
  };
}
