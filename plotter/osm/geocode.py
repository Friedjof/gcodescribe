from __future__ import annotations

import httpx

from .types import BBox, GeocodeResult

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_TIMEOUT = 15.0

# Nominatim's usage policy requires an identifying User-Agent.
NOMINATIM_HEADERS = {
    "User-Agent": "GCodeScribe/0.3 (+https://github.com/friedjof/gcodescribe)",
    "Accept": "application/json",
}

# Overpass area ids are derived from OSM object ids (see city-roads).
_RELATION_OFFSET = 3_600_000_000
_WAY_OFFSET = 2_400_000_000

_cache: dict[str, list[GeocodeResult]] = {}


def _area_id(osm_type: str, osm_id: int) -> int | None:
    if osm_type == "relation":
        return osm_id + _RELATION_OFFSET
    if osm_type == "way":
        return osm_id + _WAY_OFFSET
    return None  # nodes have no enclosing area


def _parse(rows: object) -> list[GeocodeResult]:
    results: list[GeocodeResult] = []
    if not isinstance(rows, list):
        return results
    for row in rows:
        if not isinstance(row, dict):
            continue
        box = row.get("boundingbox")
        if not (isinstance(box, list) and len(box) == 4):
            continue
        try:
            # Nominatim order: [south, north, west, east]
            south, north, west, east = (float(v) for v in box)
            osm_id = int(row["osm_id"])
            lat = float(row["lat"])
            lon = float(row["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        osm_type = str(row.get("osm_type", ""))
        results.append(
            GeocodeResult(
                name=str(row.get("display_name", "")),
                lat=lat,
                lon=lon,
                bbox=BBox(south=south, west=west, north=north, east=east),
                osm_type=osm_type,
                osm_id=osm_id,
                area_id=_area_id(osm_type, osm_id),
            )
        )
    return results


def geocode(query: str, limit: int = 5, fetcher=None) -> list[GeocodeResult]:
    """Resolve a place name to candidate areas via Nominatim (proxied so we send
    a proper User-Agent and cache repeats). ``fetcher`` is injectable for tests."""
    query = query.strip()
    if not query:
        raise ValueError("Enter a place to search for.")
    cached = _cache.get(query)
    if cached is not None:
        return cached
    rows = (fetcher or _fetch)(query, limit)
    results = _parse(rows)
    _cache[query] = results
    return results


def _fetch(query: str, limit: int) -> object:
    try:
        response = httpx.get(
            NOMINATIM_URL,
            params={"format": "json", "q": query, "limit": max(1, min(limit, 10))},
            headers=NOMINATIM_HEADERS,
            timeout=NOMINATIM_TIMEOUT,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise ValueError("Place search is unavailable right now. Try again.") from exc
    return response.json()
