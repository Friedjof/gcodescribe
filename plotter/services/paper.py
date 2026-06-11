from __future__ import annotations

from ..calibration import Calibration
from ..position import PositionTracker, get_tracker
from .errors import NotHomedError, ServiceError


class PaperService:
    """Paper corner calibration: capture corners at the head position and
    turn the resulting rectangle (minus margin) into the active plot area."""

    CORNERS = ("bl", "br", "tr", "tl")

    def __init__(self, tracker: PositionTracker | None = None):
        self.tracker = tracker or get_tracker()

    def state(self, cal: Calibration | None = None) -> dict:
        cal = cal or Calibration.load()
        return {"calibration": cal.as_dict(), "rect": cal.paper_rect()}

    def capture(self, corner: str) -> dict:
        if corner not in self.CORNERS:
            raise ServiceError(f"unknown corner: {corner}")
        pos = self.tracker.snapshot()
        if not pos["homed"]:
            raise NotHomedError()
        cal = Calibration.load()
        corners = dict(cal.paper_corners)
        corners[corner] = [pos["x"], pos["y"]]
        cal = cal.merged({"paper_corners": corners})
        cal.save()
        return self.state(cal)

    def clear(self, corner: str) -> dict:
        cal = Calibration.load()
        corners = dict(cal.paper_corners)
        corners.pop(corner, None)
        cal = cal.merged({"paper_corners": corners})
        cal.save()
        return self.state(cal)

    def reset(self) -> dict:
        cal = Calibration.load().merged({"paper_corners": {}})
        cal.save()
        return self.state(cal)

    def apply(self, margin: float) -> dict:
        cal = Calibration.load()
        rect = cal.paper_rect()
        if rect is None:
            raise ServiceError(
                "Mindestens zwei gegenüberliegende Ecken setzen (z. B. unten links + oben rechts)."
            )
        x0, y0, width, height = rect
        margin = max(margin, 0.0)
        if width - 2 * margin < 5 or height - 2 * margin < 5:
            raise ServiceError("Rand zu groß für das erfasste Papier.")
        cal = cal.merged(
            {
                "origin_x": round(x0 + margin, 3),
                "origin_y": round(y0 + margin, 3),
                "plot_width": round(width - 2 * margin, 3),
                "plot_height": round(height - 2 * margin, 3),
                "paper_margin": margin,
            }
        )
        cal.save()
        return self.state(cal)
