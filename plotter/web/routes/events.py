from __future__ import annotations

import asyncio
import time
from typing import Any

from fastapi import APIRouter, WebSocket

from ...events import hub
from ...services.auth import AuthService
from ..auth import SESSION_COOKIE, auth_bypass_enabled, bypass_session

router = APIRouter(tags=["events"])


def _admin_from_ws(websocket: WebSocket) -> dict[str, Any] | None:
    if auth_bypass_enabled():
        return bypass_session()
    token = websocket.cookies.get(SESSION_COOKIE)
    return AuthService().validate_session(token)


async def _drain(websocket: WebSocket) -> None:
    # We never expect client payloads, but reading lets us notice a closed
    # socket promptly instead of only when the next event happens to be sent.
    while True:
        await websocket.receive_text()


async def _pump(websocket: WebSocket, queue: asyncio.Queue) -> None:
    while True:
        event = await queue.get()
        await websocket.send_json(event)


@router.websocket("/events/ws")
async def events_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    if _admin_from_ws(websocket) is None:
        await websocket.close(code=1008)
        return

    queue = await hub.subscribe()
    await websocket.send_json({"type": "hello", "ts": time.time()})

    # Run the event fan-out and the disconnect watcher side by side; whichever
    # finishes first (a send failure or the client closing) tears down both.
    reader = asyncio.create_task(_drain(websocket))
    pump = asyncio.create_task(_pump(websocket, queue))
    try:
        await asyncio.wait({reader, pump}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        reader.cancel()
        pump.cancel()
        hub.unsubscribe(queue)
