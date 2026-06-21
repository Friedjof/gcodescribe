# 11 — Teststrategie

## Backend (pytest)
- `StreamSessionManager`: create/get/end, Token-Vergabe, Owner-Check, TTL/GC.
- WS-Relay mit `fastapi.testclient` / `httpx`-WS: Publisher→Viewer-Relay,
  Viewer-Token-Validierung (gültig/ungültig/abgelaufen), Viewer-Mutationen
  werden verworfen, `presence` korrekt.
- Limits: zu große Messages / zu hohe Frequenz → Verbindung wird geschlossen.
- Protokoll: unbekannte `t` ignoriert, Versions-Mismatch behandelt.

## Frontend (vitest)
- `protocol.ts`: Serialisierung/Typen.
- `designerSource.toStreamObject`: Allowlist (keine internen Felder), Snapshot
  korrekt, Patch-Erzeugung für add/update/remove/reorder.
- `transport.ts`: Reconnect-Backoff, Heartbeat, Coalescing (mit Fake-Timers).
- Cursor-Normalisierung/Denormalisierung round-trip.
- `renderScene`/`SceneView`: gleiche Ausgabe wie Editor-Render für Beispielszene
  (Snapshot-Test).

## Integration / E2E (manuell, dann optional Playwright)
- Zwei-Screen-Szenario: Start → Viewer-Tab → Edits sichtbar → Cursor sichtbar →
  Stop → `ended`-Screen.
- Reconnect: Publisher kurz trennen → Viewer Grace → Resync.
- Token-Sicherheit: Viewer-URL ohne/mit falschem Token → kein Zugriff.

## Nicht-funktional
- Latenz-/Bandbreiten-Sichtprüfung bei vielen Edits/Pen-Strokes.
- Lasttest: N Viewer pro Session (Backpressure-Verhalten).
