import { useCallback, useEffect, useRef, useState } from "react";
import { api, type GcodePreview3D } from "../../../api";

/** A closed or replaced preview cannot be reopened by an older network result. */
export function useJobPreview(visible: boolean, onError: (message: string) => void) {
  const [preview, setPreview] = useState<{ name: string; data: GcodePreview3D | null }>();
  const current = useRef<AbortController | null>(null);
  const error = useRef(onError); error.current = onError;
  const close = useCallback(() => { current.current?.abort(); current.current = null; setPreview(undefined); }, []);
  useEffect(() => { if (!visible) close(); return () => current.current?.abort(); }, [visible, close]);
  const open = useCallback((name: string) => {
    current.current?.abort();
    const controller = new AbortController(); current.current = controller;
    setPreview({ name, data: null });
    api.jobPreview3D(name, controller.signal).then((data) => {
      if (!controller.signal.aborted) setPreview({ name, data });
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      error.current(failure instanceof Error ? failure.message : String(failure));
      setPreview(undefined);
    });
  }, []);
  return { preview, open, close };
}
