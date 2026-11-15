from __future__ import annotations

import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path

from .base import PrinterBackend, PrinterError
from .types import PrinterBackendInfo, PrinterStatus

OCTOPRINT = "octoprint"
SERIAL = "serial"


class BackendUnavailableError(PrinterError):
    """Requested a backend that is not configured."""


class BackendBusyError(PrinterError):
    """Cannot switch backends while a job is running."""


class PrinterManager:
    """Holds every configured backend and delegates to the active one.

    Itself a :class:`PrinterBackend`, so ``PrinterController`` and the routes
    keep talking to a single object regardless of how many backends exist.
    """

    def __init__(
        self,
        backends: dict[str, PrinterBackend],
        active: str,
        *,
        on_selection: Callable[[str], None] | None = None,
        on_connection_changed: Callable[[], None] | None = None,
    ):
        self._backends = dict(backends)
        self._active = active
        self._lock = threading.RLock()
        self._condition = threading.Condition(self._lock)
        self._operations = 0
        self._changing = False
        self._closed = False
        self._on_selection = on_selection
        self._on_connection_changed = on_connection_changed
        # If serial starts out active, connect it now so its status reflects
        # reality (lazy lifecycle: only the active serial backend is connected).
        self._ensure_active_started()

    # -- selection ---------------------------------------------------------

    @property
    def active_id(self) -> str:
        with self._lock:
            return self._active

    def backend(self, backend_id: str) -> PrinterBackend | None:
        with self._lock:
            return self._backends.get(backend_id)

    def active(self) -> PrinterBackend:
        with self._lock:
            if self._closed:
                raise PrinterError("Printer manager has been closed.")
            try:
                return self._backends[self._active]
            except KeyError as exc:
                raise BackendUnavailableError(f"backend not configured: {self._active}") from exc

    @contextmanager
    def _operation(self) -> Iterator[tuple[str, PrinterBackend]]:
        # Status requests may be slow. Keep commands concurrent with polling,
        # while preventing a connection from being closed during either one.
        with self._condition:
            while self._changing:
                self._condition.wait()
            backend = self.active()
            backend_id = self._active
            self._operations += 1
        try:
            yield backend_id, backend
        finally:
            with self._condition:
                self._operations -= 1
                self._condition.notify_all()

    @contextmanager
    def _transition(self) -> Iterator[None]:
        with self._condition:
            while self._changing:
                self._condition.wait()
            self._changing = True
            try:
                while self._operations:
                    self._condition.wait()
                yield
            finally:
                self._changing = False
                self._condition.notify_all()

    def set_active(self, backend_id: str) -> None:
        with self._transition():
            if backend_id not in self._backends:
                raise BackendUnavailableError(f"backend not configured: {backend_id}")
            if backend_id == self._active:
                return
            if not self._apply_backends(self._backends, backend_id):
                raise BackendBusyError("cannot switch backend while a job is running")
            if self._on_selection:
                self._on_selection(backend_id)

    def reconfigure(
        self, backends: dict[str, PrinterBackend], active: str, *, preserve_selection: bool = False
    ) -> bool:
        """Apply prepared connections, or defer if the active job would be affected.

        Retaining the active object permits changes to inactive connections even
        during a plot. Selection, commands and lifecycle changes share one lock.
        """
        with self._transition():
            return self._apply_backends(backends, active, preserve_selection=preserve_selection)

    def _apply_backends(
        self, backends: dict[str, PrinterBackend], active: str, *, preserve_selection: bool = False
    ) -> bool:
        # Called only inside a transition, after all in-flight operations finish.
        if self._closed:
            raise PrinterError("Printer manager has been closed.")
        previous = self._backends.get(self._active)
        if (
            preserve_selection
            and self._active in backends
            and previous is not None
            and previous.configured
        ):
            active = self._active
        if active not in backends:
            raise BackendUnavailableError(f"backend not configured: {active}")
        candidate = backends[active]
        changed = self._active != active or previous is not candidate
        if changed and previous is not None and self._backend_busy(previous):
            return False
        retained = {id(backend) for backend in backends.values()}
        # Retire inactive clients before starting the new active connection:
        # an old serial facade must not close a newly opened singleton port.
        for backend in self._backends.values():
            if id(backend) not in retained and backend is not previous:
                self._close_backend(backend)
        if changed:
            if self._on_connection_changed:
                self._on_connection_changed()
            if previous is not None:
                self._close_backend(previous)
            try:
                self._start_backend(candidate)
            except Exception:
                # A failed activation must not commit a new selection or
                # leave a half-open port behind. The saved config can retry.
                self._close_backend(candidate)
                if previous is not None:
                    self._start_backend(previous)
                raise
        self._backends = dict(backends)
        self._active = active
        return True

    @staticmethod
    def _start_backend(backend: PrinterBackend) -> None:
        ensure = getattr(backend, "ensure_started", None)
        if callable(ensure):
            ensure()

    @staticmethod
    def _close_backend(backend: PrinterBackend) -> None:
        close = getattr(backend, "close", None)
        if callable(close):
            close()

    def _ensure_active_started(self) -> None:
        backend = self._backends.get(self._active)
        if backend is not None:
            self._start_backend(backend)

    def backends(self) -> list[PrinterBackendInfo]:
        """Selector payload: id, configured, online, active per backend."""
        if not self.configured:
            return []
        with self._operation():
            return [
                {
                    "id": bid,
                    "configured": backend.configured,
                    "online": bool(backend.status().get("online", False)),
                    "active": bid == self._active,
                }
                for bid, backend in self._backends.items()
            ]

    def job_active(self) -> bool:
        if not self.configured:
            return False
        with self._operation() as (_, backend):
            return self._backend_busy(backend)

    @classmethod
    def _backend_busy(cls, backend: PrinterBackend) -> bool:
        read = getattr(backend, "reconfiguration_status", backend.status)
        return cls._status_busy(read())

    @staticmethod
    def _status_busy(st: PrinterStatus) -> bool:
        state = ((st.get("job") or {}).get("state") or "").lower()
        return bool(st.get("motion_locked")) or any(
            active in state
            for active in (
                "printing",
                "starting",
                "pausing",
                "paused",
                "resuming",
                "finishing",
                "cancelling",
            )
        )

    def close(self) -> None:
        with self._transition():
            if self._closed:
                return
            for backend in self._backends.values():
                self._close_backend(backend)
            self._closed = True

    # -- PrinterBackend delegation ----------------------------------------

    @property
    def configured(self) -> bool:
        with self._lock:
            return not self._closed and bool(self._backends)

    def status(self) -> PrinterStatus:
        if not self.configured:
            return {"configured": False}
        with self._operation() as (backend_id, backend):
            st: PrinterStatus = {**backend.status()}
            st["backend"] = backend_id
            return st

    def upload(self, gcode_path: Path, *, start: bool = False) -> dict:
        with self._operation() as (_, backend):
            return backend.upload(gcode_path, start=start)

    def job_command(self, command: str) -> None:
        with self._operation() as (_, backend):
            backend.job_command(command)

    def home(self, axes: list[str] | None = None) -> None:
        with self._operation() as (_, backend):
            backend.home(axes)

    def jog(self, x: float = 0.0, y: float = 0.0, z: float = 0.0, speed: int | None = None) -> None:
        with self._operation() as (_, backend):
            backend.jog(x, y, z, speed)

    def gcode(self, commands: list[str]) -> None:
        with self._operation() as (_, backend):
            backend.gcode(commands)
