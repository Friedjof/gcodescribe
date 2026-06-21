# 09 — Generalisierung auf weitere Canvas

Nachdem der Designer-MVP getestet und nachgeschärft ist, wird das Feature auf
weitere Canvas ausgerollt (z. B. **Game-Generate-Canvas**).

## Was ist bereits generisch?

- Transport, Protokoll-Envelope, `useLiveStream`, `<LiveButton>`,
  Viewer-Discovery, Backend-Relay & Session-Manager: **canvas-unabhängig**.

## Was ein neuer Canvas mitbringen muss

1. **StreamSource-Adapter** (`sources/<canvas>Source.ts`):
   - `getSnapshot()`, `subscribe()`, `onCursor()`, `getMeta()`.
   - Allowlist-Serialisierung der canvas-spezifischen Daten.
2. **Viewer-Renderer** registrieren:
   - `rendererRegistry["game-generate"] = GameGenerateView` (read-only).
   - Idealerweise denselben Render-Kern wiederverwenden wie der Editor.
3. **Live-Button platzieren** im jeweiligen Canvas-UI.

## Patch-Schema pro Canvas

Das `patch.ops`-Schema ist canvas-spezifisch. Der Kern reicht es nur durch
(größen-/typgeprüft). Jeder Adapter + zugehöriger Renderer teilen sich ein
eigenes, versioniertes Sub-Schema (`sourceId` + lokale `ops`-Typen).

## Single-Active-Stream über Canvas hinweg

Der App-weite Stream-Kontext stellt sicher: Start auf Canvas B beendet
automatisch den laufenden Stream von Canvas A (eine Verbindung, ein Viewer-Tab).

## Checkliste "neuen Canvas anbinden"

- [ ] Adapter implementiert + Unit-Tests für `toStreamObject`/Snapshot.
- [ ] Read-only Renderer extrahiert/registriert.
- [ ] Live-Button integriert, i18n-Strings ergänzt.
- [ ] Cursor-Normalisierung gegen den Canvas-Viewport geprüft.
- [ ] Manueller E2E-Test (zwei Screens).
