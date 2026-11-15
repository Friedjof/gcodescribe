import { useEffect, useRef, useState } from "react";
import { api, onAppEvent, type AppEvent, type Page, type PageIndex } from "../../../api";
import type { AssetTask } from "../../../api/assetTasks";
import { cachedPage, editState, refreshPage, subscribeEdits, subscribeSaved } from "../../../api/pageEdits";
import type { ObjectOps } from "./useObjectOps";

/** Synchronizes saved documents and remote imports without replacing local drafts. */
export function usePaintDocument({ page, setPage, index, setIndex, projectMatches, visible,
  agentRevision, ops, setSelectedIds, refresh, fail }: {
    page: Page | null; setPage: React.Dispatch<React.SetStateAction<Page | null>>;
    index: PageIndex | null; setIndex: (index: PageIndex) => void; projectMatches: boolean;
    visible: boolean; agentRevision: number; ops: Pick<ObjectOps, "resetHistory">;
    setSelectedIds: (ids: string[]) => void; refresh: () => Promise<unknown>; fail: (error: unknown) => void;
  }) {
  const [, setSaveTick] = useState(0);
  useEffect(() => subscribeEdits(() => setSaveTick((tick) => tick + 1)), []);
  const saveState = page ? editState(page.id) : { pending: false, error: undefined, conflict: false };
  const reloadIndex = () => refresh().catch(fail);
  const pageIdRef = useRef<string | null>(null);
  const lastAgentRevision = useRef(0);
  pageIdRef.current = page?.id ?? null;
  useEffect(() => {
    if (!visible || !index) return;
    const id = index.activeId ?? index.order[0]?.id;
    if (!id || (id === pageIdRef.current && projectMatches && lastAgentRevision.current === agentRevision)) return;
    const controller = new AbortController();
    api.getPage(id, controller.signal).then(next => {
      if (controller.signal.aborted) return;
      ops.resetHistory();
      setSelectedIds([]);
      setPage(next);
      lastAgentRevision.current = agentRevision;
    }).catch(fail);
    return () => controller.abort();
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
    const id = next.activeId ?? next.order[0]?.id;
    const nextPage = id ? await api.getPage(id) : null;
    setIndex(next); ops.resetHistory(); setSelectedIds([]);
    setPage(nextPage);
  };

  return { saveState, reloadIndex, showProject };
}
