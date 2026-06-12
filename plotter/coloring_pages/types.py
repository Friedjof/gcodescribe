from __future__ import annotations

from dataclasses import dataclass
from typing import Any

Point = tuple[float, float]
Polyline = list[Point]


@dataclass(frozen=True)
class ColoringPage:
    svg: str
    polylines: list[Polyline]
    width_mm: float
    height_mm: float
    metadata: dict[str, Any]
