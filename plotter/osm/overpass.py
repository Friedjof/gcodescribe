from __future__ import annotations

import httpx

from .types import BBox, OsmLayer

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

OVERPASS_TIMEOUT = 20.0

OVERPASS_HEADERS = {
    "User-Agent": "GCodeScribe/0.2 (+https://github.com/friedjof/gcodescribe)",
    "Accept": "application/json",
}


LAYER_QUERIES: dict[OsmLayer, tuple[str, ...]] = {
    "streets": (
        'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)$"]',
    ),
    "paths": (
        'way["highway"~"^(footway|path|cycleway|pedestrian|track|steps|bridleway)$"]',
    ),
    "buildings": ('way["building"]',),
    "waterways": ('way["waterway"~"^(river|stream|canal|ditch|drain)$"]',),
    "water": (
        'way["natural"="water"]',
        'way["water"]',
        'way["landuse"="reservoir"]',
    ),
    "rail": ('way["railway"~"^(rail|tram|subway|light_rail|narrow_gauge)$"]',),
    # Full bus/tram route relations need member ordering and de-duplication. For
    # this first data pipeline, transit maps to the physical rail-like network.
    "transit": (
        'way["railway"~"^(rail|tram|subway|light_rail|narrow_gauge)$"]',
        'way["public_transport"="platform"]',
    ),
}


def build_overpass_query(bbox: BBox, layers: tuple[OsmLayer, ...]) -> str:
    bbox_part = f"({bbox.south:.7f},{bbox.west:.7f},{bbox.north:.7f},{bbox.east:.7f})"
    selectors = [
        f"  {selector}{bbox_part};" for layer in layers for selector in LAYER_QUERIES[layer]
    ]
    return "\n".join(["[out:json][timeout:20];", "(", *selectors, ");", "out geom;"])


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
            "OSM data could not be loaded. Try a smaller area or fewer layers."
        ) from exc
    data = response.json()
    if not isinstance(data, dict):
        raise ValueError("OSM returned an unexpected response.")
    return data
