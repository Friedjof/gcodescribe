import { useEffect, useRef, useState } from "react";
import { api, onAppEvent, type AppEvent, type Page, type PageIndex } from "../../../api";
import type { AssetTask } from "../../../api/assetTasks";
import { cachedPage, editState, flushEdits, refreshPage, subscribeEdits, subscribeSaved } from "../../../api/pageEdits";
import { usePageNavigation } from "./usePageNavigation";
import type { ObjectOps } from "./useObjectOps";

/** Synchronizes saved documents and remote imports without replacing local drafts. */
export function usePaintDocument({ page, setPage, index, setIndex, projectMatches, visible,
  agentRevision, ops, setSelectedIds, fail }: {
    page: Page | null; setPage: React.Dispatch<React.SetStateAction<Page | null>>;
    index: PageIndex | null; setIndex: (index: PageIndex) => void; projectMatches: boolean;
    visible: boolean; agentRevision: number; ops: Pick<ObjectOps, "resetHistory">;
    setSelectedIds: (ids: string[]) => void; fail: (error: unknown) => void;
  }) {
  const navigation = usePageNavigation(index?.project?.id, visible);
  const [, setSaveTick] = useState(0);
  useEffect(() => subscribeEdits(() => setSaveTick((tick) => tick + 1)), []);
  const saveState = page ? editState(page.id) : { pending: false, error: undefined, conflict: false };
  const indexRead = useRef<AbortController | null>(null);
  useEffect(() => () => indexRead.current?.abort(), [visible, index?.project?.id]);
  const reloadIndex = async () => {
    indexRead.current?.abort();
    const controller = new AbortController(); indexRead.current = controller;
    const current = navigation.capture();
    try {
      // Mutation refreshes must not reuse a GET from before the mutation.
      const next = await api.listPages(controller.signal);
      if (current() && !controller.signal.aborted) setIndex(next);
    } catch (error) {
      if (current() && !controller.signal.aborted) fail(error);
    } finally { if (indexRead.current === controller) indexRead.current = null; }
  };
  const pageIdRef = useRef<string | null>(null);
  const lastAgentRevision = useRef(0);
  pageIdRef.current = page?.id ?? null;
  useEffect(() => {
    if (!visible || !index || navigation.userPending) return;
    const id = index.activeId ?? index.order[0]?.id;
    if (!id || (id === pageIdRef.current && projectMatches && lastAgentRevision.current === agentRevision)) return;
    const request = navigation.begin("sync");
    api.getPage(id, request.signal).then(next => {
      if (!request.current()) return;
      ops.resetHistory();
      setSelectedIds([]);
      setPage(next);
      lastAgentRevision.current = agentRevision;
    }).catch(error => { if (request.current()) fail(error); }).finally(request.finish);
    return request.cancel;
  }, [visible, index?.project?.id, index?.activeId, agentRevision]);

  // The shared context refreshes metadata and announces completed MCP changes.
  // Ordinary document writes keep the canvas's in-progress edits intact.
  const liveHandlerRef = useRef<(event: AppEvent) => void>(() => { });
  liveHandlerRef.current = (event: AppEvent) => {
    if (event.type === "document") {
      if (event.action === "import" && event.pageId) refreshPage(event.pageId).catch(fail);
      return;
    }
  };
  useEffect(() => onAppEvent((event) => liveHandlerRef.current(event)), []);
  useEffect(() => {
    const saved = (id: string) => {
      const next = cachedPage(id);
      if (next) setPage((previous) => previous?.id === id ? { ...previous, objects: next.objects, revision: next.revision } : previous);
    };
    const unsubscribeSaved = subscribeSaved(saved);
    const imported = (event: Event) => {
      const task = (event as CustomEvent<AssetTask>).detail;
      if (task.attached && task.target) void refreshPage(task.target.page_id).catch(fail);
    };
    window.addEventListener("gcs:asset-ready", imported);
    return () => { unsubscribeSaved(); window.removeEventListener("gcs:asset-ready", imported); };
  }, []);

  const showProject = async (next: PageIndex) => {
    const request = navigation.begin("user", JSON.stringify([next.project?.id, visible]));
    try {
      await navigation.settled();
      if (!request.current()) throw new DOMException("Superseded project request", "AbortError");
      const id = next.activeId ?? next.order[0]?.id;
      const nextPage = id ? await api.getPage(id, request.signal) : null;
      if (!request.current()) throw new DOMException("Superseded project request", "AbortError");
      setIndex(next); ops.resetHistory(); setSelectedIds([]); setPage(nextPage);
    } finally { request.finish(); }
  };
  const prepareProjectChange = async (otherPageId?: string | null) => {
    const request = navigation.begin();
    try {
      if (page) await flushEdits(page.id);
      if (otherPageId && otherPageId !== page?.id) await flushEdits(otherPageId);
      await navigation.settled();
      if (!request.current()) throw new DOMException("Superseded project request", "AbortError");
    } finally { request.finish(); }
  };

  return { saveState, reloadIndex, showProject, prepareProjectChange, navigation };
}
