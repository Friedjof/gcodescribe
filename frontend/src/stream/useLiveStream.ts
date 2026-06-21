import { useCallback, useEffect, useRef, useState } from "react";
import type { DesignerSnapshot, StreamMessage, StreamSessionStart, StreamState } from "./protocol";

function wsUrl(path: string) {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}${path}`;
}

function openViewerTab(): Window | null {
  return window.open("about:blank", "gcodescribe-live");
}

export function useLiveStream(sourceId: string, getSnapshot: () => DesignerSnapshot | null) {
  const [state, setState] = useState<StreamState>("idle");
  const [viewers, setViewers] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionRef = useRef<StreamSessionStart | null>(null);
  const snapshotTimer = useRef<number | undefined>(undefined);
  const snapshotPending = useRef(false);
  const cursorFrame = useRef<number | undefined>(undefined);
  const nextCursor = useRef<{ x: number; y: number; inside: boolean; tool?: string; clickId?: number } | null>(null);
  const lastCursor = useRef<{ x: number; y: number; inside: boolean; tool?: string } | null>(null);
  const clickId = useRef(0);
  const getSnapshotRef = useRef(getSnapshot);
  getSnapshotRef.current = getSnapshot;

  const send = useCallback((message: StreamMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(message));
  }, []);

  const flushSnapshot = useCallback((kind: "hello" | "snapshot" = "snapshot") => {
    const snapshot = getSnapshotRef.current();
    if (!snapshot) return;
    send({ v: 1, t: kind, ts: Date.now(), sourceId, meta: snapshot.meta, snapshot });
  }, [send, sourceId]);

  const sendSnapshot = useCallback((kind: "hello" | "snapshot" = "snapshot") => {
    if (kind === "hello") {
      flushSnapshot(kind);
      return;
    }
    if (snapshotTimer.current != null) {
      snapshotPending.current = true;
      return;
    }
    flushSnapshot(kind);
    snapshotTimer.current = window.setTimeout(() => {
      snapshotTimer.current = undefined;
      if (snapshotPending.current) {
        snapshotPending.current = false;
        sendSnapshot(kind);
      }
    }, 80);
  }, [flushSnapshot]);

  const stop = useCallback((reason = "stopped") => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ v: 1, t: "bye", ts: Date.now(), reason } satisfies StreamMessage));
    }
    ws?.close();
    wsRef.current = null;
    sessionRef.current = null;
    window.clearTimeout(snapshotTimer.current);
    snapshotTimer.current = undefined;
    snapshotPending.current = false;
    if (cursorFrame.current != null) cancelAnimationFrame(cursorFrame.current);
    cursorFrame.current = undefined;
    nextCursor.current = null;
    setState("idle");
    setViewers(0);
  }, []);

  const start = useCallback(async () => {
    const initialSnapshot = getSnapshotRef.current();
    if (!initialSnapshot) return;
    setState("connecting");
    setError(null);
    const viewer = openViewerTab();
    try {
      const res = await fetch("/api/stream/sessions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const session = (await res.json()) as StreamSessionStart;
      sessionRef.current = session;
      if (viewer) viewer.location.href = session.viewerUrl;
      const ws = new WebSocket(wsUrl(`/api/stream/ws/publish/${session.sessionId}`));
      wsRef.current = ws;
      ws.onopen = () => {
        setState("live");
        send({ v: 1, t: "hello", ts: Date.now(), sourceId, meta: initialSnapshot.meta, snapshot: initialSnapshot });
      };
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data) as StreamMessage;
        if (message.t === "presence") setViewers(message.viewers);
        if (message.t === "ended") stop(message.reason);
      };
      ws.onerror = () => {
        setError("Live-Verbindung fehlgeschlagen.");
        setState("error");
      };
      ws.onclose = () => {
        if (wsRef.current === ws) {
          wsRef.current = null;
          setState((current) => current === "live" || current === "connecting" ? "idle" : current);
          setViewers(0);
        }
      };
    } catch (e: any) {
      setError(String(e.message ?? e));
      setState("error");
      viewer?.close();
    }
  }, [send, sourceId, stop]);

  const scheduleCursor = useCallback(() => {
    if (cursorFrame.current != null) return;
    cursorFrame.current = requestAnimationFrame(() => {
      cursorFrame.current = undefined;
      const latest = nextCursor.current;
      nextCursor.current = null;
      if (latest) send({ v: 1, t: "cursor", ts: Date.now(), ...latest });
    });
  }, [send]);

  const sendCursor = useCallback((cursor: { x: number; y: number; inside: boolean; tool?: string }) => {
    lastCursor.current = cursor;
    nextCursor.current = cursor;
    scheduleCursor();
  }, [scheduleCursor]);

  const sendClick = useCallback((click: { x: number; y: number; tool?: string }) => {
    const cursor = { x: click.x, y: click.y, inside: true, tool: click.tool, clickId: ++clickId.current };
    lastCursor.current = cursor;
    nextCursor.current = cursor;
    send({ v: 1, t: "cursor", ts: Date.now(), ...cursor });
  }, [send]);

  useEffect(() => () => stop("unmounted"), [stop]);

  return { state, viewers, error, start, stop, sendSnapshot, sendCursor, sendClick };
}
