from __future__ import annotations

import logging
import os
import threading
import time
from collections import deque
from collections.abc import Callable
from pathlib import Path
from typing import Protocol

from .base import PrinterError

log = logging.getLogger(__name__)

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

_STATE_LABELS = {
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


def _default_transport(port: str, baud: int) -> SerialTransport:
    import serial  # lazy: only needed when serial mode is actually used

    return serial.Serial(port=port, baudrate=baud, timeout=1.0, write_timeout=10.0)


def _prepare_lines(text: str) -> list[str]:
    """Strip comments/blank lines so only real G-code is streamed."""
    out: list[str] = []
    for raw in text.splitlines():
        line = raw.split(";", 1)[0].strip()
        if line:
            out.append(line)
    return out


class _Command:
    """An immediate (non-print) command, run by the worker between job lines."""

    def __init__(self, lines: list[str]):
        self.lines = lines
        self.done = threading.Event()
        self.error: Exception | None = None


class SerialWorker:
    """Owns the serial port on a single background thread.

    Every byte to/from the port goes through this thread, so there is exactly
    one writer. Request threads only enqueue immediate commands or read state
    under ``_lock`` — they never touch the port.
    """

    def __init__(
        self,
        port: str = DEFAULT_PORT,
        baud: int = DEFAULT_BAUD,
        transport_factory: TransportFactory | None = None,
    ):
        self.port = port
        self.baud = baud
        self._transport_factory = transport_factory or _default_transport

        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._queue: deque[_Command] = deque()

        self._transport: SerialTransport | None = None
        self._online = False
        self._last_error: str | None = None

        self._state = IDLE
        self._job_lines: list[str] = []
        self._job_name: str | None = None
        self._job_index = 0
        self._job_generation = 0

        self._running = True
        self._thread = threading.Thread(
            target=self._run, name="serial-worker", daemon=True
        )
        self._thread.start()

    # -- public API (called from request threads) --------------------------

    def status(self) -> dict:
        with self._lock:
            if not self._online:
                return {
                    "configured": True,
                    "backend": "serial",
                    "online": False,
                    "error": self._last_error,
                }
            job = None
            if self._state in (LOADED, PRINTING, PAUSED):
                total = len(self._job_lines)
                completion = round(self._job_index / total * 100, 1) if total else None
                job = {
                    "state": _STATE_LABELS[self._state],
                    "progress": {"completion": completion},
                    "job": {"file": {"name": self._job_name}},
                }
            return {"configured": True, "backend": "serial", "online": True, "job": job}

    def upload(self, gcode_path: Path, *, start: bool = False) -> dict:
        lines = _prepare_lines(gcode_path.read_text())
        with self._lock:
            self._job_lines = lines
            self._job_name = gcode_path.name
            self._job_index = 0
            self._job_generation += 1
            self._state = PRINTING if start else LOADED
        self._wake.set()
        # Mimic OctoPrint's upload response so callers stay backend-agnostic.
        return {"done": True, "files": {"local": {"name": gcode_path.name}}}

    def job_command(self, command: str) -> None:
        if command in ("start", "restart"):
            self._start(reset=command == "restart")
        elif command == "pause":
            self._pause()
        elif command == "cancel":
            self._cancel()
        else:
            raise PrinterError(f"unknown job command: {command}")

    def home(self, axes: list[str] | None = None) -> None:
        if axes:
            cmd = "G28 " + " ".join(a.upper() for a in axes)
        else:
            cmd = "G28"
        self._submit([cmd], wait=True)

    def jog(
        self, x: float = 0.0, y: float = 0.0, z: float = 0.0, speed: int | None = None
    ) -> None:
        move = "G1"
        if x:
            move += f" X{x:.3f}"
        if y:
            move += f" Y{y:.3f}"
        if z:
            move += f" Z{z:.3f}"
        if speed is not None:
            move += f" F{speed:.0f}"
        # Relative jog, then back to absolute — matches OctoPrint jog semantics.
        self._submit(["G91", move, "G90"], wait=True)

    def gcode(self, commands: list[str]) -> None:
        self._submit(list(commands), wait=True)

    def shutdown(self) -> None:
        self._running = False
        self._wake.set()
        self._thread.join(timeout=5.0)
        self._close_port()

    # -- job control -------------------------------------------------------

    def _start(self, *, reset: bool) -> None:
        with self._lock:
            if not self._job_lines:
                raise PrinterError("no job loaded")
            if reset:
                self._job_index = 0
                self._job_generation += 1
            self._state = PRINTING
        self._wake.set()

    def _pause(self) -> None:
        with self._lock:
            if self._state != PRINTING:
                return
            self._state = PAUSED
        # Lift the pen so a paused job can't bleed ink onto the paper.
        self._submit(self._pen_up_lines(), wait=False)

    def _cancel(self) -> None:
        with self._lock:
            self._state = IDLE
            self._job_lines = []
            self._job_name = None
            self._job_index = 0
            self._job_generation += 1
        # Quickstop flushes Marlin's planner buffer so the head stops promptly,
        # then lift the pen.
        self._submit(["M410", *self._pen_up_lines()], wait=False)

    @staticmethod
    def _pen_up_lines() -> list[str]:
        from ..calibration import Calibration

        cal = Calibration.load()
        return ["G90", f"G1 Z{cal.pen_up_z:.3f} F{cal.z_feed:.0f}"]

    # -- command submission ------------------------------------------------

    def _submit(self, lines: list[str], *, wait: bool) -> None:
        cmd = _Command(lines)
        with self._lock:
            self._queue.append(cmd)
        self._wake.set()
        if not wait:
            return
        # Block the request thread until the worker has sent it (synchronous
        # semantics, like the OctoPrint client's HTTP calls).
        if not cmd.done.wait(timeout=ACK_TIMEOUT * (len(lines) + 1)):
            raise PrinterError("timeout waiting for command to run")
        if cmd.error is not None:
            raise PrinterError(str(cmd.error))

    # -- worker thread -----------------------------------------------------

    def _run(self) -> None:
        while self._running:
            if not self._online:
                self._connect()
                if not self._online:
                    self._fail_queue("printer offline")
                    self._wake.wait(RECONNECT_DELAY)
                    self._wake.clear()
                    continue

            cmd = self._take_command()
            if cmd is not None:
                self._run_command(cmd)
                continue

            job_line = self._take_job_line()
            if job_line is not None:
                self._stream_line(*job_line)
                continue

            self._wake.wait(0.1)
            self._wake.clear()

    def _take_command(self) -> _Command | None:
        with self._lock:
            if self._queue:
                return self._queue.popleft()
        return None

    def _take_job_line(self) -> tuple[int, int, str] | None:
        with self._lock:
            if self._state != PRINTING:
                return None
            if self._job_index >= len(self._job_lines):
                # Job complete.
                self._state = IDLE
                self._job_lines = []
                self._job_name = None
                self._job_index = 0
                return None
            return (self._job_generation, self._job_index, self._job_lines[self._job_index])

    def _stream_line(self, generation: int, index: int, line: str) -> None:
        try:
            self._send_line(line)
        except PrinterError as exc:
            log.warning("serial print aborted: %s", exc)
            with self._lock:
                self._state = IDLE
                self._last_error = str(exc)
            return
        with self._lock:
            if self._job_generation == generation and self._job_index == index:
                self._job_index += 1

    def _run_command(self, cmd: _Command) -> None:
        try:
            for line in cmd.lines:
                self._send_line(line)
        except PrinterError as exc:
            cmd.error = exc
        finally:
            cmd.done.set()

    def _fail_queue(self, reason: str) -> None:
        with self._lock:
            pending = list(self._queue)
            self._queue.clear()
        for cmd in pending:
            cmd.error = PrinterError(reason)
            cmd.done.set()

    # -- connection --------------------------------------------------------

    def _resolve_port(self) -> str:
        """Resolve ``auto`` to a detected printer port (re-checked each connect)."""
        if self.port.strip().lower() != "auto":
            return self.port
        from .discovery import resolve_auto_port

        resolved = resolve_auto_port()
        if not resolved:
            raise PrinterError(
                "no serial printer auto-detected (set PRINTER_SERIAL_PORT explicitly)"
            )
        return resolved

    def _connect(self) -> None:
        try:
            self._transport = self._transport_factory(self._resolve_port(), self.baud)
            self._wait_for_banner()
            for line in ("G21", "G90"):
                self._send_line(line)
        except Exception as exc:  # noqa: BLE001 - any open/IO failure means offline
            with self._lock:
                self._online = False
                self._last_error = str(exc)
            self._close_port()
            return
        with self._lock:
            self._online = True
            self._last_error = None

    def _wait_for_banner(self) -> None:
        assert self._transport is not None
        try:
            self._transport.reset_input_buffer()
        except Exception:  # noqa: BLE001
            pass
        deadline = time.monotonic() + BANNER_TIMEOUT
        last_data = time.monotonic()
        while time.monotonic() < deadline:
            raw = self._transport.readline()
            now = time.monotonic()
            if raw:
                text = raw.decode(errors="replace").strip().lower()
                if "start" in text:
                    return
                last_data = now
            elif now - last_data > BANNER_QUIET:
                # Board was already up and is quiet — assume it's ready.
                return

    def _send_line(self, line: str) -> None:
        if self._transport is None:
            raise PrinterError("serial port not open")
        payload = (line.strip() + "\n").encode()
        try:
            self._transport.write(payload)
        except Exception as exc:  # noqa: BLE001
            self._mark_offline(exc)
            raise PrinterError(f"serial write failed: {exc}") from exc

        deadline = time.monotonic() + ACK_TIMEOUT
        while True:
            try:
                raw = self._transport.readline()
            except Exception as exc:  # noqa: BLE001
                self._mark_offline(exc)
                raise PrinterError(f"serial read failed: {exc}") from exc
            resp = raw.decode(errors="replace").strip() if raw else ""
            if resp:
                low = resp.lower()
                if low.startswith("ok"):
                    return
                if "busy" in low:
                    deadline = time.monotonic() + ACK_TIMEOUT
                elif low.startswith("error"):
                    raise PrinterError(f"printer error: {resp}")
                elif low.startswith(("resend", "rs ")):
                    # No line numbers/checksums in this mode, so we can't honour
                    # a resend — surface it instead of silently desyncing.
                    raise PrinterError(f"unsupported resend request: {resp}")
                # echo:, //, temperature reports, banner lines: ignore.
            if time.monotonic() > deadline:
                raise PrinterError(f"timeout waiting for 'ok' after: {line}")

    def _mark_offline(self, exc: Exception) -> None:
        with self._lock:
            self._online = False
            self._last_error = str(exc)
        self._close_port()

    def _close_port(self) -> None:
        transport, self._transport = self._transport, None
        if transport is not None:
            try:
                transport.close()
            except Exception:  # noqa: BLE001
                pass


# -- process-wide singleton ------------------------------------------------

_worker_lock = threading.Lock()
_worker: SerialWorker | None = None


def get_worker(
    port: str | None = None,
    baud: int | None = None,
    transport_factory: TransportFactory | None = None,
) -> SerialWorker:
    global _worker
    port = port or os.environ.get("PRINTER_SERIAL_PORT", DEFAULT_PORT)
    baud = baud or int(os.environ.get("PRINTER_SERIAL_BAUD", DEFAULT_BAUD))
    with _worker_lock:
        if _worker is None:
            _worker = SerialWorker(port, baud, transport_factory)
        return _worker


def peek_worker() -> SerialWorker | None:
    """Return the worker only if it already exists — never starts/connects it.

    Used for the lazy lifecycle: listing or polling an *inactive* serial backend
    must not open the port (which would reset the printer).
    """
    with _worker_lock:
        return _worker


def reset_worker() -> None:
    """Tear down the singleton (used by tests)."""
    global _worker
    with _worker_lock:
        if _worker is not None:
            _worker.shutdown()
            _worker = None


def shutdown_worker() -> None:
    """Stop the worker on app shutdown so the port is released."""
    reset_worker()


class SerialClient:
    """``PrinterBackend`` proxy over the process-wide :class:`SerialWorker`."""

    def __init__(
        self,
        port: str | None = None,
        baud: int | None = None,
        transport_factory: TransportFactory | None = None,
    ):
        self.port = port or os.environ.get("PRINTER_SERIAL_PORT", DEFAULT_PORT)
        self.baud = baud or int(os.environ.get("PRINTER_SERIAL_BAUD", DEFAULT_BAUD))
        self._transport_factory = transport_factory

    @property
    def configured(self) -> bool:
        return bool(self.port)

    def _worker(self) -> SerialWorker:
        return get_worker(self.port, self.baud, self._transport_factory)

    def ensure_started(self) -> None:
        """Start (and connect) the worker — called when serial becomes active."""
        if self.configured:
            self._worker()

    def status(self) -> dict:
        if not self.configured:
            return {"configured": False, "backend": "serial"}
        # Lazy: report from the worker only if it is already running. If serial is
        # configured but not the active backend, the worker won't exist yet — we
        # must not start it here just to answer a status poll.
        worker = peek_worker()
        if worker is None:
            return {"configured": True, "backend": "serial", "online": False}
        return worker.status()

    def upload(self, gcode_path: Path, *, start: bool = False) -> dict:
        return self._worker().upload(gcode_path, start=start)

    def job_command(self, command: str) -> None:
        self._worker().job_command(command)

    def home(self, axes: list[str] | None = None) -> None:
        self._worker().home(axes)

    def jog(
        self, x: float = 0.0, y: float = 0.0, z: float = 0.0, speed: int | None = None
    ) -> None:
        self._worker().jog(x, y, z, speed)

    def gcode(self, commands: list[str]) -> None:
        self._worker().gcode(commands)
