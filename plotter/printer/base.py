from __future__ import annotations

from pathlib import Path
from typing import Protocol, runtime_checkable


class PrinterError(RuntimeError):
    """Backend-neutral printer failure.

    Both the OctoPrint and the direct-serial backend raise this so the web
    layer can translate any printer problem to a single HTTP status without
    knowing which backend is active.
    """


@runtime_checkable
class PrinterBackend(Protocol):
    """Common surface shared by every printer backend.

    The OctoPrint REST client and the serial worker both implement this, so
    ``PrinterController`` and the HTTP routes never depend on a concrete
    backend. ``status()`` must always return at least the fields the frontend
    reads (see ``docs/planing/serial/02-interface-design.md``):

        {"configured": bool, "online": bool,
         "job": {"state": str,
                 "progress": {"completion": float | None},
                 "job": {"file": {"name": str}}} | None}
    """

    @property
    def configured(self) -> bool: ...

    def status(self) -> dict: ...

    def upload(self, gcode_path: Path, *, start: bool = False) -> dict: ...

    def job_command(self, command: str) -> None:
        """command: start | pause | cancel | restart."""
        ...

    def home(self, axes: list[str] | None = None) -> None: ...

    def jog(
        self, x: float = 0.0, y: float = 0.0, z: float = 0.0, speed: int | None = None
    ) -> None: ...

    def gcode(self, commands: list[str]) -> None: ...
