from __future__ import annotations

from pathlib import Path
from typing import Protocol, runtime_checkable


class PrinterError(RuntimeError):
    """Backend-neutral printer failure.

    Both the OctoPrint and the direct-serial backend raise this so the web
    layer can translate any printer problem to a single HTTP status without
    knowing which backend is active.
    """

    status_code = 502


class PrinterBusyError(PrinterError):
    """A manual command would interfere with the running plot."""

    status_code = 409


def require_manual_motion(state: str | None) -> None:
    if isinstance(state, str) and state.lower() in {
        "printing",
        "starting",
        "pausing",
        "resuming",
        "finishing",
        "cancelling",
        "printing from sd",
    }:
        raise PrinterBusyError(
            "Manuelle Bewegungen sind während des Drucks gesperrt. Bitte zuerst pausieren."
        )


def require_profile_switch(state: str | None) -> None:
    """Changing the mirrored calibration during a job can alter pen lift/cancel."""
    value = (state or "").lower()
    if any(
        active in value
        for active in (
            "printing",
            "starting",
            "pausing",
            "paused",
            "resuming",
            "finishing",
            "cancelling",
        )
    ):
        raise PrinterBusyError(
            "Das Druckerprofil kann während eines laufenden oder pausierten Plots "
            "nicht gewechselt werden."
        )


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
