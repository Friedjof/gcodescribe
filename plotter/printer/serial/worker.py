"""The serial worker thread: owns the port, streams job lines, tracks state.

A single process-wide worker exists at most once (see the singleton helpers at
the bottom); it is only created when the serial backend becomes active, so
status polls never reset the printer by opening the port.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass
from pathlib import Path

from plotter.printer.base import PrinterBusyError, PrinterError, require_manual_motion
from plotter.printer.serial.transport import (
    ACK_TIMEOUT,
    BANNER_QUIET,
    BANNER_TIMEOUT,
    DEFAULT_BAUD,
    DEFAULT_PORT,
    IDLE,
    LOADED,
    PAUSED,
    PRINTING,
    RECONNECT_DELAY,
    STATE_LABELS,
    Command,
    SerialTransport,
    TransportFactory,
    default_transport,
    prepare_lines,
)
from plotter.printer.types import JobOutcome, PrinterJob, PrinterJobResult, PrinterStatus

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class PausePosition:
    x: float
    y: float
    z: float
    absolute: bool
    feed: float | None


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
        self._transport_factory = transport_factory or default_transport

        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._queue: deque[Command] = deque()

        self._transport: SerialTransport | None = None
        self._online = False
        self._last_error: str | None = None

        self._state = IDLE
        self._job_lines: list[str] = []
        self._job_name: str | None = None
        self._job_id: str | None = None
        self._last_job: PrinterJobResult | None = None
        self._job_calibration = None
        self._job_index = 0
        self._job_generation = 0
        self._absolute = True
        self._x = 0.0
        self._y = 0.0
        self._z = 0.0
        self._feed: float | None = None
        self._park_requested = False
        self._resume_requested = False
        self._resume_position: PausePosition | None = None
        self._control_in_progress = False

        self._running = True
        self._thread = threading.Thread(
            target=self._run, name="serial-worker", daemon=True
        )
        self._thread.start()

    # -- public API (called from request threads) --------------------------

    def status(self) -> PrinterStatus:
        with self._lock:
            if not self._online:
                return {
                    "configured": True,
                    "backend": "serial",
                    "online": False,
                    "error": self._last_error,
                }
            job: PrinterJob | None = None
            if self._state in (LOADED, PRINTING, PAUSED):
                total = len(self._job_lines)
                completion = round(self._job_index / total * 100, 1) if total else None
                job = {
                    "id": self._job_id,
                    "state": STATE_LABELS[self._state],
                    "progress": {"completion": completion},
                    "job": {"file": {"name": self._job_name}},
                }
            return {
                "configured": True, "backend": "serial", "online": True,
                "job": job, "last_job": self._last_job, "error": self._last_error,
                "motion_locked": self._state == PRINTING or self._park_requested
                or self._resume_requested or self._control_in_progress,
            }

    def upload(self, gcode_path: Path, *, start: bool = False) -> dict:
        lines = prepare_lines(gcode_path.read_text())
        from plotter.core.calibration import Calibration
        from plotter.core.jobmeta import read_job_meta_checked

        cal = Calibration.load()
        meta, _ = read_job_meta_checked(gcode_path)
        snapshot = (meta or {}).get("calibrationSnapshot") or {}
        if isinstance(snapshot, dict) and isinstance(snapshot.get("calibration"), dict):
            cal = Calibration.from_dict(snapshot["calibration"])
        with self._lock:
            if self._state in (PRINTING, PAUSED) or self._control_in_progress:
                raise PrinterBusyError("Bitte den laufenden Druck zuerst beenden.")
            self._job_lines = lines
            self._job_name = gcode_path.name
            self._job_id = uuid.uuid4().hex
            self._job_calibration = cal
            self._job_index = 0
            self._job_generation += 1
            self._reset_pause()
            self._last_error = None
            self._state = PRINTING if start else LOADED
        self._wake.set()
        # Mimic OctoPrint's upload response so callers stay backend-agnostic.
        return {"done": True, "files": {"local": {"name": gcode_path.name}}}

    def job_command(self, command: str) -> None:
        if command in ("start", "restart"):
            self._start(reset=command == "restart")
        elif command == "resume":
            self._resume()
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
            if self._state == PRINTING or self._control_in_progress:
                raise PrinterBusyError("Der Druck läuft bereits.")
            if self._state == PAUSED and not reset:
                raise PrinterBusyError("Bitte den pausierten Druck mit Fortsetzen weiterführen.")
            if reset:
                self._job_id = uuid.uuid4().hex
                self._job_index = 0
                self._job_generation += 1
                self._reset_pause()
            self._last_error = None
            self._state = PRINTING
        self._wake.set()

    def _resume(self) -> None:
        with self._lock:
            if self._state != PAUSED:
                return
            self._resume_requested = True
        self._wake.set()

    def _pause(self) -> None:
        with self._lock:
            if self._state != PRINTING:
                return
            self._state = PAUSED
            self._park_requested = True
            log.info("Pause requested: %s at line %s", self._job_name, self._job_index)
        self._wake.set()

    def _cancel(self) -> None:
        with self._lock:
            cal = self._job_calibration
            self._record_job_result("cancelled")
            self._state = IDLE
            self._job_lines = []
            self._job_name = None
            self._job_calibration = None
            self._job_index = 0
            self._job_generation += 1
            self._reset_pause()
        # Quickstop flushes Marlin's planner buffer so the head stops promptly,
        # then lift the pen.
        self._submit(["M410", *self._pen_up_lines(cal)], wait=False, internal=True)

    def _reset_pause(self) -> None:
        """Called with _lock held; invalidate parked state for the old job."""
        self._park_requested = False
        self._resume_requested = False
        self._resume_position = None

    @staticmethod
    def _pen_up_lines(cal=None) -> list[str]:
        from plotter.core.calibration import Calibration, feed_word, z_max_feedrate_line

        cal = cal or Calibration.load()
        return [z_max_feedrate_line(cal), "G90", f"G1 Z{cal.pen_up_z:.3f} {feed_word(cal.z_feed)}"]

    @staticmethod
    def _park_lines(cal=None) -> list[str]:
        from plotter.core.calibration import Calibration, feed_word

        cal = cal or Calibration.load()
        park_x, park_y, park_lift_z = cal.resolved_park()
        lines = SerialWorker._pen_up_lines(cal)
        if abs(park_lift_z - cal.pen_up_z) > 1e-6:
            lines.append(f"G0 Z{park_lift_z:.3f} {feed_word(cal.z_feed)}")
        lines.append(f"G0 X{park_x:.3f} Y{park_y:.3f} {feed_word(cal.travel_feed)}")
        return lines

    @staticmethod
    def _return_from_pause_lines(position: PausePosition, cal=None) -> list[str]:
        from plotter.core.calibration import Calibration, feed_word

        cal = cal or Calibration.load()
        lines = [
            *SerialWorker._pen_up_lines(cal),
            f"G0 X{position.x:.3f} Y{position.y:.3f} {feed_word(cal.travel_feed)}",
            f"G1 Z{position.z:.3f} {feed_word(cal.z_feed)}",
        ]
        if position.feed is not None:
            lines.append(f"G1 F{position.feed:g}")
        if not position.absolute:
            lines.append("G91")
        return lines

    # -- command submission ------------------------------------------------

    def _submit(self, lines: list[str], *, wait: bool, internal: bool = False) -> None:
        cmd = Command(lines, purpose="cancel" if internal else "manual")
        with self._lock:
            if not internal:
                require_manual_motion(STATE_LABELS[self._state])
                if self._park_requested or self._resume_requested or self._control_in_progress:
                    raise PrinterBusyError(
                        "Bitte warten, bis die Stiftposition wiederhergestellt ist."
                    )
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

            cmd = self._take_pause_park_command()
            if cmd is not None:
                self._run_command(cmd)
                continue

            cmd = self._take_pending_resume_command()
            if cmd is not None:
                self._run_command(cmd)
                continue

            job_line = self._take_job_line()
            if job_line is not None:
                self._stream_line(*job_line)
                continue

            self._wake.wait(0.1)
            self._wake.clear()

    def _take_command(self) -> Command | None:
        with self._lock:
            if self._queue:
                return self._queue.popleft()
        return None

    def _take_pause_park_command(self) -> Command | None:
        with self._lock:
            if self._state != PAUSED or not self._park_requested:
                return None
            self._park_requested = False
            self._resume_position = PausePosition(
                self._x, self._y, self._z, self._absolute, self._feed
            )
            self._control_in_progress = True
            generation = self._job_generation
            cal = self._job_calibration
            log.info("Parking %s at line %s, saved %s",
                     self._job_name, self._job_index, self._resume_position)
        return Command(self._park_lines(cal), purpose="park", generation=generation)

    def _take_pending_resume_command(self) -> Command | None:
        with self._lock:
            if self._state != PAUSED or not self._resume_requested:
                return None
            self._resume_requested = False
            position = self._resume_position
            if position is None:
                self._last_error = "Keine gespeicherte Stiftposition zum Fortsetzen vorhanden."
                return None
            self._control_in_progress = True
            generation = self._job_generation
            cal = self._job_calibration
            log.info("Restoring %s at line %s to %s", self._job_name, self._job_index, position)
        return Command(self._return_from_pause_lines(position, cal),
                       purpose="resume", generation=generation)

    def _record_job_result(self, outcome: JobOutcome) -> None:
        # Called under _lock. Keep the terminal result after the job disappears,
        # so a polling client cannot mistake cancellation for successful completion.
        if self._job_id and self._job_name:
            self._last_job = {"id": self._job_id, "filename": self._job_name, "outcome": outcome}

    def _take_job_line(self) -> tuple[int, int, str] | None:
        with self._lock:
            if self._state != PRINTING:
                return None
            if self._job_index >= len(self._job_lines):
                # Job complete.
                self._record_job_result("completed")
                self._state = IDLE
                self._job_lines = []
                self._job_name = None
                self._job_calibration = None
                self._job_index = 0
                return None
            return (self._job_generation, self._job_index, self._job_lines[self._job_index])

    def _stream_line(self, generation: int, index: int, line: str) -> None:
        try:
            self._send_line(line)
        except PrinterError as exc:
            log.warning("serial print aborted: %s", exc)
            with self._lock:
                self._record_job_result("failed")
                self._state = IDLE
                self._last_error = str(exc)
                self._job_calibration = None
            return
        with self._lock:
            if self._job_generation == generation and self._job_index == index:
                self._job_index += 1

    def _run_command(self, cmd: Command) -> None:
        try:
            for line in cmd.lines:
                if cmd.generation is not None:
                    with self._lock:
                        if cmd.generation != self._job_generation:
                            return
                self._send_line(line)
            with self._lock:
                if cmd.purpose == "resume" and cmd.generation == self._job_generation:
                    self._resume_position = None
                    self._resume_requested = False
                    self._last_error = None
                    self._state = PRINTING
        except PrinterError as exc:
            cmd.error = exc
            log.warning("Serial %s failed: %s", cmd.purpose, exc)
            with self._lock:
                self._last_error = str(exc)
                if cmd.purpose in ("park", "resume") and cmd.generation == self._job_generation:
                    self._resume_requested = False
                    self._state = PAUSED
        finally:
            if cmd.purpose in ("park", "resume"):
                with self._lock:
                    self._control_in_progress = False
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
        from plotter.printer.discovery import resolve_auto_port

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
                    self._track_position(line)
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

    def _track_position(self, line: str) -> None:
        stripped = line.split(";", 1)[0].strip()
        if not stripped:
            return
        parts = stripped.split()
        if not parts:
            return
        cmd = parts[0].upper()
        if cmd == "G90":
            with self._lock:
                self._absolute = True
            return
        if cmd == "G91":
            with self._lock:
                self._absolute = False
            return
        if cmd not in ("G0", "G00", "G1", "G01"):
            return
        values: dict[str, float] = {}
        for part in parts[1:]:
            axis = part[:1].upper()
            if axis not in ("X", "Y", "Z", "F"):
                continue
            try:
                values[axis] = float(part[1:])
            except ValueError:
                continue
        if not values:
            return
        with self._lock:
            if "F" in values:
                self._feed = values["F"]
            if self._absolute:
                self._x = values.get("X", self._x)
                self._y = values.get("Y", self._y)
                self._z = values.get("Z", self._z)
            else:
                self._x += values.get("X", 0.0)
                self._y += values.get("Y", 0.0)
                self._z += values.get("Z", 0.0)

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
    port: str = DEFAULT_PORT,
    baud: int = DEFAULT_BAUD,
    transport_factory: TransportFactory | None = None,
) -> SerialWorker:
    global _worker
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
