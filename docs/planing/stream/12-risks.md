# 12 — Risiken & Gegenmaßnahmen

| Risiko | Auswirkung | Gegenmaßnahme |
|--------|-----------|---------------|
| Mehrere uvicorn-Worker: In-memory Sessions nicht geteilt | Viewer landet bei Worker ohne Session | MVP: `--workers 1`. Ausbau: Redis-PubSub hinter gleichem Manager-Interface |
| Token-Leak (Logs/Referrer) | Fremder kann mitsehen | Token nur im URL-Fragment, nie loggen, kurze TTL, Invalidierung bei Stop |
| Viewer sendet mutierende Daten | Manipulation | Server verwirft alle Viewer-Mutationen (nicht nur Client) |
| Zu große/häufige Messages | DoS/Speicher | Größen-/Frequenz-Limits, Backpressure, Coalescing |
| Render-Drift Editor vs. Viewer | falsche Darstellung | Gemeinsamer read-only Render-Kern (`renderScene`/`SceneView`) |
| Performance-Overhead im Designer | langsamer Editor | Callbacks no-op wenn nicht gestreamt; rAF-Coalescing |
| Pop-up-Blocker verhindert Viewer-Tab | Start scheitert | Tab im direkten Klick-Handler öffnen (User-Geste); Fallback-Hinweis/Link |
| Late-Joiner sieht leeren Canvas | schlechte UX | Letzten Snapshot cachen / periodischer Snapshot bei Viewer-Join |
| HTTP statt HTTPS | WS unsicher / blockiert | `wss` in Prod erzwingen, Warnung wie `auth.httpWarning` |
| Session-Leaks (verwaiste Sessions) | Speicher | TTL + periodischer GC-Task |
| Cross-Tab-Dopplung (mehrere Viewer/Publisher) | Verwirrung | Single-Active-Stream-Kontext; BroadcastChannel-Discovery |
| Reconnect-Sturm | Last | Exponentielles Backoff + Jitter |

## Offene Entscheidungen (für Phase-1-Review)
- Snapshot-Strategie für Late-Joiner: periodischer Full-Snapshot (simpel) vs.
  Relay-seitige Szene-Map (effizienter)?
- Viewer-Token-Transport: Subprotocol vs. erste `join`-Message?
- Soll Auswahl (`select`) mitgestreamt werden (Hervorhebung im Viewer)?
- Mehrere benannte Viewer-Screens später nötig?
