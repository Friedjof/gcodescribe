import { useMemo, useRef } from "react";

/** Stable event props for a memoized view, always invoking the current closures. */
export function useLatestCallbacks<T extends Record<string, (...args: any[]) => any>>(callbacks: T): T {
  const latest = useRef(callbacks);
  latest.current = callbacks;
  return useMemo(() => Object.fromEntries(Object.keys(callbacks).map((key) => [key,
    (...args: any[]) => latest.current[key](...args),
  ])) as T, []);
}
