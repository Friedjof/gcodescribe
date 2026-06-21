# 04 — Backend-Design (FastAPI)

## Neue Module

```
plotter/stream/
  __init__.py
  session.py        # StreamSession, StreamSessionManager (in-memory)
  protocol.py       # Pydantic-Modelle der Nachrichten
plotter/web/routes/stream.py   # REST + WS-Endpoints
```

## Session-Manager

```python
@dataclass
class StreamSession:
    id: str
    source_id: str
    owner: str                 # admin username
    viewer_token: str          # opaque, kurzlebig
    created: float
    publisher: WebSocket | None = None
    viewers: set[WebSocket] = field(default_factory=set)
    last_snapshot: dict | None = None   # für Late-Joiner
    last_meta: dict | None = None

class StreamSessionManager:
    def create(self, owner, source_id) -> StreamSession   # erzeugt id+token
    def get(self, session_id) -> StreamSession | None
    def end(self, session_id, reason)
    def attach_publisher / attach_viewer / detach(...)
    def relay_to_viewers(session, message)
    def gc(self)   # verwaiste Sessions/TTL aufräumen
```

In-memory (ein Worker). Bei mehreren Workern später: Redis-PubSub-Backend hinter
gleichem Interface (siehe `12-risks.md`). MVP: `--workers 1`.

## REST-Endpoint (Publisher startet Session)

```
POST /api/stream/sessions           (require_admin)
  body: { sourceId: "designer" }
  -> { sessionId, viewerToken, viewerUrl }
```
- Optional: bestehende Session des gleichen Owners/Source wird ersetzt
  ("andere Canvas-View streamen → alte Verbindung beenden").
- `viewerUrl` enthält Token **im URL-Fragment** (`/live#s=<id>&k=<token>`),
  damit der Token nicht in Server-Logs/Requests landet (Fragment wird nicht
  gesendet; der Client liest es und nutzt es beim WS-Connect).

## WebSocket-Endpoints

```
WS /api/stream/ws/publish/{session_id}      # Publisher
   - Auth: require_admin (Cookie/Session) + owner-Check
WS /api/stream/ws/view/{session_id}         # Viewer
   - Auth: viewer_token (Subprotocol oder erste join-Message)
```

### Publisher-Loop
1. Authentifizieren, Session prüfen (owner == aktueller Admin).
2. `attach_publisher`; erste `hello`/`snapshot` als `last_snapshot` cachen.
3. Eingehende Messages validieren (Pydantic) → an Viewer relayen.
4. `presence` an Publisher schicken, wenn Viewer joinen/leaven.
5. Disconnect → `ended` an Viewer, Session TTL startet (kurzer Reconnect-Grace).

### Viewer-Loop
1. Token gegen Session prüfen; ungültig → close (Policy 1008).
2. `attach_viewer`; sofort `ready` + letzten `snapshot`/`meta` senden.
3. Folgende Publisher-Messages relayen. Viewer-Input außer `ping` verwerfen.
4. Disconnect → `detach`, `presence` aktualisieren.

## Einbindung in `create_app()`

```python
from .routes import stream
app.include_router(stream.router, prefix="/api")
# WS-Auth wird pro Endpoint gelöst (nicht über den globalen require_admin-Dep).
```
Öffentliche Viewer-Route im SPA-Mount: analog zu `/upload` ein
`GET /live` → `index.html` (Client-Routing rendert die Viewer-App).

## Lifecycle / GC

- TTL pro Session (z. B. 5 min ohne Publisher → Cleanup).
- Globales Limit aktiver Sessions + Viewer pro Session (`05`).
- Hintergrund-Task (`asyncio`) ruft periodisch `gc()`.
