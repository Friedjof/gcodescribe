# 08 — Zustands-Synchronisation

## Was wird übertragen?

1. **Snapshot** (voll): beim Start und für Late-Joiner.
   - `scene: SceneObject[]` (nur Render-Felder), `meta` (viewBox, aspect, page).
2. **Patch** (Delta): laufende Änderungen — `upsert`/`remove`/`reorder`/`select`.
3. **Cursor**: normalisierte Position + `tool`/`inside` (eigener Kanal).
4. **Meta**: Seiten-/Viewport-Wechsel (löst i. d. R. neuen Snapshot aus).

## Snapshot vs. Delta

- Publisher hält den "letzten gesendeten" Stand. Bei jeder Mutation erzeugt der
  Adapter ein minimales `patch`.
- Das **Relay cached** den letzten Snapshot (+ wendet Patches an **oder**
  fordert bei Bedarf einen frischen Snapshot vom Publisher an), damit neue
  Viewer sofort den vollständigen Stand sehen.
  - MVP-Variante (einfach): Relay speichert nur den letzten *vollen* Snapshot;
    Publisher sendet periodisch (z. B. alle N Sekunden / bei Viewer-Join via
    `presence`) einen frischen Snapshot. Robust und simpel.
  - Ausbaustufe: Relay pflegt Szene-Map und serialisiert sie für Late-Joiner.

## Throttling / Coalescing

- **Cursor**: max. ~30–60 Hz, gesendet via rAF/Throttle; bei Backpressure
  werden Zwischenpositionen verworfen (nur letzte zählt).
- **Patches**: innerhalb eines Frames bündeln (`ops[]`), statt pro Mikro-Edit
  eine Message. Bei Pen-Strokes: Punkte sammeln und als ein `upsert` senden.
- **Snapshot**: nicht bei jeder Kleinigkeit; nur Start/Resync/periodisch.

## Konsistenz & Resync

- Jede `patch` trägt eine fortlaufende `seq`. Erkennt der Viewer eine Lücke,
  fordert er (oder das Relay liefert) einen `snapshot` (Full-Resync).
- Reconnect (Publisher oder Viewer): immer mit `snapshot` starten.

## Allowlist (Datensparsamkeit & Sicherheit)

Der Designer-Adapter serialisiert **nur** Render-relevante Felder von
`SceneObject` (Geometrie, Transform, Stil, Typ, Reihenfolge). Keine internen
IDs/Profile/Job-Metadaten. Definiert als explizite Mapping-Funktion
`toStreamObject(obj): StreamSceneObject` (testbar).

## Bandbreite (Abschätzung)

- Datenbasiert statt Pixel → typischerweise wenige KB pro Edit, Cursor wenige
  Bytes. Auch über schwächere Netze flüssig.
