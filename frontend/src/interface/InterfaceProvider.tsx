import { createContext, useContext, useEffect, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { InterfacePreferencesStore, INTERFACE_STORAGE_KEY } from "./preferences";
import { syncDesktopTheme, systemIsDark } from "./desktop";
const Context = createContext<InterfacePreferencesStore | null>(null);
export function InterfaceProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => {
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* Restricted webviews can disable storage. */ }
    return new InterfacePreferencesStore(storage);
  });
  const preferences = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = { theme: root.dataset.theme, density: root.dataset.density, experience: root.dataset.experience, scheme: root.style.colorScheme };
    const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const apply = () => {
      const theme = preferences.theme === "system" ? systemIsDark() ? "dark" : "light" : preferences.theme;
      root.dataset.theme = theme; root.dataset.density = preferences.density; root.dataset.experience = preferences.experience;
      root.style.colorScheme = theme;
    };
    apply(); syncDesktopTheme(preferences.theme);
    media?.addEventListener("change", apply);
    window.addEventListener("gcs:desktop-appearance", apply);
    return () => {
      media?.removeEventListener("change", apply);
      window.removeEventListener("gcs:desktop-appearance", apply);
      for (const key of ["theme", "density", "experience"] as const) {
        if (previous[key] === undefined) delete root.dataset[key]; else root.dataset[key] = previous[key];
      }
      root.style.colorScheme = previous.scheme;
    };
  }, [preferences.theme, preferences.density, preferences.experience]);
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (event.key === INTERFACE_STORAGE_KEY || event.key === null) store.reload(); };
    window.addEventListener("storage", changed); return () => window.removeEventListener("storage", changed);
  }, [store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useInterface() {
  const store = useContext(Context);
  if (!store) throw new Error("InterfaceProvider is missing");
  const preferences = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { preferences, update: store.update, resetTabs: store.resetTabs };
}
