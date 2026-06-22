from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from ...services.auth import AuthService
from ...stream import manager
from ..auth import SESSION_COOKIE, auth_bypass_enabled, bypass_session, require_admin

router = APIRouter(tags=["stream"])


class CreateStreamRequest(BaseModel):
    sourceId: str


def _admin_from_ws(websocket: WebSocket) -> dict[str, Any] | None:
    if auth_bypass_enabled():
        return bypass_session()
    token = websocket.cookies.get(SESSION_COOKIE)
    return AuthService().validate_session(token)


def _auth_bypass_enabled() -> bool:
    return auth_bypass_enabled()


@router.post("/stream/sessions")
async def create_stream_session(
    req: CreateStreamRequest, request: Request, admin: dict = Depends(require_admin)
) -> dict:
    source_id = req.sourceId.strip()
    if not source_id:
        raise HTTPException(422, "sourceId fehlt")
    session = await manager.create(str(admin.get("username") or "admin"), source_id)
    viewer_url = f"/live#s={session.id}&k={session.viewer_token}"
    return {"sessionId": session.id, "viewerToken": session.viewer_token, "viewerUrl": viewer_url}


@router.websocket("/stream/ws/publish/{session_id}")
async def publish_stream(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()
    admin = _admin_from_ws(websocket)
    session = await manager.get(session_id)
    if (
        admin is None
        or session is None
        or (not _auth_bypass_enabled() and session.owner != str(admin.get("username") or "admin"))
    ):
        await websocket.close(code=1008)
        return
    await manager.attach_publisher(session, websocket)
    await websocket.send_json({"v": 1, "t": "accepted", "ts": time.time(), "sessionId": session.id})
    await manager.send_presence(session)
    try:
        while True:
            message = await websocket.receive_json()
            if not isinstance(message, dict):
                continue
            kind = message.get("t")
            if kind in {"hello", "snapshot"}:
                await manager.update_snapshot(session, message)
                await manager.relay_to_viewers(session, message)
            elif kind == "cursor":
                await manager.relay_to_viewers(session, message)
            elif kind == "click":
                await manager.relay_to_viewers(session, message)
            elif kind == "bye":
                await manager.end(session.id, "publisher-ended")
                return
    except WebSocketDisconnect:
        await manager.detach_publisher(session, websocket)


@router.websocket("/stream/ws/view/{session_id}")
async def view_stream(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()
    session = await manager.get(session_id)
    if session is None:
        await websocket.close(code=1008)
        return
    try:
        first = await websocket.receive_json()
    except Exception:
        await websocket.close(code=1008)
        return
    if (
        not isinstance(first, dict)
        or first.get("t") != "join"
        or first.get("token") != session.viewer_token
    ):
        await websocket.close(code=1008)
        return
    await manager.attach_viewer(session, websocket)
    await websocket.send_json(
        {
            "v": 1,
            "t": "ready",
            "ts": time.time(),
            "sourceId": session.source_id,
            "meta": session.last_meta,
        }
    )
    if session.last_snapshot is not None:
        await websocket.send_json(session.last_snapshot)
    await manager.send_presence(session)
    try:
        while True:
            message = await websocket.receive_json()
            if isinstance(message, dict) and message.get("t") == "ping":
                await websocket.send_json({"v": 1, "t": "pong", "ts": time.time()})
    except WebSocketDisconnect:
        await manager.detach_viewer(session, websocket)
        await manager.send_presence(session)
