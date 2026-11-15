"""OSM line features and explicit, nested road classes for plotter maps."""
from __future__ import annotations

from .overpass import ROADS_SELECTOR
from .types import OsmMapRequest

ROAD_CLASSES = {
    "motorways": "motorway|trunk",
    "major": "motorway|trunk|primary|secondary",
    "collector": "motorway|trunk|primary|secondary|tertiary",
    "local": "motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street",
    "all": "motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street"
           "|pedestrian|service|track",
}


def map_selectors(req: OsmMapRequest) -> tuple[str, ...]:
    if not req.layers or set(req.layers) - {"roads", "rail", "waterways"}:
        raise ValueError("Select at least one valid map layer.")
    if req.road_level not in ROAD_CLASSES:
        raise ValueError("Unknown road level.")
    if req.rail_level not in {"main", "all"} or req.water_level not in {"major", "streams", "all"}:
        raise ValueError("Unknown rail or waterway level.")
    selectors: list[str] = []
    if "roads" in req.layers:
        classes = ROAD_CLASSES[req.road_level]
        selectors.append(ROADS_SELECTOR if req.road_level == "all" else
                         f'way["highway"~"^(({classes})(_link)?)$"]["area"!="yes"]')
    if "rail" in req.layers:
        classes = "rail|narrow_gauge"
        service = '["service"!~"^(siding|spur|yard|crossover)$"]'
        if req.rail_level == "all":
            classes += "|light_rail|subway|tram|monorail|funicular"
            service = ""
        selectors.append(f'way["railway"~"^({classes})$"]{service}["area"!="yes"]')
    if "waterways" in req.layers:
        classes = "river|canal"
        if req.water_level in {"streams", "all"}:
            classes += "|stream|tidal_channel"
        if req.water_level == "all":
            classes += "|ditch|drain"
        selectors.append(f'way["waterway"~"^({classes})$"]["area"!="yes"]')
    return tuple(selectors)
