from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from plotter.artwork.pipeline import PlotterError
from plotter.core.calibration import Calibration
from plotter.gcode.metrics import evaluate_gcode
from plotter.gcode.preview import parse_gcode_3d_text
from plotter.gcode.scene import scene_gcode

from ...osm import BBox, OsmMapRequest, generate_osm_map, geocode
from ...osm.overpass import OverpassResourceError, OverpassUnavailableError
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
    layers: str = Query("roads", pattern=r"^(roads|rail|waterways)(,(roads|rail|waterways))*$"),
    road_level: Literal["motorways", "major", "collector", "local", "all"] = "all",
    rail_level: Literal["main", "all"] = "main",
    water_level: Literal["major", "streams", "all"] = "all",
    min_length_mm: float = Query(0.0, ge=0.0, le=10.0),
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
                layers=tuple(sorted(set(layers.split(",")))),
                road_level=road_level, rail_level=rail_level, water_level=water_level,
                min_length_mm=min_length_mm,
            )
        )
    except (OverpassResourceError, OverpassUnavailableError) as exc:
        raise HTTPException(503, str(exc)) from exc
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
    continuous: bool = Query(False),
    layers: str = Query("roads", pattern=r"^(roads|rail|waterways)(,(roads|rail|waterways))*$"),
    road_level: Literal["motorways", "major", "collector", "local", "all"] = "all",
    rail_level: Literal["main", "all"] = "main",
    water_level: Literal["major", "streams", "all"] = "all",
    min_length_mm: float = Query(0.0, ge=0.0, le=10.0),
) -> dict:
    """Generate plotter G-code for the map and return its 3D preview + score.

    Shares placement and routing with the editor's imported map page.
    ``continuous`` retraces existing edges to reduce lifts per connected network.
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
                layers=tuple(sorted(set(layers.split(",")))),
                road_level=road_level, rail_level=rail_level, water_level=water_level,
                min_length_mm=min_length_mm,
            )
        )
        if not result.lines:
            raise HTTPException(422, "No lines found for these map filters.")
        # Use the same placement and route planner as the imported editor page.
        gcode = scene_gcode({
            "name": "osm-map", "continuous": continuous,
            "objects": [{"data": {"template": "osmMap"}, "cachedPolylines": result.lines}],
        }, cal)
    except (OverpassResourceError, OverpassUnavailableError) as exc:
        raise HTTPException(503, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except PlotterError as exc:
        raise HTTPException(422, str(exc)) from exc
    evaluated = evaluate_gcode(gcode, MAX_GCODE_BYTES)
    draw_mm = evaluated["metrics"]["draw_mm"]
    retrace_mm = max(0.0, draw_mm - float(result.metadata["geometry_mm"])) if continuous else 0.0
    return {
        "gcode3d": {**parse_gcode_3d_text(gcode),
                    "bed": [cal.bed_width, cal.bed_height]}, **evaluated,
        "route": {"retrace_mm": round(retrace_mm, 1),
                  "retrace_percent": round(100 * retrace_mm / max(draw_mm, 1e-9), 1)},
    }
