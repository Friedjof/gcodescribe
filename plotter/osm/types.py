from __future__ import annotations

from dataclasses import dataclass

# Cap for a free bbox selection (boundary-area requests are not bbox-limited).
MAX_BBOX_SPAN_DEG = 0.5


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
            raise ValueError("Map area is too large. Search a place to use its boundary.")


@dataclass(frozen=True)
class OsmMapRequest:
    bbox: BBox
    width: float
    height: float
    detail: float = 0.5
    include_frame: bool = False
    # When set, roads are queried within this OSM area (whole city/boundary,
    # city-roads style) instead of the bbox rectangle.
    area_id: int | None = None


@dataclass(frozen=True)
class GeocodeResult:
    name: str
    lat: float
    lon: float
    bbox: BBox
    osm_type: str
    osm_id: int
    # Overpass area id derived from the OSM object (None for nodes, which have
    # no enclosing area). relation: +3_600_000_000, way: +2_400_000_000.
    area_id: int | None


@dataclass(frozen=True)
class OsmMapResult:
    width: float
    height: float
    view_box: str
    lines: list[list[tuple[float, float]]]
    metadata: dict[str, object]
