"""Immutable, machine-coordinate plan shared by preview, scoring and output."""
from __future__ import annotations

import json
import math
from dataclasses import dataclass

from plotter.core.calibration import Calibration

Point = tuple[float, float]
Path = tuple[Point, ...]
VERSION = 1


@dataclass(frozen=True)
class PlotStroke:
    points: Path
    feeds: tuple[float, ...] | None = None
    pressures: tuple[float, ...] | None = None
    order_locked: bool = False
    source_group: str = "normal"

    def __post_init__(self) -> None:
        object.__setattr__(self, "points", tuple(tuple(p) for p in self.points))
        for field in ("feeds", "pressures"):
            if (values := getattr(self, field)) is not None:
                object.__setattr__(self, field, tuple(values))
        if len(self.points) < 2 or any(len(p) != 2 for p in self.points) or any(
            not math.isfinite(v) for p in self.points for v in p
        ):
            raise ValueError("Stiftwege benötigen mindestens zwei endliche XY-Punkte.")
        for values in (self.feeds, self.pressures):
            if values is not None and (
                len(values) != len(self.points) or any(not math.isfinite(v) for v in values)
            ):
                raise ValueError("Druck-/Tempowerte müssen zu allen Stützpunkten passen.")


@dataclass(frozen=True)
class PlanReport:
    baseline_travel_mm: float
    travel_mm: float
    draw_mm: float
    pen_contacts: int
    point_count: int
    algorithm: str
    diagnostics: tuple[str, ...] = ()
    continuous_extra_draw_mm: float = 0.0
    protected_strokes: int = 0


@dataclass(frozen=True)
class PlotPlan:
    plan_id: str
    name: str
    calibration_json: str
    strokes: tuple[PlotStroke, ...]
    travels: tuple[Path, ...]
    park_path: Path
    pressure_enabled: bool
    report: PlanReport
    version: int = VERSION

    def __post_init__(self) -> None:
        object.__setattr__(self, "strokes", tuple(self.strokes))
        object.__setattr__(self, "travels", tuple(
            tuple(tuple(point) for point in path) for path in self.travels
        ))
        object.__setattr__(self, "park_path", tuple(tuple(p) for p in self.park_path))
        if len(self.strokes) != len(self.travels):
            raise ValueError("Jeder Stiftweg benötigt genau eine geplante Anfahrt.")
        if any(not path or path[-1] != stroke.points[0]
               for stroke, path in zip(self.strokes, self.travels, strict=True)):
            raise ValueError("Eine geplante Anfahrt endet nicht am Anfang des Stiftwegs.")
        if any(len(p) != 2 or any(not math.isfinite(v) for v in p)
               for path in (*self.travels, self.park_path) for p in path):
            raise ValueError("Geplante Leerwege benötigen endliche XY-Koordinaten.")
        cal = self.calibration
        if cal.park_after_plot:
            target = tuple(round(v, 3) for v in cal.resolved_park()[:2])
            if not self.park_path or self.park_path[-1] != target:
                raise ValueError("Die geplante Parkfahrt endet nicht an der Parkposition.")
        elif self.park_path:
            raise ValueError("Eine Parkfahrt ist für diesen Plan nicht aktiviert.")

    @property
    def calibration(self) -> Calibration:
        """A fresh copy: neither the caller nor encoder can change this plan's setup."""
        return Calibration.from_dict(json.loads(self.calibration_json))
