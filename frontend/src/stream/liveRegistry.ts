import { useEffect, useState } from "react";

export type LiveRegistryState = { active: boolean; sourceId: string | null };

let current: LiveRegistryState = { active: false, sourceId: null };
let currentStop: (() => void) | null = null;
const listeners = new Set<(state: LiveRegistryState) => void>();

export function getLiveRegistryState() {
  return current;
}

export function setLiveRegistryState(next: LiveRegistryState) {
  current = next;
  for (const listener of listeners) listener(current);
}

export function setLiveRegistryStop(sourceId: string, stop: (() => void) | null) {
  if (sourceId === "" && stop === null) {
    currentStop = null;
    return;
  }
  if (current.sourceId !== sourceId && stop === null) return;
  currentStop = stop;
}

export function stopGlobalLive() {
  currentStop?.();
}

export function useLiveRegistryState() {
  const [state, setState] = useState(current);
  useEffect(() => {
    listeners.add(setState);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}
