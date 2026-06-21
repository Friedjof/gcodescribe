from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path


def data_dir() -> Path:
    """Directory for persisted state (calibration, generated jobs)."""
    path = Path(os.environ.get("PLOTTER_DATA_DIR", "data"))
    path.mkdir(parents=True, exist_ok=True)
    return path


@dataclass
class Calibration:
    """Plotter calibration. All distances in mm, feedrates in mm/min."""

    # Physical travel limits.
    bed_width: float = 210.0
    bed_height: float = 210.0
    z_max: float = 205.0

    # Usable plot area and its origin offset on the bed.
    plot_width: float = 200.0
    plot_height: float = 200.0
    origin_x: float = 5.0
    origin_y: float = 5.0

    # Pen mechanism (absolute Z heights).
    pen_up_z: float = 5.0
    pen_down_z: float = 0.0
    # True once the pen-down height was captured from the head position via
    # the wizard. Persisted, so the "pen height set" state survives tab
    # switches and app restarts.
    pen_calibrated: bool = False

    # Feedrates.
    travel_feed: float = 6000.0
    draw_feed: float = 3000.0
    z_feed: float = 1000.0

    # Layout behaviour.
    fit_to_area: bool = True  # scale the drawing to fit plot_width x plot_height
    flip_y: bool = True  # SVG y-axis points down; printer y-axis points up
    trust_axis_home: bool = False  # true if the firmware honours G28 axis arguments

    # Paper calibration: corner positions captured by jogging the head to the
    # sheet's corners (printer coordinates, mm). Keys: bl, br, tr, tl.
    paper_corners: dict = field(default_factory=dict)
    paper_margin: float = 0.0  # inset from the paper edge to the plot area

    @classmethod
    def path(cls) -> Path:
        return data_dir() / "calibration.json"

    @classmethod
    def load(cls) -> Calibration:
        path = cls.path()
        if not path.exists():
            return cls()
        raw = json.loads(path.read_text())
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in raw.items() if k in known})

    def save(self) -> None:
        self.path().write_text(json.dumps(asdict(self), indent=2))
        # The profile store is the source of truth; this file is only the
        # active-profile mirror for legacy callers. Push the change into the
        # active profile (lazy import — services may not be loadable in
        # stripped-down contexts, and a hard import would be circular).
        try:
            from .services.profiles import sync_active_profile_calibration
        except ImportError:
            return
        sync_active_profile_calibration(self)

    def as_dict(self) -> dict:
        return asdict(self)

    def merged(self, updates: dict) -> Calibration:
        known = {f.name for f in fields(self)}
        data = asdict(self)
        data.update({k: v for k, v in updates.items() if k in known})
        return Calibration(**data)

    def paper_rect(self) -> tuple[float, float, float, float] | None:
        """Axis-aligned (x, y, width, height) of the captured paper, or None.

        Needs at least two corners spanning both axes (e.g. bl + tr).
        """
        pts = [
            p
            for p in self.paper_corners.values()
            if isinstance(p, (list, tuple)) and len(p) == 2
        ]
        if len(pts) < 2:
            return None
        xs = [float(p[0]) for p in pts]
        ys = [float(p[1]) for p in pts]
        width = max(xs) - min(xs)
        height = max(ys) - min(ys)
        if width < 1.0 or height < 1.0:
            return None
        return (min(xs), min(ys), width, height)
