import { useSyncExternalStore } from "react";
import type { SetupProgress } from "./setupProgress";
import { useSetupProgressStore } from "./SetupProgressProvider";
export function useSetupProgress(projectId: string, profileId: string) {
  const store = useSetupProgressStore();
  const progress = useSyncExternalStore(store.subscribe, () =>
    store.get(projectId, profileId),
  );
  return {
    progress,
    update: (change: (value: SetupProgress) => SetupProgress) =>
      store.update(projectId, profileId, change),
    confirmProject: store.confirmProject,
  };
}
