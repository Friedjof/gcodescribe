import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { api } from "../api";
import { onAppEvent } from "../api/events";
import { ProjectCalibrationStore } from "./projectCalibrationStore";

const Context = createContext<ProjectCalibrationStore | null>(null);

export function ProjectCalibrationProvider({ children, active = true }: { children: ReactNode; active?: boolean }) {
  const [store] = useState(() => new ProjectCalibrationStore(api));
  const agentPending = useRef(false);
  useEffect(() => {
    store.setActive(active);
    let mounted = true;
    let eventTimer: number | undefined;
    const refresh = () => {
      void store.refresh().then(() => {
        if (!mounted) return;
        if (agentPending.current) { agentPending.current = false; store.agentChanged(); }
      }).catch(() => {});
    };
    if (active) refresh();
    const timer = active ? window.setInterval(() => { if (!document.hidden) refresh(); }, 2000) : undefined;
    const visible = () => { if (!document.hidden) refresh(); };
    if (active) document.addEventListener("visibilitychange", visible);
    const unsubscribe = onAppEvent(event => {
      if (event.type === "mcp" && event.changed) {
        agentPending.current = true;
        if (!active) store.profileChanged();
      }
      if (!active) return;
      if (event.type === "hello") { refresh(); return; }
      if (event.type !== "document" && !(event.type === "mcp" && event.changed)) return;
      // Events describe writes newer than an outstanding GET. Cancel it before
      // batching the event burst so an old response cannot become authoritative.
      store.cancel();
      window.clearTimeout(eventTimer);
      eventTimer = window.setTimeout(refresh, 100);
    });
    return () => {
      mounted = false;
      window.clearInterval(timer);
      window.clearTimeout(eventTimer);
      document.removeEventListener("visibilitychange", visible);
      unsubscribe();
      store.setActive(false);
    };
  }, [active, store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export function useProjectCalibration() {
  const store = useContext(Context);
  if (!store) throw new Error("ProjectCalibrationProvider is missing");
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { ...snapshot, refresh: store.refresh, setIndex: store.setIndex, profileChanged: store.profileChanged };
}
