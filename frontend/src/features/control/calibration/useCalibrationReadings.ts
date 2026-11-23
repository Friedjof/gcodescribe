import { useCallback, useEffect, useRef, useState } from "react";
import { api, type GcodePreview, type Job, type Position } from "../../../api";
import { isAbortError } from "../../../api/errors";

/** Read-only resources. Stopping a view cancels reads, never machine commands. */
export function useCalibrationReadings({ visible, scope, connected = true, onError }: {
  visible: boolean; scope: string; connected?: boolean; onError: (error: unknown) => void;
}) {
  const session = useRef({ visible, scope, connected, epoch: 0 });
  if (session.current.visible !== visible || session.current.scope !== scope || session.current.connected !== connected)
    session.current = { visible, scope, connected, epoch: session.current.epoch + 1 };
  const epoch = session.current.epoch;
  const current = useRef({ visible, scope, epoch, onError });
  current.current = { visible, scope, epoch, onError };
  const active = useRef(false);
  const [head, setHead] = useState<{ epoch: number; value: Position } | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selection, setSelection] = useState({ scope, filename: "" });
  const [drawing, setDrawing] = useState<{ epoch: number; filename: string; value: GcodePreview } | null>(null);
  const positionRead = useRef<{ controller: AbortController; promise: Promise<void> } | null>(null);
  const jobsRead = useRef<AbortController | null>(null);
  const isCurrent = useCallback(() => active.current && current.current.visible
    && current.current.scope === scope && current.current.epoch === epoch, [scope, epoch]);

  const refreshPosition = useCallback((force = false): Promise<void> => {
    if (!connected || !isCurrent()) return Promise.resolve();
    if (positionRead.current && !force) return positionRead.current.promise;
    positionRead.current?.controller.abort();
    const controller = new AbortController();
    const promise = Promise.resolve().then(async () => {
      try {
        if (controller.signal.aborted || !isCurrent()) return;
        const value = await api.position(controller.signal);
        if (!controller.signal.aborted && isCurrent()) setHead({ epoch, value });
      } catch (error) {
        if (!controller.signal.aborted && isCurrent() && !isAbortError(error)) setHead(null);
      } finally {
        if (positionRead.current?.controller === controller) positionRead.current = null;
      }
    });
    positionRead.current = { controller, promise };
    return promise;
  }, [connected, epoch, isCurrent]);

  const updatePosition = useCallback((value: Position) => {
    if (!isCurrent()) return;
    // A confirmed command result is newer than an outstanding polling response.
    positionRead.current?.controller.abort();
    positionRead.current = null;
    setHead({ epoch, value });
  }, [epoch, isCurrent]);

  const refreshJobs = useCallback(async () => {
    if (!isCurrent()) return;
    jobsRead.current?.abort();
    const controller = new AbortController();
    jobsRead.current = controller;
    try {
      const value = await api.listJobs(controller.signal);
      if (!controller.signal.aborted && isCurrent()) setJobs(value);
    } catch { /* A failed catalogue refresh keeps the existing list. */ }
    finally { if (jobsRead.current === controller) jobsRead.current = null; }
  }, [isCurrent]);

  useEffect(() => {
    active.current = visible;
    if (!visible) return;
    void refreshPosition();
    void refreshJobs();
    const timer = connected ? window.setInterval(() => { void refreshPosition(); }, 2000) : undefined;
    return () => {
      active.current = false;
      window.clearInterval(timer);
      positionRead.current?.controller.abort();
      positionRead.current = null;
      jobsRead.current?.abort();
      jobsRead.current = null;
    };
  }, [visible, scope, connected, refreshPosition, refreshJobs]);

  const previewJob = selection.scope === scope ? selection.filename : "";
  const setPreviewJob = (filename: string) => setSelection({ scope, filename });
  useEffect(() => {
    if (!visible || !previewJob) return;
    const controller = new AbortController();
    api.jobPreview(previewJob, controller.signal).then(value => {
      if (!controller.signal.aborted && isCurrent()) setDrawing({ epoch, filename: previewJob, value });
    }).catch(error => {
      if (!controller.signal.aborted && isCurrent() && !isAbortError(error)) current.current.onError(error);
    });
    return () => controller.abort();
  }, [visible, epoch, previewJob, isCurrent]);

  return {
    pos: visible && connected && head?.epoch === epoch ? head.value : null,
    setPos: updatePosition, refreshPosition, jobs, refreshJobs, previewJob, setPreviewJob,
    preview: visible && drawing?.epoch === epoch && drawing.filename === previewJob ? drawing.value : null,
  };
}
