from __future__ import annotations

import asyncio
import time
from typing import Any

# Lightweight, in-process pub/sub hub for pushing live updates to connected
# browser clients over a WebSocket. Any layer that mutates shared state (the
# document store, the MCP tool surface, …) calls ``hub.publish(...)`` and every
# connected ``/api/events/ws`` socket receives the event, so the UI can refresh
# the affected data without polling or a manual page reload.
#
# Publishing is thread-safe: mutations may run on a worker thread (e.g. the
# serial printer worker or a sync service call), while the WebSocket fan-out
# lives on the asyncio event loop. ``publish`` therefore hops onto the loop via
# ``call_soon_threadsafe``. If no client has ever connected there is no loop to
# target yet and publishing is a cheap no-op.


class EventHub:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    async def subscribe(self) -> asyncio.Queue:
        """Register the calling WebSocket coroutine and return its event queue."""
        self._loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue(maxsize=256)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._subscribers.discard(queue)

    def publish(self, type: str, **data: Any) -> None:
        """Broadcast an event to all connected clients. Safe to call from any
        thread; a no-op until at least one client has connected."""
        loop = self._loop
        if loop is None or not loop.is_running() or not self._subscribers:
            return
        event = {"type": type, "ts": time.time(), **data}
        try:
            loop.call_soon_threadsafe(self._dispatch, event)
        except RuntimeError:
            # Loop is shutting down; drop the event rather than raise into the
            # mutating caller.
            pass

    def _dispatch(self, event: dict) -> None:
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # A client that cannot keep up loses the oldest pending event so
                # one slow socket never blocks the whole fan-out.
                try:
                    queue.get_nowait()
                    queue.put_nowait(event)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass


hub = EventHub()
