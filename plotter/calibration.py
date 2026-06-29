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
    park_after_plot: bool = True  # move to bed-centre/Y-max after the job finishes

    # Paper calibration: corner positions captured by jogging the head to the
    # sheet's corners (printer coordinates, mm). Keys: bl, br, tr, tl.
    paper_corners: dict = field(default_factory=dict)
    paper_margin: float = 0.0  # inset from the paper edge to the plot area

    # No-go obstacle zones (e.g. clamps): list of dicts with keys
    # id, x, y, w, h  — all in printer/bed coordinates (mm).
    # Travel moves (pen-up) are routed around them; drawing moves through them
    # are rejected by the safety checker.
    obstacles: list = field(default_factory=list)

    # Maximum gap (mm) between two stroke endpoints that will be bridged into a
    # single continuous stroke without a pen lift.  Larger values reduce total
    # lifts but may silently connect strokes that were meant to be separate.
    merge_tolerance: float = 0.5

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
        """Axis-aligned bounding box (x, y, width, height) of captured corners, or None.

        Needs at least two corners spanning both axes (e.g. bl + tr).
        Used for display / preview; apply() uses paper_rect_inner() instead.
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

    def paper_rect_inner(self) -> tuple[float, float, float, float] | None:
        """Largest axis-aligned rectangle that fits *inside* the captured quadrilateral.

        With 4 corners this handles non-rectangular (tilted) paper correctly.
        With fewer corners it falls back to the bounding box.
        """
        pts = [
            [float(p[0]), float(p[1])]
            for p in self.paper_corners.values()
            if isinstance(p, (list, tuple)) and len(p) == 2
        ]
        if len(pts) < 2:
            return None
        if len(pts) < 4:
            return self.paper_rect()

        ys = [p[1] for p in pts]
        y_min, y_max = min(ys), max(ys)
        if y_max - y_min < 1.0:
            return None

        # Build edge list for the convex quadrilateral.
        # Order corners: tl → tr → br → bl (canonical quad order).
        order = ["tl", "tr", "br", "bl"]
        ordered = []
        for key in order:
            if key in self.paper_corners:
                p = self.paper_corners[key]
                if isinstance(p, (list, tuple)) and len(p) == 2:
                    ordered.append([float(p[0]), float(p[1])])
        if len(ordered) != 4:
            # Fall back if not all 4 canonical corners present.
            ordered = pts
        edges = [(ordered[i], ordered[(i + 1) % len(ordered)]) for i in range(len(ordered))]

        def x_range_at_y(y: float) -> tuple[float, float] | None:
            xs_at = []
            for (ax, ay), (bx, by) in edges:
                lo, hi = (ay, by) if ay <= by else (by, ay)
                if lo <= y <= hi and abs(by - ay) > 1e-9:
                    t = (y - ay) / (by - ay)
                    xs_at.append(ax + t * (bx - ax))
            if len(xs_at) < 2:
                return None
            return (min(xs_at), max(xs_at))

        # Restrict y to the "interior" range where the polygon has a
        # definite positive width.  For a convex quad, the two vertices with
        # the lowest y values define the bottom edge, and the two with the
        # highest y values define the top edge.  The inscribed rect y-range is
        # [max of bottom pair, min of top pair] – this avoids the degenerate
        # single-point extremes at y_min / y_max.
        ys_sorted = sorted(ys)
        y_inner_min = ys_sorted[1]   # 2nd lowest
        y_inner_max = ys_sorted[-2]  # 2nd highest

        if y_inner_max - y_inner_min < 1.0:
            # Fall back to full bounding rect when corners are nearly co-linear.
            return self.paper_rect()

        x_left_max = float("-inf")
        x_right_min = float("inf")
        sample_ys = sorted(set(ys) | {y_inner_min, y_inner_max})
        for sy in sample_ys:
            if not (y_inner_min <= sy <= y_inner_max):
                continue
            r = x_range_at_y(sy)
            if r and r[1] > r[0]:
                x_left_max = max(x_left_max, r[0])
                x_right_min = min(x_right_min, r[1])

        width = x_right_min - x_left_max
        height = y_inner_max - y_inner_min
        if width < 1.0 or height < 1.0:
            return None
        return (x_left_max, y_inner_min, width, height)
