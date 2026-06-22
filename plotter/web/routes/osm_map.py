from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ...calibration import Calibration
from ...osm import BBox, OsmMapRequest, generate_osm_map, parse_layers

router = APIRouter(tags=["osm-map"])


@router.get("/osm-map")
def osm_map(
    south: float = Query(..., ge=-90.0, le=90.0),
    west: float = Query(..., ge=-180.0, le=180.0),
    north: float = Query(..., ge=-90.0, le=90.0),
    east: float = Query(..., ge=-180.0, le=180.0),
    layers: str = Query("streets", min_length=1, max_length=128),
    width: float = Query(180.0, ge=20.0, le=2000.0),
    height: float = Query(180.0, ge=20.0, le=2000.0),
    detail: float = Query(0.5, ge=0.0, le=1.0),
    include_frame: bool = Query(False),
) -> dict:
    cal = Calibration.load()
    width = max(20.0, min(width, cal.plot_width))
    height = max(20.0, min(height, cal.plot_height))
    try:
        result = generate_osm_map(
            OsmMapRequest(
                bbox=BBox(south=south, west=west, north=north, east=east),
                layers=parse_layers(layers),
                width=width,
                height=height,
                detail=detail,
                include_frame=include_frame,
            )
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {
        "width": result.width,
        "height": result.height,
        "viewBox": result.view_box,
        "lines": result.lines,
        "metadata": result.metadata,
    }
