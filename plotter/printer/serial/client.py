"""``PrinterBackend`` facade over the process-wide serial worker."""

from __future__ import annotations

from pathlib import Path

from plotter.printer.serial.transport import DEFAULT_BAUD, DEFAULT_PORT, TransportFactory
from plotter.printer.serial.worker import SerialWorker, get_worker, peek_worker, shutdown_worker
from plotter.printer.types import PrinterStatus


class SerialClient:
    """``PrinterBackend`` proxy over the process-wide :class:`SerialWorker`."""

    def __init__(
        self,
        port: str = DEFAULT_PORT,
        baud: int = DEFAULT_BAUD,
        transport_factory: TransportFactory | None = None,
    ):
        self.port = port
        self.baud = baud
        self._transport_factory = transport_factory
        self._owned_worker: SerialWorker | None = None

    @property
    def configured(self) -> bool:
        return bool(self.port)

    def _worker(self) -> SerialWorker:
        self._owned_worker = get_worker(self.port, self.baud, self._transport_factory)
        return self._owned_worker

    def ensure_started(self) -> None:
        """Start (and connect) the worker — called when serial becomes active."""
        if self.configured:
            self._worker()

    def close(self) -> None:
        if self._owned_worker is not None:
            shutdown_worker(self.port, self.baud, expected=self._owned_worker)
            self._owned_worker = None

    def status(self) -> PrinterStatus:
        if not self.configured:
            return {"configured": False, "backend": "serial"}
        # Lazy: report from the worker only if it is already running. If serial is
        # configured but not the active backend, the worker won't exist yet — we
        # must not start it here just to answer a status poll.
        worker = peek_worker()
        if worker is None or worker is not self._owned_worker:
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
