// Single, app-wide WebSocket to /api/events/ws. The backend pushes live
// updates here (document changes, MCP tool usage) so the UI can refresh the
// affected data and surface notifications instead of polling or forcing a
// manual page reload. Components subscribe via onAppEvent; the socket opens on
// the first subscription and reconnects automatically.

export type AppEvent =
  | { type: "hello"; ts: number }
  | { type: "document"; ts: number; action: "create" | "save" | "delete" | "active" | "reorder"; pageId?: string | null; mcp?: boolean }
  | { type: "mcp"; ts: number; tool: string; ok: boolean; changed?: boolean };

type Listener = (event: AppEvent) => void;

const listeners = new Set<Listener>();
let ws: WebSocket | null = null;
let started = false;
let reconnectTimer: number | undefined;
let reconnectDelay = 1000;

function wsUrl(path: string) {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}${path}`;
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const socket = new WebSocket(wsUrl("/api/events/ws"));
  ws = socket;
  socket.onopen = () => {
    reconnectDelay = 1000;
  };
  socket.onmessage = (ev) => {
    let event: AppEvent;
    try {
      event = JSON.parse(ev.data) as AppEvent;
    } catch {
      return;
    }
    for (const listener of [...listeners]) listener(event);
  };
  socket.onclose = () => {
    if (ws === socket) ws = null;
    scheduleReconnect();
  };
  socket.onerror = () => {
    socket.close();
  };
}

function scheduleReconnect() {
  if (!started || reconnectTimer != null || listeners.size === 0) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined;
    reconnectDelay = Math.min(reconnectDelay * 2, 15000);
    connect();
  }, reconnectDelay);
}

/** Subscribe to live app events. Returns an unsubscribe function. */
export function onAppEvent(listener: Listener): () => void {
  listeners.add(listener);
  if (!started) {
    started = true;
    connect();
  } else if (!ws) {
    connect();
  }
  return () => {
    listeners.delete(listener);
  };
}
