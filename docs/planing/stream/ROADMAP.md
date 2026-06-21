# ROADMAP — Live Canvas Streaming

Kompakte Reihenfolge. Details je Schritt in `10-implementation-plan.md`.

## Meilenstein 1 — Designer-MVP (testbar)
1. Protokoll + Typen (FE/BE), Version 1.
2. Backend: Session-Manager + `POST /sessions` + WS-Relay (publish/view).
3. Frontend-Kern: `transport`, `useLiveStream`, `LiveButton`.
4. Designer-Adapter + minimaler Hook in `PaintCanvas`.
5. Read-only Render-Kern extrahieren (`SceneView`).
6. Viewer-App unter `/live` + Cursor-Overlay + Viewer-Tab-Öffnen.
7. **STOP → Test auf zwei Screens, Feedback einholen.**

## Meilenstein 2 — Verbesserungen (nach Feedback)
8. Cursor-Glättung, Zustände, Latenz-Tuning.
9. Late-Joiner-Snapshot + Resync (`seq`).
10. Reconnect-Grace, Backpressure, Limits.

## Meilenstein 3 — Härtung
11. Security-Review (`05`) + Tests (`11`).

## Meilenstein 4 — Ausrollen
12. Game-Generate-Canvas anbinden (Adapter + Renderer, `09`).
13. Weitere Canvas nach Bedarf.

## Meilenstein 5 — Skalierung (optional)
14. Redis-PubSub für Multi-Worker.
15. Mehrere benannte Viewer-Screens / QR-Öffnen.

---
**Aktueller Stand:** Umsetzung von Meilenstein 1 gestartet.

## Konkrete Umsetzungs-Roadmap

### Schritt 1 — Backend-Relay
- [x] In-memory `StreamSessionManager` mit Owner, Viewer-Token, letzter Snapshot.
- [x] `POST /api/stream/sessions` fuer authentifizierte Publisher.
- [x] `WS /api/stream/ws/publish/{session_id}` fuer den Admin-Publisher.
- [x] `WS /api/stream/ws/view/{session_id}` fuer read-only Viewer mit Token.
- [x] `/live` als oeffentliche SPA-Route ausliefern.

### Schritt 2 — Frontend-Stream-Kern
- [x] Gemeinsame Stream-Typen (`protocol.ts`).
- [x] Publisher-Hook (`useLiveStream`) mit Viewer-Tab-Oeffnung, WS und Stop.
- [x] Wiederverwendbarer read-only Designer-Renderer (`SceneView`).
- [x] Minimaler Viewer unter `/live` mit Cursor-Overlay.

### Schritt 3 — Designer-Anbindung
- [x] Live-Button in der Designer-Toolbar.
- [x] Designer-Snapshot aus aktueller Page/Calibration senden.
- [x] Cursorposition aus `PaintCanvas` normalisiert uebertragen.
- [x] Stop/Wechsel beendet bestehende Session.

### Schritt 4 — Verifikation
- [ ] Frontend-Build.
- [ ] Backend-Import-/Testlauf.
- [ ] Manueller Hinweis fuer Zwei-Screen-Test und bekannte MVP-Grenzen.

### Schritt 5 — MVP-Haertung
- [x] Cursor im Viewer SVG-genau rendern statt als HTML-Overlay.
- [x] Backend-Stream-Tests fuer Session, Token und Relay ergaenzen.
- [x] Publisher-Snapshots und Cursor-Updates koaleszieren/throttlen.
