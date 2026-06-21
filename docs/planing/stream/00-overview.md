# 00 — Überblick, Ziele & Scope

## Vision

Auf einem zweiten Bildschirm (Besucher-/Schaufenster-Screen) läuft ein
schlichter Tab, der live zeigt, woran im Admin gerade gearbeitet wird. Der
Admin startet die Übertragung mit einem **Live-Button** direkt am Canvas. Der
Besucher sieht den Canvas groß, inkl. jeder Änderung und der Mausbewegung — wie
eine Live-Präsentation ohne Bedienelemente.

## Ziele (MVP, Phase 1 — Designer)

1. Im Designer (Paint) gibt es pro Seite einen **Live-Button**.
2. Klick startet eine **Live-Session** und öffnet (falls nötig) einen neuen
   Viewer-Tab.
3. Der Viewer zeigt den Canvas **groß und minimalistisch** (kein Chrome/UI).
4. **Alle Szene-Änderungen** werden live übertragen (Objekte, Werkzeuge,
   Auswahl optional).
5. Die **Mausposition** des Admins wird als Cursor im Viewer angezeigt.
6. Aktiver Button = **grüner, pulsierender Kreis**.
7. Übertragung lässt sich **abbrechen**; Start eines anderen Canvas-Streams
   **beendet die bestehende Verbindung**.

## Nicht-Ziele (zunächst)

- Keine Interaktion des Besuchers (read-only).
- Kein Audio/Video, kein Screen-Capture — wir übertragen **Szenendaten**, nicht
  Pixel (schärfer, kleiner, skalierbar).
- Keine Multi-Publisher-Kollaboration.
- Keine Persistenz der Session über Serverneustart hinaus.

## Designentscheidung: Daten statt Pixel

Statt den Canvas als Bild/Video zu streamen, übertragen wir die **Szene
(SceneObjects) + Viewport + Cursor**. Der Viewer rendert dieselbe Szene mit dem
gleichen Render-Kern wie der Designer. Vorteile: gestochen scharf in jeder
Auflösung, minimale Bandbreite, einfache Deltas. Voraussetzung: ein
wiederverwendbarer **read-only Renderer** (siehe `08`/`07`).

## Begriffe

- **Publisher**: authentifizierter Admin-Tab, der einen Canvas streamt.
- **Viewer**: öffentlicher, read-only Tab auf dem zweiten Screen.
- **Session**: eine aktive Übertragung (1 Publisher → N Viewer).
- **Stream-Source / Adapter**: canvas-spezifische Implementierung, die
  Snapshots, Deltas und Cursor liefert.
- **Relay**: Backend, das Nachrichten vom Publisher an Viewer weiterreicht.

## Constraint aus dem Ist-Zustand

- Frontend: React + Vite + TS SPA, vom FastAPI-Backend statisch ausgeliefert.
- Backend: FastAPI; `/api/...` Routen sind via `require_admin` geschützt.
- Es gibt bereits eine öffentliche SPA-Route (`/upload`) → Vorbild für die
  öffentliche Viewer-Route.
- WebSocket wird bisher **nicht** genutzt (FastAPI/Starlette unterstützen es).
