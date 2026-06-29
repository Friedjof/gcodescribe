from __future__ import annotations

from functools import lru_cache

import httpx

from .types import BBox

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

OVERPASS_TIMEOUT = 90.0

OVERPASS_HEADERS = {
    "User-Agent": "GCodeScribe/0.3 (+https://github.com/friedjof/gcodescribe)",
    "Accept": "application/json",
}

# Roads only, city-roads style. "RoadStrict" (after anvaka/city-roads): the
# drawable road network — includes *_link ramps, excludes way-areas.
ROADS_SELECTOR = (
    'way["highway"~"^(((motorway|trunk|primary|secondary|tertiary)(_link)?)'
    '|unclassified|residential|living_street|pedestrian|service|track)$"]["area"!="yes"]'
)


def build_overpass_query(bbox: BBox, area_id: int | None = None) -> str:
    """Overpass query for every road, either inside an OSM area (whole city,
    city-roads style) or within a bbox rectangle."""
    if area_id is not None:
        timeout = int(OVERPASS_TIMEOUT)
        header = [f"[out:json][timeout:{timeout}];", f"area({area_id})->.searchArea;"]
        scope = "(area.searchArea)"
    else:
        header = ["[out:json][timeout:30];"]
        scope = f"({bbox.south:.7f},{bbox.west:.7f},{bbox.north:.7f},{bbox.east:.7f})"
    return "\n".join([*header, "(", f"  {ROADS_SELECTOR}{scope};", ");", "out geom;"])


# Cache recent responses so changing only the detail slider re-renders from the
# already-fetched roads instead of hitting Overpass again (a big latency win).
@lru_cache(maxsize=6)
def fetch_overpass(query: str) -> dict:
    try:
        response = httpx.post(
            OVERPASS_URL,
            data={"data": query},
            headers=OVERPASS_HEADERS,
            timeout=OVERPASS_TIMEOUT,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise ValueError(
            "OSM data could not be loaded. Try a smaller place or try again."
        ) from exc
    data = response.json()
    if not isinstance(data, dict):
        raise ValueError("OSM returned an unexpected response.")
    return data
