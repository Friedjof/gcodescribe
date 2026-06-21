# 01 — Relevanter Ist-Zustand

## Frontend (React + Vite + TypeScript SPA)

- `frontend/src/App.tsx`: Tab-Shell. Tabs: `paint | games | gallery | convert |
  paper | calibrate | control`. Schwere Tabs sind `KEEP_ALIVE` (einmal gemountet,
  per `display` versteckt). Auth-Gate (`AuthGate`) umschließt die App.
- `frontend/src/components/Paint.tsx`: Designer-Tab (Seiten, Zustand, Aktionen).
- `frontend/src/components/PaintCanvas.tsx`: der eigentliche Canvas. Enthält:
  - `SceneObject`-basierte Szene, Werkzeuge (`Tool = select|pen|line|rect|
    circle|semicircle|text`).
  - Geometrie-/Transform-Logik (`../paint/geometry`), `ViewBox`, Drag/Resize.
  - Maus-Events (Pointer) — Quelle für Cursor & Live-Edits.
- `frontend/src/paint/`: reine Funktionen (`geometry.ts`, `sceneObjects.ts`,
  `insertAsset.ts`, `text.ts`, `styling.ts`) — gut testbar, wiederverwendbar.
- `frontend/src/api.ts`: Typen (`SceneObject`, `Page`, `Calibration`, …) und
  API-Client.

### Konsequenz
Der Render- und Geometrie-Kern ist bereits weitgehend von der UI trennbar. Für
den Viewer wollen wir den **reinen Render-Teil** von `PaintCanvas` extrahieren
(read-only), ohne Event-/Editier-Logik.

## Backend (FastAPI)

- `plotter/web/app.py`: `create_app()`. Router werden mit Prefix `/api`
  eingebunden; geschützte Module via `Depends(require_admin)`.
  - Öffentliche Routen: `auth`, `gallery` (ungeschützt eingebunden), plus
    statischer SPA-Mount und `GET /upload` (öffentliche Event-Submission).
- `plotter/web/auth.py`: `require_admin` (Session/Cookie, TOTP-Setup-Flow).
- `plotter/web/routes/pages.py`: Seiten-/Szenen-Verwaltung (Designer-Daten).
- `plotter/web/server.py`: uvicorn-Start.

### Konsequenz
- Neuer Router `stream` wird eingebunden. **Publisher-WS** nutzt `require_admin`,
  **Viewer-WS** ist öffentlich, aber **token-scoped** (kein Admin-Zugriff).
- WS-Auth muss sauber gelöst werden (Cookie für Publisher, Token für Viewer),
  siehe `05-security.md`.

## Auslieferung

- SPA wird statisch gemountet; `/upload` zeigt `index.html`. Analog kann eine
  öffentliche Viewer-Route bedient werden (gleiches `index.html`, Client-Routing
  entscheidet anhand des Pfads/Fragments).
