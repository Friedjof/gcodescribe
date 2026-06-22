from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

OsmLayer = Literal["streets", "paths", "buildings", "waterways", "water", "rail", "transit"]

VALID_LAYERS: tuple[OsmLayer, ...] = (
    "streets",
    "paths",
    "buildings",
    "waterways",
    "water",
    "rail",
    "transit",
)

MAX_BBOX_SPAN_DEG = 0.25


@dataclass(frozen=True)
class BBox:
    south: float
    west: float
    north: float
    east: float

    def validate(self) -> None:
        if not (-90.0 <= self.south <= 90.0 and -90.0 <= self.north <= 90.0):
            raise ValueError("Latitude must be between -90 and 90 degrees.")
        if not (-180.0 <= self.west <= 180.0 and -180.0 <= self.east <= 180.0):
            raise ValueError("Longitude must be between -180 and 180 degrees.")
        if self.south >= self.north or self.west >= self.east:
            raise ValueError("Bounding box must use south < north and west < east.")
        if self.north - self.south > MAX_BBOX_SPAN_DEG or self.east - self.west > MAX_BBOX_SPAN_DEG:
            raise ValueError("Map area is too large. Zoom in and select a smaller section.")


@dataclass(frozen=True)
class OsmMapRequest:
    bbox: BBox
    layers: tuple[OsmLayer, ...]
    width: float
    height: float
    detail: float = 0.5
    include_frame: bool = False


@dataclass(frozen=True)
class OsmMapResult:
    width: float
    height: float
    view_box: str
    lines: list[list[tuple[float, float]]]
    metadata: dict[str, object]


def parse_layers(value: str) -> tuple[OsmLayer, ...]:
    layers = tuple(dict.fromkeys(part.strip() for part in value.split(",") if part.strip()))
    if not layers:
        raise ValueError("Select at least one map layer.")
    invalid = [layer for layer in layers if layer not in VALID_LAYERS]
    if invalid:
        raise ValueError(f"Unknown map layer: {', '.join(invalid)}")
    return layers  # type: ignore[return-value]
