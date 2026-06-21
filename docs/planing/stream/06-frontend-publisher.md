# 06 — Frontend Publisher (Live-Button & Hook)

## Neue Dateien

```
frontend/src/stream/
  protocol.ts        # geteilte Nachrichtentypen (Spiegel zu Backend)
  transport.ts       # WS-Client: connect, reconnect, heartbeat, send<T>
  useLiveStream.ts   # generischer Publisher-Hook
  viewerWindow.ts    # Viewer-Tab öffnen/wiederverwenden (Discovery)
  source.ts          # StreamSource-Interface + Registry
  LiveButton.tsx     # grüner, pulsierender Kreis
  sources/designerSource.ts   # Adapter für den Designer-Canvas
```

## `useLiveStream` (generisch)

```ts
const live = useLiveStream(source /* StreamSource */);
// live.state: "idle" | "connecting" | "live" | "error"
// live.viewers: number
// live.start(): Promise<void>   // POST /sessions, WS connect, Viewer-Tab
// live.stop(): void
```
Verhalten:
1. `start()` ruft `POST /api/stream/sessions {sourceId}` → `{sessionId,
   viewerToken, viewerUrl}`.
2. WS-Publisher-Connect; sendet `hello` mit `getSnapshot()` + `getMeta()`.
3. `source.subscribe()` → `patch`-Messages; `source.onCursor()` → `cursor`
   (gedrosselt via rAF/Throttle).
4. Öffnet/fokussiert Viewer-Tab über `viewerWindow.open(viewerUrl)`.
5. `presence` aktualisiert `live.viewers`.
6. `stop()` sendet `bye`, schließt WS.

**Single-Active-Stream-Regel**: Ein App-weiter Kontext erlaubt nur **eine**
aktive Session. Startet ein anderer Canvas einen Stream, wird der bestehende
automatisch beendet (`bye`) — exakt das gewünschte Verhalten.

## Viewer-Tab Discovery (`viewerWindow.ts`)

- Hält Referenz auf das geöffnete `window` (falls noch offen → fokussieren).
- Optional **BroadcastChannel** (`gcodescribe-live`): existiert bereits ein
  Viewer-Tab, kann er die neue Session-URL übernehmen (kein neuer Tab nötig).
- Sonst `window.open(viewerUrl, "gcodescribe-live")` → Tab kann auf den zweiten
  Screen gezogen werden.

## `<LiveButton>`

- States: `idle` (neutraler Kreis), `connecting` (pulsierend grau),
  `live` (grüner, pulsierender Kreis + Viewer-Zähler), `error` (rot).
- Tooltip/aria-label aus i18n. Klick toggelt `start()`/`stop()`.
- Reines Präsentations-Component, bekommt State aus `useLiveStream`.

## Designer-Adapter (`sources/designerSource.ts`)

Bindet an `PaintCanvas`/`Paint`:
- `getSnapshot()`: aktuelle Seite → `{ scene: SceneObject[], page, viewBox }`
  (nur Render-relevante Felder, Allowlist).
- `subscribe()`: feuert bei Szene-Änderungen (Objekt add/update/remove/reorder).
  Quelle: der bestehende State-Update-Pfad in `Paint.tsx`/`PaintCanvas.tsx`
  (kleiner Emitter/Callback, der bei jeder Mutation Deltas erzeugt).
- `onCursor()`: aus den Pointer-Events von `PaintCanvas` (normalisiert auf
  `viewBox`), gedrosselt.
- `getMeta()`: `viewBox`, Seitenformat/Aspect (aus Calibration/Page), `page`.

## Integration in den Designer

- Der Live-Button wird pro Seite in der Designer-Toolbar/Seitenleiste platziert
  (`Paint.tsx`/`PagePanel.tsx`).
- Minimaler Eingriff in `PaintCanvas`: ein optionaler `onSceneChange`/
  `onCursorMove`-Callback (no-op, wenn nicht gestreamt wird) → keine
  Performance-Kosten im Normalbetrieb.
