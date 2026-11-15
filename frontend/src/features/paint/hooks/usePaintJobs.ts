import { useEffect, useRef, useState } from "react";
import { api, type Page, type ProfileRef, type SceneObject, type GcodePreview3D } from "../../../api";
import type { PrinterStatus } from "../../../api/types/printer";
import { ApiError, errorMessage, isAbortError } from "../../../api/errors";
import { flushEdits, retainPage } from "../../../api/pageEdits";
import { useI18n } from "../../../i18n";
import { useToasts } from "../../../components/Toasts";
import type { ObjectOps } from "./useObjectOps";

/** Owns the export/send sequence and its captured page/calibration session. */
export function usePaintJobs({ page, profile, projectId, visible, status, printerBusy, ops,
  selectedIds, setSelectedIds, onAction, refresh, fail }: {
    page: Page | null; profile: ProfileRef | null; projectId?: string; visible: boolean;
    status?: PrinterStatus | null; printerBusy: boolean; ops: ObjectOps; selectedIds: string[];
    setSelectedIds: (ids: string[]) => void; onAction?: () => void;
    refresh: (force?: boolean) => Promise<unknown>; fail: (error: unknown) => void;
  }) {
  const { t } = useI18n();
  const toast = useToasts();
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [fullscreen, setFullscreen] = useState<GcodePreview3D | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [plotError, setPlotError] = useState<string | null>(null);
  const pending = useRef(false);
  const previewSequence = useRef(0);
  const scopeKey = JSON.stringify([page?.id, projectId, profile?.id, profile?.fingerprint, visible]);
  const scope = useRef({ key: scopeKey });
  if (scope.current.key !== scopeKey) scope.current = { key: scopeKey };
  useEffect(() => {
    setPlotError(null); setFullscreen(null);
  }, [scopeKey]);
  useEffect(() => {
    // React StrictMode repeats effect setup after its development cleanup.
    scope.current = { key: scopeKey };
    return () => { scope.current = { key: "unmounted" }; };
  }, []);
  const current = (session: object) => visible && scope.current === session;
  const requireCurrent = (session: object) => {
    if (!current(session)) throw new DOMException("Designer session changed", "AbortError");
  };
  const failPlot = (error: unknown) => {
    if (isAbortError(error)) return;
    setPlotError(errorMessage(error));
    if (error instanceof ApiError && error.status === 409) void refresh(true).catch(fail);
  };
  const generateJob = async (session: object, objects?: SceneObject[]) => {
    if (!page) throw new Error(t("paint.noPage"));
    if (!profile) throw new Error("Die aktuelle Projektkalibrierung wird noch geladen.");
    if (ops.processing) throw new Error(t("paint.processingGeometry"));
    setBusy(true);
    try {
      await flushEdits(page.id);
      requireCurrent(session);
      const job = await api.pageGcode(page.id, profile, objects);
      requireCurrent(session);
      toast.success(t("paint.jobCreated", { name: job.filename }));
      return job.filename;
    } finally { setBusy(false); }
  };
  const runJob = async (send: boolean, selection = false) => {
    if (!visible || pending.current || (send && (printerBusy || calibrating || !profile))) return;
    if (selection && (!page || !selectedIds.length)) return;
    const ids = [...selectedIds];
    const objects = selection ? page!.objects.filter((object) => ids.includes(object.id)) : undefined;
    if (selection && !objects?.length) return;
    const session = scope.current;
    pending.current = true; setPlotError(null);
    const release = page ? retainPage(page) : () => { };
    try {
      const filename = await generateJob(session, objects);
      if (!send) return;
      requireCurrent(session);
      setSending(true);
      await api.send(filename, true);
      // Accepted jobs belong to their original document, even after navigation.
      if (selection) ops.markPlotted(ids);
      if (current(session)) {
        toast.success(t(selection ? "paint.selectionPlotted" : "paint.jobStarted", { name: filename }));
        if (selection) setSelectedIds([]);
      }
    } catch (error) { if (current(session)) failPlot(error); }
    finally { release(); pending.current = false; setSending(false); }
  };
  const moveToCalibration = async () => {
    if (!visible || !status?.online || pending.current || printerBusy || calibrating) return;
    pending.current = true; setCalibrating(true);
    const session = scope.current;
    try { await api.homeAndMoveToPosition("calibration", projectId); onAction?.(); }
    catch (error) { if (current(session)) fail(error); }
    finally { pending.current = false; setCalibrating(false); }
  };
  const openFullscreen = async () => {
    if (!visible || !page || loadingPreview || !profile) return;
    const session = scope.current, request = ++previewSequence.current;
    setPlotError(null); setLoadingPreview(true);
    try {
      const preview = await api.pagePreview3D(page.id, page.objects, profile);
      if (current(session) && request === previewSequence.current) setFullscreen(preview);
    } catch (error) { if (current(session)) failPlot(error); }
    finally { if (request === previewSequence.current) setLoadingPreview(false); }
  };
  return {
    busy, sending, calibrating, setCalibrating, fullscreen, setFullscreen, loadingPreview, plotError, setPlotError,
    createGcode: () => { void runJob(false); }, directPlot: () => { void runJob(true); },
    plotSelection: () => { void runJob(true, true); }, moveToCalibration, openFullscreen
  };
}
