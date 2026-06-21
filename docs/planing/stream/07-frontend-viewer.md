# 07 — Frontend Viewer (minimalistische Seite)

## Ziel

Ein eigenständiger, **chrome-loser** Screen: nur der Canvas, groß und zentriert,
plus der Live-Cursor. Keine Navigation, keine Admin-UI, keine API-Aufrufe außer
dem WS.

## Routing / Auslieferung

- Öffentliche Route `/live` (Backend liefert `index.html`, analog `/upload`).
- Token + Session-ID kommen aus dem **URL-Fragment**: `/live#s=...&k=...`.
- In `App.tsx` (oder vor dem `AuthGate`) wird `location.pathname === "/live"`
  erkannt und die **Viewer-App** statt der Admin-App gerendert — der `AuthGate`
  wird für `/live` übersprungen (Viewer braucht keinen Admin-Login).

```tsx
if (location.pathname.startsWith("/live")) return <LiveViewer />;
```

## Komponenten

```
frontend/src/stream/viewer/
  LiveViewer.tsx        # Layout, Verbindungslogik, Statuszustände
  ViewerCanvas.tsx      # read-only Renderer-Auswahl je sourceId
  CursorOverlay.tsx     # Live-Cursor (normalisierte Position -> Pixel)
  rendererRegistry.ts   # sourceId -> Renderer-Component
```

## Render-Wiederverwendung (wichtig für Modularität)

- Aus `PaintCanvas.tsx` wird der **reine Zeichen-Teil** extrahiert in z. B.
  `frontend/src/paint/renderScene.ts` / `<SceneView>` (read-only, ohne Events,
  Drag, Tools). Sowohl Designer als auch Viewer nutzen denselben Kern →
  identische Darstellung, kein Drift.
- `rendererRegistry["designer"] = SceneView`. Weitere Canvas registrieren
  später ihren Renderer (siehe `09`).

## Zustände der Viewer-UI

- `connecting`: dezenter Spinner/Logo.
- `live`: Canvas + Cursor.
- `paused/idle`: Publisher kurz weg → "verbinde erneut…" (Grace-Period).
- `ended`: ruhiger Hinweis-Screen ("Übertragung beendet").
- `error`: Token ungültig/abgelaufen → neutrale Meldung (keine Details).

## Cursor-Rendering

- Eingehende `cursor`-Messages (0..1) werden auf die aktuelle Canvas-Pixelgröße
  gemappt. Sanftes Interpolieren (lerp) zwischen Updates für flüssige Bewegung.
- `inside=false` → Cursor ausblenden.

## Performance

- Viewer rendert nur bei eingehenden Updates (kein Dauer-rerender).
- `snapshot` ersetzt komplette Szene; `patch` mutiert lokal gehaltene Map.
- Optional `requestAnimationFrame`-Coalescing für Cursor + Patches.
