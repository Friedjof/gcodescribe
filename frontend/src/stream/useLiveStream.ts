import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { setLiveRegistryState, setLiveRegistryStop } from "./liveRegistry";
import type { DesignerSnapshot, StreamMessage, StreamSessionStart, StreamState } from "./protocol";

type Cursor = { x: number; y: number; inside: boolean; tool?: string; clickId?: number };
type HookState = { state: StreamState; viewers: number; error: string | null; sourceId: string | null };

let ws: WebSocket | null = null;
let session: StreamSessionStart | null = null;
let activeSourceId: string | null = null;
let getActiveSnapshot: (() => DesignerSnapshot | null) | null = null;
let snapshotTimer: number | undefined;
let snapshotPending = false;
let cursorFrame: number | undefined;
let nextCursor: Cursor | null = null;
let clickId = 0;
let controller: HookState = { state: "idle", viewers: 0, error: null, sourceId: null };
const listeners = new Set<(state: HookState) => void>();

function wsUrl(path: string) {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}${path}`;
}

function openViewerTab(): Window | null {
  return window.open("about:blank", "gcodescribe-live");
}

function setController(patch: Partial<HookState>) {
  controller = { ...controller, ...patch };
  setLiveRegistryState({ active: controller.state === "live" || controller.state === "connecting", sourceId: controller.sourceId });
  for (const listener of listeners) listener(controller);
}

function send(message: StreamMessage) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(message));
}

function flushSnapshot(kind: "hello" | "snapshot" = "snapshot") {
  const snapshot = getActiveSnapshot?.();
  if (!snapshot || !activeSourceId) return;
  send({ v: 1, t: kind, ts: Date.now(), sourceId: activeSourceId, meta: snapshot.meta, snapshot });
}

function sendSnapshotThrottled(kind: "hello" | "snapshot" = "snapshot") {
  if (kind === "hello") {
    flushSnapshot(kind);
    return;
  }
  if (snapshotTimer != null) {
    snapshotPending = true;
    return;
  }
  flushSnapshot(kind);
  snapshotTimer = window.setTimeout(() => {
    snapshotTimer = undefined;
    if (snapshotPending) {
      snapshotPending = false;
      sendSnapshotThrottled(kind);
    }
  }, 80);
}

function clearTimers() {
  window.clearTimeout(snapshotTimer);
  snapshotTimer = undefined;
  snapshotPending = false;
  if (cursorFrame != null) cancelAnimationFrame(cursorFrame);
  cursorFrame = undefined;
  nextCursor = null;
}

function stopLive(reason = "stopped") {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ v: 1, t: "bye", ts: Date.now(), reason } satisfies StreamMessage));
  }
  ws?.close();
  ws = null;
  session = null;
  activeSourceId = null;
  getActiveSnapshot = null;
  clearTimers();
  setLiveRegistryStop(controller.sourceId ?? "", null);
  setController({ state: "idle", viewers: 0, error: null, sourceId: null });
}

async function startOrSwitch(sourceId: string, getSnapshot: () => DesignerSnapshot | null, connectionError: string) {
  const snapshot = getSnapshot();
  if (!snapshot) return;
  activeSourceId = sourceId;
  getActiveSnapshot = getSnapshot;
  setController({ sourceId, error: null });

  if (ws && ws.readyState === WebSocket.OPEN) {
    setController({ state: "live", sourceId });
    setLiveRegistryStop(sourceId, () => stopLive("global-stopped"));
    sendSnapshotThrottled("snapshot");
    return;
  }

  if (ws && ws.readyState === WebSocket.CONNECTING) return;

  setController({ state: "connecting", sourceId, error: null });
  const viewer = openViewerTab();
  try {
    const res = await fetch("/api/stream/sessions", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId }),
    });
    if (!res.ok) throw new Error(await res.text());
    session = (await res.json()) as StreamSessionStart;
    if (viewer) viewer.location.href = session.viewerUrl;
    const socket = new WebSocket(wsUrl(`/api/stream/ws/publish/${session.sessionId}`));
    ws = socket;
    socket.onopen = () => {
      setController({ state: "live", sourceId: activeSourceId });
      setLiveRegistryStop(activeSourceId ?? sourceId, () => stopLive("global-stopped"));
      sendSnapshotThrottled("hello");
    };
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data) as StreamMessage;
      if (message.t === "presence") setController({ viewers: message.viewers });
      if (message.t === "ended") stopLive(message.reason);
    };
    socket.onerror = () => {
      setController({ error: connectionError, state: "error" });
    };
    socket.onclose = () => {
      if (ws === socket) {
        ws = null;
        session = null;
        activeSourceId = null;
        getActiveSnapshot = null;
        clearTimers();
        setController({ state: "idle", viewers: 0, sourceId: null });
      }
    };
  } catch (e: any) {
    setController({ error: String(e.message ?? e), state: "error" });
    viewer?.close();
  }
}

function scheduleCursor() {
  if (cursorFrame != null) return;
  cursorFrame = requestAnimationFrame(() => {
    cursorFrame = undefined;
    const latest = nextCursor;
    nextCursor = null;
    if (latest) send({ v: 1, t: "cursor", ts: Date.now(), ...latest });
  });
}

export function useLiveStream(sourceId: string, getSnapshot: () => DesignerSnapshot | null) {
  const { t } = useI18n();
  const [local, setLocal] = useState(controller);
  const getSnapshotRef = useRef(getSnapshot);
  getSnapshotRef.current = getSnapshot;

  useEffect(() => {
    listeners.add(setLocal);
    return () => {
      listeners.delete(setLocal);
      if (activeSourceId === sourceId && getActiveSnapshot === getSnapshotRef.current) {
        const snapshot = getSnapshotRef.current();
        if (snapshot) {
          send({
            v: 1,
            t: "snapshot",
            ts: Date.now(),
            sourceId,
            meta: { ...snapshot.meta, mode: "placeholder", pageName: "standby" },
            snapshot: { ...snapshot, meta: { ...snapshot.meta, mode: "placeholder", pageName: "standby" } },
          });
        }
        activeSourceId = null;
        getActiveSnapshot = null;
        setController({ sourceId: null });
      }
    };
  }, [sourceId]);

  const start = useCallback(
    () => startOrSwitch(sourceId, () => getSnapshotRef.current(), t("live.error.connectionFailed")),
    [sourceId, t]
  );
  const stop = useCallback((reason = "stopped") => stopLive(reason), []);

  const sendSnapshot = useCallback((kind: "hello" | "snapshot" = "snapshot") => {
    if (activeSourceId !== sourceId) return;
    getActiveSnapshot = () => getSnapshotRef.current();
    sendSnapshotThrottled(kind);
  }, [sourceId]);

  const sendCursor = useCallback((cursor: { x: number; y: number; inside: boolean; tool?: string }) => {
    if (activeSourceId !== sourceId) return;
    nextCursor = cursor;
    scheduleCursor();
  }, [sourceId]);

  const sendClick = useCallback((click: { x: number; y: number; tool?: string }) => {
    if (activeSourceId !== sourceId) return;
    send({ v: 1, t: "cursor", ts: Date.now(), x: click.x, y: click.y, inside: true, tool: click.tool, clickId: ++clickId });
  }, [sourceId]);

  const sendPlaceholder = useCallback((reason = "standby") => {
    if (activeSourceId !== sourceId) return;
    const snapshot = getSnapshotRef.current();
    if (!snapshot) return;
    send({
      v: 1,
      t: "snapshot",
      ts: Date.now(),
      sourceId,
      meta: { ...snapshot.meta, mode: "placeholder", pageName: reason },
      snapshot: { ...snapshot, meta: { ...snapshot.meta, mode: "placeholder", pageName: reason } },
    });
    activeSourceId = null;
    getActiveSnapshot = null;
    setController({ sourceId: null });
  }, [sourceId]);

  return {
    state: local.state,
    viewers: local.viewers,
    error: local.error,
    activeSourceId: local.sourceId,
    start,
    stop,
    sendSnapshot,
    sendCursor,
    sendClick,
    sendPlaceholder,
  };
}
