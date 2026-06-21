# 03 — WebSocket-Protokoll

Alle Nachrichten sind JSON-Objekte mit `t` (type) und `v` (Protokollversion).
Version erlaubt spätere, abwärtskompatible Erweiterungen.

```ts
type ProtocolVersion = 1;
interface Envelope { v: ProtocolVersion; t: string; ts: number; }
```

## Richtung Publisher → Backend → Viewer

| `t` | Felder | Zweck |
|-----|--------|-------|
| `hello` | `sourceId`, `meta`, `snapshot` | Start/Resync: voller Zustand |
| `snapshot` | `meta`, `scene` | Voller Szenenstand (Resync) |
| `patch` | `ops[]` | Inkrementelle Änderungen (siehe unten) |
| `cursor` | `x`, `y`, `inside`, `tool?` | Mausposition (normalisiert 0..1) |
| `meta` | `viewBox`, `aspect`, `page` | Viewport-/Seitenwechsel |
| `bye` | `reason` | Publisher beendet Session |

### Patch-Ops (Designer)
```ts
type PatchOp =
  | { op: "upsert"; obj: SceneObject }
  | { op: "remove"; id: string }
  | { op: "reorder"; ids: string[] }
  | { op: "select"; ids: string[] };   // optional, nur Hervorhebung
```
`patch` ist canvas-spezifisch; das Schema lebt beim Adapter. Der Kern reicht
`ops` nur durch und validiert grob (Größe, Typ).

### Cursor (normalisiert)
`x`/`y` sind auf den Canvas-Viewport normalisiert (0..1), damit der Viewer in
beliebiger Auflösung korrekt positioniert. `inside=false` blendet den Cursor aus.

## Richtung Viewer → Backend

| `t` | Felder | Zweck |
|-----|--------|-------|
| `join` | `token` | Beitritt (Token wird auch in der WS-URL/Subprotocol geprüft) |
| `ping` | — | Heartbeat |

Viewer dürfen **keine** mutierenden Nachrichten senden; das Backend verwirft sie.

## Backend → Publisher (Control/Presence)

| `t` | Felder | Zweck |
|-----|--------|-------|
| `presence` | `viewers` | Anzahl verbundener Viewer |
| `accepted` | `sessionId` | Verbindung akzeptiert |
| `error` | `code`, `message` | Fehler (z. B. Token ungültig, Limit) |

## Backend → Viewer (Control)

| `t` | Felder | Zweck |
|-----|--------|-------|
| `ready` | `sourceId`, `meta` | bereit, Renderer wählen |
| `ended` | `reason` | Session beendet → Hinweis-Screen |
| `pong` | — | Heartbeat-Antwort |

## Versionierung & Limits

- Unbekannte `t` werden ignoriert (forward-compatible).
- Mismatch bei `v` → `error`/`ended` mit klarer Meldung.
- Max. Nachrichtengröße & Frequenz: siehe `05-security.md`.
