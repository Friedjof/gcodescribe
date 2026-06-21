# 02 — Modulare Stream-Architektur

## Rollenmodell

```
  [Publisher-Tab (Admin)]            [Backend Relay]            [Viewer-Tab(s)]
   Designer/Game Canvas   --WS-->   StreamSessionManager  --WS-->  Minimal Viewer
   - sendet snapshot/patch          - hält Sessions (RAM)          - empfängt & rendert
   - sendet cursor                  - relayt P->V                  - read-only
   - empfängt presence              - relayt presence V->P         - sendet nur heartbeat
```

- **1 Publisher → N Viewer** pro Session.
- Backend ist **zustandsarmes Relay** (kein Persistieren der Szene; optional ein
  letzter Snapshot im RAM für Late-Joiner, siehe `08`).

## Schichten (Frontend)

1. **Transport** (`stream/transport.ts`): WebSocket mit Reconnect,
   Heartbeat, Backoff, typsicheres Senden/Empfangen.
2. **Protokoll/Typen** (`stream/protocol.ts`): geteilte Nachrichtentypen +
   Versionsfeld. (Spiegelbild der Backend-Pydantic-Modelle.)
3. **Publisher-Kern** (`stream/useLiveStream.ts`): generischer Hook. Kennt
   *keinen* konkreten Canvas, sondern arbeitet gegen eine `StreamSource`.
4. **StreamSource (Adapter-Interface)**: pro Canvas implementiert.
   ```ts
   interface StreamSource<S = unknown> {
     id: string;                       // z.B. "designer"
     getSnapshot(): StreamSnapshot;    // voller Zustand
     subscribe(cb: (patch) => void): () => void; // Deltas
     onCursor(cb: (pt) => void): () => void;     // Mausposition
     getMeta(): StreamMeta;            // viewBox, aspect, page-info
   }
   ```
5. **UI**: `<LiveButton>` (grüner Puls), Viewer-Discovery (Tab öffnen/
   wiederverwenden).
6. **Viewer-App** (`stream/viewer/`): eigenständige, minimale Render-Seite.

## Schichten (Backend)

1. `plotter/stream/session.py`: `StreamSession`, `StreamSessionManager`
   (in-memory Registry, Token-Vergabe, Lifecycle).
2. `plotter/web/routes/stream.py`: REST (`POST /api/stream/sessions`) +
   WS-Endpoints (Publisher & Viewer).
3. Protokoll-Modelle (Pydantic) — validieren eingehende Nachrichten.

## Warum diese Trennung?

- **Ein neuer Canvas = ein neuer Adapter** (`StreamSource`), kein Eingriff in
  Transport/Protokoll/Backend.
- Viewer-Rendering wird über einen **Renderer-Registry** pro `sourceId`
  ausgewählt → der Viewer kann verschiedene Canvas-Typen anzeigen.
- Sicherheit, Reconnect, Throttling liegen **einmal** im Kern.

## Datenfluss-Entscheidungen

- Publisher sendet beim Connect/`hello` einen **vollen Snapshot**, danach
  **Deltas**. Neue Viewer erhalten den letzten Snapshot (vom Relay
  zwischengespeichert) + folgende Deltas.
- Cursor läuft als eigener, hochfrequenter aber **gedrosselter** Kanal
  (`cursor`-Messages), getrennt von Szene-Deltas.
