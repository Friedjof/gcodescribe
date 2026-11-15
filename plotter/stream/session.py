from __future__ import annotations

import asyncio
import secrets
import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket


@dataclass
class StreamSession:
    id: str
    source_id: str
    owner: str
    viewer_token: str
    created: float = field(default_factory=time.time)
    publisher: WebSocket | None = None
    viewers: set[WebSocket] = field(default_factory=set)
    delta_viewers: set[WebSocket] = field(default_factory=set)
    revision: int = 0
    viewer_revisions: dict[WebSocket, int] = field(default_factory=dict)
    last_snapshot: dict[str, Any] | None = None
    last_meta: dict[str, Any] | None = None


class StreamSessionManager:
    def __init__(self) -> None:
        self._sessions: dict[str, StreamSession] = {}
        self._lock = asyncio.Lock()

    async def create(self, owner: str, source_id: str) -> StreamSession:
        async with self._lock:
            for session in list(self._sessions.values()):
                if session.owner == owner:
                    await self._end_locked(session, "replaced")
            session = StreamSession(
                id=secrets.token_urlsafe(12),
                source_id=source_id,
                owner=owner,
                viewer_token=secrets.token_urlsafe(32),
            )
            self._sessions[session.id] = session
            return session

    async def get(self, session_id: str) -> StreamSession | None:
        async with self._lock:
            return self._sessions.get(session_id)

    async def attach_publisher(self, session: StreamSession, websocket: WebSocket) -> None:
        async with self._lock:
            session.publisher = websocket

    async def detach_publisher(self, session: StreamSession, websocket: WebSocket) -> None:
        async with self._lock:
            if session.publisher is websocket:
                await self._end_locked(session, "publisher-disconnected")

    async def attach_viewer(self, session: StreamSession, websocket: WebSocket,
                            *, deltas: bool = False) -> int:
        async with self._lock:
            # Subscribe only after the initial state has been delivered. Otherwise
            # a publication during join can duplicate the snapshot or overtake it.
            await websocket.send_json({"v": 1, "t": "ready", "ts": time.time(),
                                       "sourceId": session.source_id, "meta": session.last_meta})
            if session.last_snapshot is not None:
                await websocket.send_json(session.last_snapshot)
            session.viewers.add(websocket)
            session.viewer_revisions[websocket] = session.revision
            if deltas:
                session.delta_viewers.add(websocket)
            return len(session.viewers)

    async def detach_viewer(self, session: StreamSession, websocket: WebSocket) -> int:
        async with self._lock:
            session.viewers.discard(websocket)
            session.delta_viewers.discard(websocket)
            session.viewer_revisions.pop(websocket, None)
            return len(session.viewers)

    async def update_snapshot(self, session: StreamSession, message: dict[str, Any]) -> None:
        async with self._lock:
            if message.get("t") in {"hello", "snapshot"}:
                session.revision += 1
                session.last_snapshot = message
                if isinstance(message.get("meta"), dict):
                    session.last_meta = message["meta"]

    async def update_delta(self, session: StreamSession, message: dict[str, Any]) -> bool:
        async with self._lock:
            if not session.last_snapshot:
                return False
            snapshot = session.last_snapshot.get("snapshot", {})
            page = snapshot.get("page", {})
            if page.get("id") != message.get("pageId"):
                return False
            changes, removed = message.get("changes"), message.get("removed")
            if not isinstance(changes, list) or not isinstance(removed, list):
                return False
            if not all(isinstance(p, dict) and isinstance(p.get("id"), str) for p in changes):
                return False
            objects = {o["id"]: o for o in page.get("objects", []) if o["id"] not in removed}
            for patch in changes:
                objects[patch["id"]] = {**objects.get(patch["id"], {}), **patch}
            snapshot = {**snapshot, "page": {**page, "objects": list(objects.values())}}
            session.last_snapshot = {**session.last_snapshot, "snapshot": snapshot,
                                     "t": "snapshot", "ts": message.get("ts")}
            session.revision += 1
            return True

    async def relay_to_viewers(self, session: StreamSession, message: dict[str, Any]) -> None:
        dead: list[WebSocket] = []
        async with self._lock:
            viewers = list(session.viewers)
            if message.get("t") in {"hello", "snapshot", "scene-patch"}:
                viewers = [v for v in viewers
                           if session.viewer_revisions.get(v, -1) < session.revision]
                for viewer in viewers:
                    session.viewer_revisions[viewer] = session.revision
        for viewer in viewers:
            try:
                payload = (session.last_snapshot if message.get("t") == "scene-patch"
                           and viewer not in session.delta_viewers else message)
                await viewer.send_json(payload)
            except Exception:
                dead.append(viewer)
        if dead:
            async with self._lock:
                for viewer in dead:
                    session.viewers.discard(viewer)
                    session.delta_viewers.discard(viewer)
                    session.viewer_revisions.pop(viewer, None)

    async def send_presence(self, session: StreamSession) -> None:
        publisher = session.publisher
        if publisher is None:
            return
        try:
            await publisher.send_json(
                {"v": 1, "t": "presence", "ts": time.time(), "viewers": len(session.viewers)}
            )
        except Exception:
            pass

    async def end(self, session_id: str, reason: str = "ended") -> None:
        async with self._lock:
            session = self._sessions.get(session_id)
            if session:
                await self._end_locked(session, reason)

    async def _end_locked(self, session: StreamSession, reason: str) -> None:
        self._sessions.pop(session.id, None)
        message = {"v": 1, "t": "ended", "ts": time.time(), "reason": reason}
        for viewer in list(session.viewers):
            try:
                await viewer.send_json(message)
                await viewer.close(code=1000)
            except Exception:
                pass
        session.viewers.clear()
        session.delta_viewers.clear()
        session.viewer_revisions.clear()
        if session.publisher is not None:
            try:
                await session.publisher.close(code=1000)
            except Exception:
                pass
            session.publisher = None


manager = StreamSessionManager()
