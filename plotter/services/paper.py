from __future__ import annotations

from plotter.core.calibration import Calibration
from plotter.core.position import PositionTracker, get_tracker

from .errors import NotHomedError, ServiceError
from .profiles import ProfileService


class PaperService:
    """Capture paper corners and inset the independently configured plot area."""

    CORNERS = ("bl", "br", "tr", "tl")

    def __init__(
        self, tracker: PositionTracker | None = None, *, profile_id: str | None = None
    ):
        self.tracker = tracker or get_tracker()
        self.profile_id = profile_id

    def _calibration(self) -> Calibration:
        if self.profile_id is not None:
            return ProfileService().calibration(self.profile_id)
        return Calibration.load()

    def _save(self, cal: Calibration) -> None:
        if self.profile_id is not None:
            ProfileService().save_calibration(self.profile_id, cal)
        else:
            cal.save()

    def state(self, cal: Calibration | None = None) -> dict:
        cal = cal or self._calibration()
        return {"calibration": cal.as_dict(), "rect": cal.paper_rect()}

    def set_corner_at(self, corner: str, x: float, y: float) -> dict:
        """Set a corner to explicit coordinates (no head movement required)."""
        if corner not in self.CORNERS:
            raise ServiceError(f"unknown corner: {corner}")
        cal = self._calibration()
        corners = dict(cal.paper_corners)
        corners[corner] = [x, y]
        cal = cal.merged({"paper_corners": corners})
        self._save(cal)
        return self.state(cal)

    def capture(self, corner: str) -> dict:
        if corner not in self.CORNERS:
            raise ServiceError(f"unknown corner: {corner}")
        pos = self.tracker.snapshot()
        if not pos["homed"]:
            raise NotHomedError()
        cal = self._calibration()
        corners = dict(cal.paper_corners)
        corners[corner] = [pos["x"], pos["y"]]
        cal = cal.merged({"paper_corners": corners})
        self._save(cal)
        return self.state(cal)

    def clear(self, corner: str) -> dict:
        cal = self._calibration()
        corners = dict(cal.paper_corners)
        corners.pop(corner, None)
        cal = cal.merged({"paper_corners": corners})
        self._save(cal)
        return self.state(cal)

    def reset(self) -> dict:
        cal = self._calibration().merged({"paper_corners": {}})
        self._save(cal)
        return self.state(cal)

    def set_obstacles(self, obstacles: list) -> dict:
        """Replace the obstacle list for the active calibration profile."""
        cal = self._calibration()
        cal = cal.merged({"obstacles": obstacles})
        self._save(cal)
        return self.state(cal)

    def apply(self, margin: float, *, from_paper: bool = False) -> dict:
        cal = self._calibration()
        updates = {"paper_margin": margin}
        if from_paper:
            rect = cal.paper_rect_inner()
            if rect is None:
                raise ServiceError(
                    "Mindestens zwei gegenüberliegende Ecken setzen "
                    "(z. B. unten links + oben rechts)."
                )
            updates["plot_area_base"] = dict(zip(("x", "y", "w", "h"), rect, strict=True))
        try:
            cal = cal.merged(updates)
        except ValueError as exc:
            raise ServiceError(str(exc)) from exc
        self._save(cal)
        return self.state(cal)
