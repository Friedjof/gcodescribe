from __future__ import annotations

import numpy as np
from fastapi import APIRouter, HTTPException, Query

from ...calibration import Calibration
from ...drawing import Drawing, placed_gcode
from ...gallery_metrics import evaluate_gcode
from ...gcode_preview import parse_gcode_3d_text
from ...osm import BBox, OsmMapRequest, generate_osm_map, geocode
from ...pipeline import PlotterError
from ...services.upload_validation import MAX_GCODE_BYTES

router = APIRouter(tags=["osm-map"])


@router.get("/geocode")
def geocode_place(q: str = Query(..., min_length=1, max_length=200)) -> dict:
    """Resolve a place name to candidate areas (Nominatim, proxied)."""
    try:
        results = geocode(q)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {
        "results": [
            {
                "name": r.name,
                "lat": r.lat,
                "lon": r.lon,
                "south": r.bbox.south,
                "west": r.bbox.west,
                "north": r.bbox.north,
                "east": r.bbox.east,
                "osmType": r.osm_type,
                "osmId": r.osm_id,
                "areaId": r.area_id,
            }
            for r in results
        ]
    }


@router.get("/osm-map")
def osm_map(
    south: float = Query(..., ge=-90.0, le=90.0),
    west: float = Query(..., ge=-180.0, le=180.0),
    north: float = Query(..., ge=-90.0, le=90.0),
    east: float = Query(..., ge=-180.0, le=180.0),
    width: float = Query(180.0, ge=20.0, le=2000.0),
    height: float = Query(180.0, ge=20.0, le=2000.0),
    detail: float = Query(0.5, ge=0.0, le=1.0),
    include_frame: bool = Query(False),
    area_id: int | None = Query(None, ge=0),
) -> dict:
    cal = Calibration.load()
    width = max(20.0, min(width, cal.plot_width))
    height = max(20.0, min(height, cal.plot_height))
    try:
        result = generate_osm_map(
            OsmMapRequest(
                bbox=BBox(south=south, west=west, north=north, east=east),
                width=width,
                height=height,
                detail=detail,
                include_frame=include_frame,
                area_id=area_id,
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


@router.get("/osm-map/gcode")
def osm_map_gcode(
    south: float = Query(..., ge=-90.0, le=90.0),
    west: float = Query(..., ge=-180.0, le=180.0),
    north: float = Query(..., ge=-90.0, le=90.0),
    east: float = Query(..., ge=-180.0, le=180.0),
    width: float = Query(180.0, ge=20.0, le=2000.0),
    height: float = Query(180.0, ge=20.0, le=2000.0),
    detail: float = Query(0.5, ge=0.0, le=1.0),
    include_frame: bool = Query(False),
    area_id: int | None = Query(None, ge=0),
    continuous: bool = Query(True),
) -> dict:
    """Generate plotter G-code for the map and return its 3D preview + score.

    Mirrors how the map will actually plot (scaled to fill the plot area), so the
    score and pen-lift count are real. ``continuous`` draws the whole network in
    one stroke for maximum plottability.
    """
    cal = Calibration.load()
    width = max(20.0, min(width, cal.plot_width))
    height = max(20.0, min(height, cal.plot_height))
    try:
        result = generate_osm_map(
            OsmMapRequest(
                bbox=BBox(south=south, west=west, north=north, east=east),
                width=width,
                height=height,
                detail=detail,
                include_frame=include_frame,
                area_id=area_id,
            )
        )
        if not result.lines:
            raise HTTPException(422, "No roads found here — try another place.")
        polylines = [
            np.array([complex(x, y) for x, y in line]) for line in result.lines if len(line) >= 2
        ]
        drawing = Drawing(polylines, result.width, result.height)
        bx0, by0, bx1, by1 = drawing.bounds()
        bw, bh = bx1 - bx0, by1 - by0
        if bw <= 0 or bh <= 0:
            raise HTTPException(422, "The map has no plottable area.")
        scale = min(cal.plot_width / bw, cal.plot_height / bh)
        gcode = placed_gcode(
            drawing, cal, x=cal.origin_x, y=cal.origin_y,
            width=bw * scale, name="osm-map", continuous=continuous,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except PlotterError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"gcode3d": parse_gcode_3d_text(gcode), **evaluate_gcode(gcode, MAX_GCODE_BYTES)}
