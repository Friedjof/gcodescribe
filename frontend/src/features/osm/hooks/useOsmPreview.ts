import { useEffect, useMemo, useRef, useState } from "react";
import { api, type OsmMapRequest, type OsmMapResponse } from "../../../api";
import { buildOsmMapTemplate } from "../../games/lib/osmMap";
import { useI18n } from "../../../i18n";

/** Keep the last drawing visible while a new request is prepared. Only a matching
 * result may be inserted; cancelled or out-of-order requests never replace it. */
export function useOsmPreview(request: OsmMapRequest | null, active = true) {
  const { t } = useI18n();
  const cache = useRef(new Map<string, OsmMapResponse>());
  const [loaded, setLoaded] = useState<{
    key: string;
    map: OsmMapResponse;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const key = request ? JSON.stringify(request) : null;
  useEffect(() => {
    if (!request || !key || !active) return;
    const cached = cache.current.get(key);
    setError(null);
    if (cached) {
      setLoaded({ key, map: cached });
      setPendingKey(null);
      return;
    }
    const controller = new AbortController();
    setPendingKey(key);
    const timer = window.setTimeout(async () => {
      try {
        const map = await api.getOsmMap(request, controller.signal);
        if (controller.signal.aborted) return;
        cache.current.set(key, map);
        while (cache.current.size > 6)
          cache.current.delete(cache.current.keys().next().value!);
        setLoaded({ key, map });
      } catch (e: unknown) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!controller.signal.aborted) setPendingKey(null);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key, active, retry]);
  const template = useMemo(
    () => (loaded ? buildOsmMapTemplate(loaded.map, t) : null),
    [loaded, t],
  );
  return {
    template,
    current: !!loaded && loaded.key === key,
    loading:
      !!key &&
      active &&
      (pendingKey === key || (!error && loaded?.key !== key)),
    error,
    refresh: () => setRetry((n) => n + 1),
  };
}
