import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { SetupProgressStore } from "./setupProgressStore";
import { SETUP_STORAGE_KEY } from "./setupProgress";
const Context = createContext<SetupProgressStore | null>(null);
export function SetupProgressProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => {
    let storage: Storage | undefined;
    try {
      storage = window.localStorage;
    } catch {
      /* In-memory setup remains available. */
    }
    return new SetupProgressStore(storage);
  });
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === SETUP_STORAGE_KEY || event.key === null) store.reload();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useSetupProgressStore() {
  const store = useContext(Context);
  if (!store) throw new Error("SetupProgressProvider is missing");
  return store;
}
