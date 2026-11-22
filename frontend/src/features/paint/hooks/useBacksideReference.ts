import { useEffect, useRef, useState } from "react";
import { api, type Page, type PageMeta } from "../../../api";
import { cachedPage, subscribeEdits, subscribeSaved } from "../../../api/pageEdits";
import { errorMessage, isAbortError } from "../../../api/errors";
import { readBacksideSettings, type BacksideSettings } from "../lib/backside";

/** A read-only reference. It never enters the current slide's document or plot data. */
export function useReferencePage(id: string | undefined, projectId: string | undefined, modified: number | undefined, active: boolean) {
  const [loaded, setLoaded] = useState<{ key: string; page?: Page; error?: string } | null>(null);
  const key = JSON.stringify([projectId, id, modified]);
  useEffect(() => {
    if (!active || !id || !projectId) return;
    const controller = new AbortController();
    const accept = (page: Page) => {
      if (controller.signal.aborted) return;
      if (page.id !== id || page.projectId !== projectId) {
        setLoaded({ key, error: "backside.foreignSource" }); return;
      }
      setLoaded({ key, page });
    };
    api.getPage(id, controller.signal).then(page => accept(cachedPage(id) ?? page)).catch(error => {
      if (!controller.signal.aborted && !isAbortError(error)) setLoaded({ key, error: errorMessage(error) });
    });
    const fromCache = () => { const page = cachedPage(id); if (page) accept(page); };
    const edits = subscribeEdits(fromCache), saved = subscribeSaved(savedId => { if (savedId === id) fromCache(); });
    return () => { controller.abort(); edits(); saved(); };
  }, [key, active]);
  const current = active && loaded?.key === key ? loaded : null;
  return { page: current?.page ?? null, error: current?.error, loading: active && !!id && !current };
}

export function useBacksideReference(projectId: string | undefined, pageId: string | undefined, pages: PageMeta[], visible: boolean) {
  const key = `gcs.backside.v1:${projectId ?? ""}:${pageId ?? ""}`;
  const currentKey = useRef(key); currentKey.current = key;
  const [stored, setStored] = useState(() => ({ key, settings: readBacksideSettings(key) }));
  useEffect(() => { setStored({ key, settings: readBacksideSettings(key) }); }, [key]);
  const settings = stored.key === key ? stored.settings : null;
  const source = pages.find(item => item.id === settings?.sourceId && item.id !== pageId);
  const reference = useReferencePage(source?.id, projectId, source?.modified, visible && !!settings?.enabled);
  const save = (next: BacksideSettings | null) => {
    if (currentKey.current !== key) return;
    setStored({ key, settings: next });
    try {
      if (next) localStorage.setItem(key, JSON.stringify(next));
      else localStorage.removeItem(key);
    } catch { /* The current view still works if browser storage is unavailable. */ }
  };
  return { settings, source, ...reference, save,
    missing: !!settings && !source,
    enabled: !!settings?.enabled && !!reference.page && !!source,
  };
}
