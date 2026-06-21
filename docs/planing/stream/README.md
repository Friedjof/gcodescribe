# Live-Stream / Externer Besucher-Screen — Planung

Dieses Verzeichnis beschreibt das Feature **Live Canvas Streaming**: Ein
minimalistischer externer Tab (auf einem zweiten Bildschirm) zeigt einem
Besucher live, was im Admin gerade relevant ist — zunächst der **Designer-
Canvas** (Paint), später z. B. der **Game-Generate-Canvas**.

Die Übertragung läuft über WebSocket. Jeder streambare Canvas erhält einen
**Live-Button** (grüner, pulsierender Kreis bei aktiver Übertragung). Ist kein
Viewer verbunden, wird ein neuer Tab geöffnet, der auf den zweiten Screen
gezogen werden kann. Übertragen werden Szene-Änderungen *und* die Mausposition.

## Leitprinzipien

- **Modular**: Ein generischer Stream-Kern + pro Canvas ein dünner Adapter.
- **Sicher**: Publisher = authentifizierter Admin, Viewer = read-only,
  token-scoped, kurzlebig, ohne Zugriff auf Admin-APIs.
- **Professionell**: klares Protokoll, Versionierung, Reconnect, Tests,
  saubere Lifecycle-Verwaltung.
- **Inkrementell**: erst Designer testen, dann verbessern, dann ausrollen.

## Dokumente

| Datei | Inhalt |
|-------|--------|
| `00-overview.md` | Ziele, Scope, Vision, Begriffe |
| `01-current-architecture.md` | Relevanter Ist-Zustand (Frontend/Backend) |
| `02-architecture-design.md` | Modulare Stream-Architektur, Rollenmodell |
| `03-protocol.md` | WebSocket-Nachrichtenprotokoll + Typen |
| `04-backend-design.md` | FastAPI WS-Endpoints, Session-Manager, Relay |
| `05-security.md` | Auth, Viewer-Token, Isolation, Rate-Limits |
| `06-frontend-publisher.md` | Live-Button, `useLiveStream`, Designer-Adapter |
| `07-frontend-viewer.md` | Minimalistische Viewer-Seite/Route |
| `08-state-sync.md` | Snapshot, Deltas, Cursor, Throttling |
| `09-generalization.md` | Wiederverwendung für weitere Canvas |
| `10-implementation-plan.md` | Schrittweiser Umsetzungsplan |
| `11-testing.md` | Teststrategie |
| `12-risks.md` | Risiken & Gegenmaßnahmen |
| `ROADMAP.md` | Phasen / Rollout |

## Schnelleinstieg für die Umsetzung

Siehe `10-implementation-plan.md` (Phasen) und `ROADMAP.md` (Reihenfolge).
Phase 1 (Designer-MVP) ist so geschnitten, dass danach getestet und nachjustiert
werden kann, bevor weitere Canvas folgen.
