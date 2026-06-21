from __future__ import annotations

import json
import logging
import threading
from pathlib import Path

from .base import PrinterBackend, PrinterError

log = logging.getLogger(__name__)

OCTOPRINT = "octoprint"
SERIAL = "serial"

# Deterministic preference when neither a persisted nor an env default applies.
_PREFERENCE = (OCTOPRINT, SERIAL)


class BackendUnavailableError(PrinterError):
    """Requested a backend that is not configured."""


class BackendBusyError(PrinterError):
    """Cannot switch backends while a job is running."""


def _state_path() -> Path:
    from ..calibration import data_dir

    return data_dir() / "printer_backend.json"


def load_active() -> str | None:
    path = _state_path()
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text()).get("active")
    except (json.JSONDecodeError, OSError):
        return None


def save_active(backend_id: str) -> None:
    path = _state_path()
    try:
        path.write_text(json.dumps({"active": backend_id}))
    except OSError as exc:  # pragma: no cover - disk failure is non-fatal here
        log.warning("could not persist active backend: %s", exc)


class PrinterManager:
    """Holds every configured backend and delegates to the active one.

    Itself a :class:`PrinterBackend`, so ``PrinterController`` and the routes
    keep talking to a single object regardless of how many backends exist.
    """

    def __init__(self, backends: dict[str, PrinterBackend], active: str):
        self._backends = backends
        self._active = active
        self._lock = threading.Lock()
        # If serial starts out active, connect it now so its status reflects
        # reality (lazy lifecycle: only the active serial backend is connected).
        self._ensure_active_started()

    # -- selection ---------------------------------------------------------

    @property
    def active_id(self) -> str:
        return self._active

    def active(self) -> PrinterBackend:
        try:
            return self._backends[self._active]
        except KeyError as exc:
            raise BackendUnavailableError(
                f"backend not configured: {self._active}"
            ) from exc

    def set_active(self, backend_id: str) -> None:
        with self._lock:
            if backend_id not in self._backends:
                raise BackendUnavailableError(f"backend not configured: {backend_id}")
            if backend_id == self._active:
                return
            if self._job_active():
                raise BackendBusyError("cannot switch backend while a job is running")
            previous = self._active
            self._active = backend_id
            save_active(backend_id)
        # Release the serial port when leaving the serial backend (lazy lifecycle).
        if previous == SERIAL:
            self._release_serial()
        # Connect the newly active backend (serial connects lazily on activation).
        self._ensure_active_started()
        # The real head position is unknown after switching (different device or
        # a connect-time reset) — force a re-home.
        self._invalidate_position()

    def _ensure_active_started(self) -> None:
        backend = self._backends.get(self._active)
        ensure = getattr(backend, "ensure_started", None)
        if callable(ensure):
            ensure()

    def backends(self) -> list[dict]:
        """Selector payload: id, configured, online, active per backend."""
        out: list[dict] = []
        for bid, backend in self._backends.items():
            st = backend.status()
            out.append(
                {
                    "id": bid,
                    "configured": st.get("configured", False),
                    "online": bool(st.get("online", False)),
                    "active": bid == self._active,
                }
            )
        return out

    def _job_active(self) -> bool:
        st = self.active().status()
        state = ((st.get("job") or {}).get("state") or "").lower()
        return "printing" in state or "paused" in state

    @staticmethod
    def _release_serial() -> None:
        from .serial import shutdown_worker

        shutdown_worker()

    @staticmethod
    def _invalidate_position() -> None:
        from ..position import get_tracker

        get_tracker().invalidate()

    # -- PrinterBackend delegation ----------------------------------------

    @property
    def configured(self) -> bool:
        return bool(self._backends)

    def status(self) -> dict:
        if not self._backends:
            return {"configured": False}
        st = dict(self.active().status())
        st["backend"] = self._active
        return st

    def upload(self, gcode_path: Path, *, start: bool = False) -> dict:
        return self.active().upload(gcode_path, start=start)

    def job_command(self, command: str) -> None:
        self.active().job_command(command)

    def home(self, axes: list[str] | None = None) -> None:
        self.active().home(axes)

    def jog(
        self, x: float = 0.0, y: float = 0.0, z: float = 0.0, speed: int | None = None
    ) -> None:
        self.active().jog(x, y, z, speed)

    def gcode(self, commands: list[str]) -> None:
        self.active().gcode(commands)
