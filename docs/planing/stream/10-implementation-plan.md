# 10 — Umsetzungsplan (Schritte)

Reihenfolge so geschnitten, dass nach Phase 1 ein testbarer Designer-MVP steht.

## Phase 0 — Grundlagen (Protokoll & Skelett)
- [ ] `frontend/src/stream/protocol.ts` + `plotter/stream/protocol.py`
      (gleiche Nachrichtentypen, Version 1).
- [ ] `plotter/stream/session.py`: `StreamSession`, `StreamSessionManager`
      (in-memory, Token, TTL, GC-Task).
- [ ] `plotter/web/routes/stream.py`: `POST /api/stream/sessions` (require_admin).
- [ ] In `create_app()` Router einbinden + `GET /live` → `index.html`.

## Phase 1 — Designer-MVP (Ziel: testen!)
- [ ] WS-Endpoints `…/ws/publish/{id}` (admin) und `…/ws/view/{id}` (token).
- [ ] Relay: Publisher→Viewer, `presence`, `ready`, `ended`.
- [ ] `transport.ts` (WS + Reconnect + Heartbeat), `useLiveStream.ts`.
- [ ] `LiveButton.tsx` (grüner Puls + Viewer-Zähler).
- [ ] `sources/designerSource.ts` + minimaler `onSceneChange`/`onCursorMove`
      Hook in `PaintCanvas`/`Paint`.
- [ ] Render-Kern extrahieren: `paint/renderScene` / `<SceneView>` (read-only).
- [ ] Viewer-App: `LiveViewer`, `ViewerCanvas`, `CursorOverlay`,
      `rendererRegistry["designer"]`.
- [ ] `viewerWindow.ts` (Tab öffnen, Fokus, optional BroadcastChannel).
- [ ] i18n-Strings.
- [ ] **Manueller Test auf zwei Screens.**

### Akzeptanzkriterien Phase 1
- Live-Button im Designer startet Session + öffnet Viewer-Tab.
- Viewer zeigt Canvas groß; alle Edits erscheinen live.
- Mauscursor des Admins ist im Viewer sichtbar.
- Button pulsiert grün während aktiv; Stop beendet Session sauber.
- Start eines (späteren) anderen Streams beendet den bestehenden.

## Phase 2 — Feedback & Verbesserungen
- [ ] Review mit Nutzer; UX-Feinschliff (Cursor-Glättung, Zustände, Latenz).
- [ ] Late-Joiner-Snapshot, Resync via `seq`.
- [ ] Robustheit: Reconnect-Grace, Backpressure, Limits.

## Phase 3 — Härtung & Tests
- [ ] Security-Review (Origin, Limits, Token-Lifecycle) — `05`.
- [ ] Unit-/Integrationstests — `11`.

## Phase 4 — Generalisierung
- [ ] Game-Generate-Adapter + Renderer (`09`).
- [ ] Ggf. weitere Canvas.

## Phase 5 — Optional / Skalierung
- [ ] Redis-PubSub-Backend für Multi-Worker (`12`).
- [ ] Mehrere benannte Viewer-Screens / QR-Code zum Öffnen.
