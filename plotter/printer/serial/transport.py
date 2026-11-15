"""Serial transport abstraction, protocol constants and G-code line prep."""

from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Protocol

DEFAULT_PORT = "/dev/ttyUSB0"
DEFAULT_BAUD = 115200

# How long to wait for an "ok" before giving up on a line. Generous because a
# long G1 move only gets its "ok" once Marlin's planner buffer has room.
ACK_TIMEOUT = 30.0
# Cap the wait for the boot banner; many boards reset on connect (DTR) and emit
# "start" within a few seconds, but some are silent — fall back after a quiet gap.
BANNER_TIMEOUT = 12.0
BANNER_QUIET = 1.5
# Backoff between reconnect attempts so a missing printer doesn't spin the CPU.
RECONNECT_DELAY = 3.0

# Job states.
IDLE = "idle"
LOADED = "loaded"
PRINTING = "printing"
PAUSED = "paused"

STATE_LABELS = {
    IDLE: "Operational",
    LOADED: "Operational",
    PRINTING: "Printing",
    PAUSED: "Paused",
}


class SerialTransport(Protocol):
    """Minimal subset of ``serial.Serial`` the worker relies on (injectable)."""

    is_open: bool

    def write(self, data: bytes) -> int | None: ...
    def readline(self) -> bytes: ...
    def reset_input_buffer(self) -> None: ...
    def close(self) -> None: ...


TransportFactory = Callable[[str, int], SerialTransport]


def default_transport(port: str, baud: int) -> SerialTransport:
    import serial  # lazy: only needed when serial mode is actually used

    return serial.Serial(port=port, baudrate=baud, timeout=1.0, write_timeout=10.0)


def prepare_lines(text: str) -> list[str]:
    """Strip comments/blank lines so only real G-code is streamed."""
    out: list[str] = []
    for raw in text.splitlines():
        line = raw.split(";", 1)[0].strip()
        if line:
            out.append(line)
    return out


class Command:
    """An immediate (non-print) command, run by the worker between job lines."""

    def __init__(self, lines: list[str], *, purpose: str = "manual", generation: int | None = None):
        self.lines = lines
        self.purpose = purpose
        self.generation = generation
        self.done = threading.Event()
        self.error: Exception | None = None
