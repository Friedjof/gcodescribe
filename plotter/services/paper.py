from __future__ import annotations

import math

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
        cal = self._with_corner(cal, corner, x, y)
        self._save(cal)
        return self.state(cal)

    def capture(
        self, corner: str, *, mode: str | None = None, diagonal: str = "bl-tr"
    ) -> dict:
        if corner not in self.CORNERS:
            raise ServiceError(f"unknown corner: {corner}")
        pos = self.tracker.snapshot()
        if not pos["homed"]:
            raise NotHomedError()
        cal = self._calibration()
        cal = self._with_corner(cal, corner, pos["x"], pos["y"], mode, diagonal)
        self._save(cal)
        return self.state(cal)

    @staticmethod
    def _with_corner(
        cal: Calibration, corner: str, x: float, y: float,
        mode: str | None = None, diagonal: str = "bl-tr",
    ) -> Calibration:
        if not (math.isfinite(x) and math.isfinite(y)):
            raise ServiceError("Eckkoordinaten müssen endlich sein.")
        selected = (
            diagonal if mode == "diagonal" else None if mode == "manual" else cal.paper_diagonal
        )
        corners = dict(cal.paper_corners)
        generated = set(cal.paper_generated_corners)
        if cal.paper_diagonal:
            generated.update(key for key in corners if key not in cal.paper_diagonal.split("-"))
        if selected:
            if selected not in ("bl-tr", "tl-br"):
                raise ServiceError("Ungültige Diagonale.")
            anchors = selected.split("-")
            if corner not in anchors:
                raise ServiceError("Diese Ecke wird berechnet. Zum Bearbeiten vier Ecken wählen.")
            # Generated points from another diagonal are not measured anchors.
            corners = {} if cal.paper_diagonal and cal.paper_diagonal != selected else {
                key: value for key, value in corners.items() if key in anchors
            }
            corners[corner] = [x, y]
            generated = set()
            if all(key in corners for key in anchors):
                a, b = (corners[key] for key in anchors)
                if b[0] - a[0] < 1 or (
                    b[1] - a[1] if selected == "bl-tr" else a[1] - b[1]
                ) < 1:
                    raise ServiceError(
                        "Die zweite Ecke muss diagonal gegenüberliegen (mindestens 1 × 1 mm)."
                    )
                if selected == "bl-tr":
                    corners.update(tl=[a[0], b[1]], br=[b[0], a[1]])
                else:
                    corners.update(bl=[a[0], b[1]], tr=[b[0], a[1]])
                generated = set(corners) - set(anchors)
        else:
            corners[corner] = [x, y]
            generated.discard(corner)
        return cal.merged({
            "paper_corners": corners, "paper_diagonal": selected,
            "paper_generated_corners": sorted(generated),
        })

    def clear(self, corner: str) -> dict:
        cal = self._calibration()
        corners = dict(cal.paper_corners)
        corners.pop(corner, None)
        if cal.paper_diagonal:
            corners = {key: value for key, value in corners.items()
                       if key in cal.paper_diagonal.split("-")}
        cal = cal.merged({
            "paper_corners": corners,
            "paper_generated_corners": [key for key in cal.paper_generated_corners
                                        if key in corners],
        })
        self._save(cal)
        return self.state(cal)

    def reset(self) -> dict:
        cal = self._calibration().merged({
            "paper_corners": {}, "paper_diagonal": None, "paper_generated_corners": [],
        })
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
