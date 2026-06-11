from __future__ import annotations

import threading

from .state import StateStore, create_store


class PositionTracker:
    """Tracks the printhead position from the commands we send.

    OctoPrint's REST API does not report live coordinates, so the position is
    reconstructed from the home / jog / move commands issued through this app.
    Every change is persisted to the state store (Redis or file), so the
    position survives application restarts. Right after a home the position
    is exact: the Anycubic i3 Mega S homes to (0, 0, 0).
    """

    KEY = "position"
    Z_MAX = 205.0  # Anycubic i3 Mega S travel; only used to clamp the estimate.

    def __init__(self, store: StateStore):
        self._store = store
        self._lock = threading.Lock()
        saved = store.get(self.KEY) or {}
        self._x = float(saved.get("x", 0.0))
        self._y = float(saved.get("y", 0.0))
        self._z = float(saved.get("z", 0.0))
        self._homed_axes: set[str] = {
            a for a in saved.get("homed_axes", []) if a in ("x", "y", "z")
        }

    # -- persistence -------------------------------------------------------

    def _persist_locked(self) -> None:
        self._store.set(
            self.KEY,
            {
                "x": self._x,
                "y": self._y,
                "z": self._z,
                "homed_axes": sorted(self._homed_axes),
            },
        )

    # -- queries -----------------------------------------------------------

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "x": round(self._x, 3),
                "y": round(self._y, 3),
                "z": round(self._z, 3),
                "homed": {"x", "y", "z"} <= self._homed_axes,
                "homed_axes": sorted(self._homed_axes),
            }

    @property
    def homed(self) -> bool:
        with self._lock:
            return {"x", "y", "z"} <= self._homed_axes

    # -- mutations (mirror the commands sent to the printer) ----------------

    def home(self, axes: list[str] | None) -> None:
        with self._lock:
            for a in [a.lower() for a in (axes or ["x", "y", "z"])]:
                if a == "x":
                    self._x = 0.0
                elif a == "y":
                    self._y = 0.0
                elif a == "z":
                    self._z = 0.0
                else:
                    continue
                self._homed_axes.add(a)
            self._persist_locked()

    def jog(self, dx: float, dy: float, dz: float, bed_w: float, bed_h: float) -> None:
        # Clamp like the firmware's software endstops so we don't drift when
        # the user jogs against a limit.
        with self._lock:
            self._x = min(max(self._x + dx, 0.0), bed_w)
            self._y = min(max(self._y + dy, 0.0), bed_h)
            self._z = min(max(self._z + dz, 0.0), self.Z_MAX)
            self._persist_locked()

    def set_axes(
        self,
        x: float | None = None,
        y: float | None = None,
        z: float | None = None,
    ) -> None:
        with self._lock:
            if x is not None:
                self._x = x
            if y is not None:
                self._y = y
            if z is not None:
                self._z = z
            self._persist_locked()

    def invalidate(self) -> None:
        """Position no longer trustworthy (raw G-code moved the head)."""
        with self._lock:
            self._homed_axes.clear()
            self._persist_locked()


_tracker: PositionTracker | None = None
_tracker_lock = threading.Lock()


def get_tracker() -> PositionTracker:
    global _tracker
    with _tracker_lock:
        if _tracker is None:
            _tracker = PositionTracker(create_store())
        return _tracker
