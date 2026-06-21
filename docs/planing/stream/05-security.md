# 05 — Sicherheit

Das Feature öffnet einen **öffentlichen** Kanal (Viewer). Daher strikte Trennung
zwischen Admin-Publisher und Read-only-Viewer.

## Authentifizierung & Autorisierung

| Rolle | Auth | Rechte |
|-------|------|--------|
| Publisher | `require_admin` (bestehende Session/Cookie) | Session erstellen, senden |
| Viewer | **Viewer-Token** (pro Session, opak, zufällig ≥128 bit) | nur empfangen |

- Viewer-Token ist **nicht** die Admin-Session und gewährt **keinen** Zugriff
  auf `/api/...`-Admin-Routen.
- Token ist **session-gebunden** und **kurzlebig** (verfällt mit Session-Ende /
  TTL). Optional one-shot rotierbar.

## Token-Transport (Tab auf zweitem Screen)

- Viewer-URL: `/live#s=<sessionId>&k=<token>` — Token im **Fragment**.
  - Fragmente werden nicht an den Server gesendet → nicht in Access-Logs.
  - Der Viewer-Client liest das Fragment und nutzt den Token beim WS-Connect
    (als `Sec-WebSocket-Protocol` Subprotocol **oder** erste `join`-Message).
- Kein Token in Query-Strings (Logging/Referrer-Risiko).

## WebSocket-Härtung

- **Origin-Check**: WS nur von erlaubten Origins (gleiche Site) akzeptieren.
- **Nachrichten-Limits**: max. Größe je Message (z. B. 256 KB Snapshot, 8 KB
  Patch/Cursor), max. Frequenz (Cursor gedrosselt, Patches gebündelt).
- **Input-Validierung**: alle eingehenden Messages via Pydantic; unbekannte/
  fehlerhafte verwerfen, bei Missbrauch Verbindung schließen.
- **Viewer = stumm**: alle mutierenden Viewer-Messages werden serverseitig
  ignoriert (Defense-in-Depth, nicht nur Client-seitig).
- **Rate-/Resource-Limits**: max. gleichzeitige Sessions, max. Viewer/Session;
  Backpressure bei langsamen Viewern (Drop-/Coalesce-Strategie für Cursor).

## Datensparsamkeit

- Es werden nur die zum Rendern nötigen Szenendaten gestreamt — **keine**
  Profil-, Drucker-, Auth- oder internen Metadaten.
- Adapter definiert eine **Allowlist** der gesendeten Felder (kein blindes
  Serialisieren des internen States).

## Missbrauch & Privacy

- Viewer-Token nie loggen. Session-IDs in Logs gekürzt.
- Beim Beenden: `ended` an alle Viewer, WS schließen, Token invalidieren.
- Optional: sichtbarer Hinweis im Publisher ("Live — N Zuschauer"), damit dem
  Admin bewusst ist, dass öffentlich übertragen wird.

## Transport

- In Produktion **wss** (TLS) erzwingen; bei `http`-Kontext warnen (analog zur
  bestehenden `auth.httpWarning`).
