from __future__ import annotations

import re
import time
from collections.abc import Callable
from contextvars import ContextVar
from functools import lru_cache

import httpx

from .cache import read_roads, write_roads
from .types import BBox

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

OVERPASS_TIMEOUT = 90.0
# Retry on the official pool's other backend when normal routing fails.
OVERPASS_FALLBACK_URL = "https://gall.openstreetmap.de/api/interpreter"
_preferred_url = OVERPASS_URL

TILE_TIMEOUT = 25
INITIAL_TILE_SPAN = 1.0
MAX_TILE_DEPTH = 6
MAX_TILE_REQUESTS = 64
MAX_DOWNLOAD_SECONDS = 180.0
_download_deadline: ContextVar[float | None] = ContextVar("osm_download_deadline", default=None)

OVERPASS_HEADERS = {
    "User-Agent": "GCodeScribe/0.3 (+https://github.com/friedjof/gcodescribe)",
    "Accept": "application/json",
}


class OverpassResourceError(ValueError):
    """The server could not finish this query; smaller queries may succeed."""


class OverpassUnavailableError(ValueError):
    """A service failure that splitting the query cannot fix."""


class OverpassRateLimitError(OverpassUnavailableError):
    def __init__(self, retry_after: float = 20.0):
        super().__init__("OSM data service is busy.")
        self.retry_after = retry_after


def _remaining_seconds() -> float:
    deadline = _download_deadline.get()
    return max(0.0, deadline - time.monotonic()) if deadline is not None else float("inf")


# Roads only, city-roads style. "RoadStrict" (after anvaka/city-roads): the
# drawable road network — includes *_link ramps, excludes way-areas.
ROADS_SELECTOR = (
    'way["highway"~"^(((motorway|trunk|primary|secondary|tertiary)(_link)?)'
    '|unclassified|residential|living_street|pedestrian|service|track)$"]["area"!="yes"]'
)


def build_overpass_query(
    bbox: BBox, area_id: int | None = None, *, tile: bool = False,
    selectors: tuple[str, ...] = (ROADS_SELECTOR,),
) -> str:
    """Overpass query for every road, either inside an OSM area (whole city,
    city-roads style) or within a bbox rectangle."""
    if area_id is not None:
        timeout = TILE_TIMEOUT if tile else int(OVERPASS_TIMEOUT)
        header = [f"[out:json][timeout:{timeout}];", f"area({area_id})->.searchArea;"]
        scope = "(area.searchArea)"
    else:
        header = ["[out:json][timeout:30];"]
        scope = f"({bbox.south:.7f},{bbox.west:.7f},{bbox.north:.7f},{bbox.east:.7f})"
    if tile and area_id is not None:
        scope += f"({bbox.south:.7f},{bbox.west:.7f},{bbox.north:.7f},{bbox.east:.7f})"
    # Geometry is sufficient; tags and id sorting add cost without improving
    # the map. Keep complete ways so overlapping tiles can be deduplicated.
    return "\n".join([
        *header, "(", *(f"  {selector}{scope};" for selector in selectors),
        ");", "out skel geom qt;",
    ])


# Cache recent responses so changing only the detail slider re-renders from the
# already-fetched roads instead of hitting Overpass again (a big latency win).
@lru_cache(maxsize=2)
def fetch_overpass(query: str) -> dict:
    global _preferred_url
    urls = dict.fromkeys((_preferred_url, OVERPASS_URL, OVERPASS_FALLBACK_URL))
    errors: list[tuple[str, ValueError]] = []
    for url in urls:
        try:
            data = _post_overpass(query, url)
        except (OverpassResourceError, OverpassUnavailableError) as exc:
            errors.append((url, exc))
            continue
        _preferred_url = url
        return data
    # A genuine query resource failure may benefit from smaller tiles. Network
    # failures and rate limits must not trigger dozens of pointless requests.
    # Respect the service's cool-down instead of immediately multiplying a
    # rate-limited query into more tiles. Retry only once, within the budget.
    for url, error in reversed(errors):
        if isinstance(error, OverpassRateLimitError):
            if error.retry_after >= _remaining_seconds():
                break
            time.sleep(error.retry_after)
            try:
                data = _post_overpass(query, url)
            except (OverpassResourceError, OverpassUnavailableError):
                break
            _preferred_url = url
            return data
    if any(isinstance(error, OverpassRateLimitError) for _, error in errors):
        raise OverpassUnavailableError(
            "Die Kartendaten-Server sind momentan ausgelastet. Bitte später erneut versuchen."
        )
    for _, error in errors:
        if isinstance(error, OverpassResourceError):
            raise error
    raise OverpassUnavailableError(
        "Die Kartendaten-Server sind momentan nicht erreichbar oder überlastet. "
        "Bitte später erneut versuchen."
    ) from errors[-1][1]


def _post_overpass(query: str, url: str) -> dict:
    timeout_match = re.search(r"\[timeout:(\d+)\]", query)
    timeout = float(timeout_match[1]) if timeout_match else OVERPASS_TIMEOUT
    remaining = _remaining_seconds()
    if remaining <= 0:
        raise OverpassResourceError("Die verfügbare Ladezeit für die Kartendaten ist abgelaufen.")
    try:
        response = httpx.post(
            url,
            data={"data": query},
            headers=OVERPASS_HEADERS,
            timeout=httpx.Timeout(min(timeout + 10.0, remaining), connect=min(10.0, remaining)),
        )
        response.raise_for_status()
    except httpx.ConnectTimeout as exc:
        raise OverpassUnavailableError("OSM connection timed out.") from exc
    except httpx.TimeoutException as exc:
        raise OverpassResourceError("OSM data query timed out.") from exc
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 504:
            raise OverpassResourceError("OSM data query timed out.") from exc
        if exc.response.status_code == 429:
            try:
                retry_after = float(exc.response.headers.get("Retry-After", "20"))
            except ValueError:
                retry_after = 20.0
            raise OverpassRateLimitError(max(1.0, min(retry_after, 60.0))) from exc
        if exc.response.status_code >= 500:
            raise OverpassUnavailableError("OSM data service is busy.") from exc
        raise ValueError("OSM data service is unavailable right now. Try again.") from exc
    except httpx.HTTPError as exc:
        raise OverpassUnavailableError("OSM data service is unavailable.") from exc
    try:
        data = response.json()
    except ValueError as exc:
        raise ValueError("OSM returned an invalid response. Try again.") from exc
    if not isinstance(data, dict):
        raise ValueError("OSM returned an unexpected response.")
    # Overpass can return HTTP 200 with an error and *partial* elements.
    # Never cache or draw these as if they were a complete city.
    if data.get("remark"):
        raise OverpassResourceError("OSM could not finish loading the map area.")
    if not isinstance(data.get("elements"), list):
        raise ValueError("OSM returned an unexpected element list.")
    return data


def fetch_roads(
    bbox: BBox, area_id: int | None = None, *, fetcher: Callable[[str], dict] | None = None,
    selectors: tuple[str, ...] = (ROADS_SELECTOR,),
) -> dict:
    """Load complete roads with bounded adaptive tiling and a durable cache."""
    selector_key = "\n".join(selectors)
    if fetcher is None:
        cached = read_roads(bbox, area_id, selector_key)
        if cached is not None:
            return cached
    load = fetcher or fetch_overpass
    ways: dict[int, dict] = {}
    started = time.monotonic()
    requests = 0

    def visit(box: BBox, depth: int, *, tile: bool) -> None:
        nonlocal requests
        if requests >= MAX_TILE_REQUESTS or time.monotonic() - started >= MAX_DOWNLOAD_SECONDS:
            raise OverpassResourceError(
                "Die Kartendaten konnten wegen ausgelasteter Server nicht vollständig "
                "geladen werden. Bitte später erneut versuchen."
            )
        # Start exceptionally large regions with smaller queries. Normal city
        # requests try the complete area first to avoid rate limits from many
        # small downloads; resource failures then trigger adaptive subdivision.
        span = max(box.north - box.south, box.east - box.west)
        if span > INITIAL_TILE_SPAN + 1e-9 and depth < MAX_TILE_DEPTH:
            for child in _split_bbox(box):
                visit(child, depth + 1, tile=True)
            return
        requests += 1
        tile_selector = f"{selector_key}|tile"
        data = read_roads(box, area_id, tile_selector) if fetcher is None and tile else None
        try:
            if data is None:
                data = load(build_overpass_query(box, area_id, tile=tile, selectors=selectors))
                if fetcher is None and tile:
                    write_roads(box, area_id, tile_selector, data)
        except OverpassResourceError as exc:
            if depth >= MAX_TILE_DEPTH:
                raise OverpassResourceError(
                    "Die Kartendaten-Server antworten auch für kleine Teilgebiete zu langsam. "
                    "Bitte später erneut versuchen."
                ) from exc
            for child in _split_bbox(box):
                visit(child, depth + 1, tile=True)
            return
        for element in data["elements"]:
            if isinstance(element, dict) and element.get("type") == "way":
                ways[element["id"]] = element

    token = _download_deadline.set(started + MAX_DOWNLOAD_SECONDS)
    try:
        visit(bbox, 0, tile=False)
    finally:
        _download_deadline.reset(token)
    result = {"elements": list(ways.values())}
    if fetcher is None:
        write_roads(bbox, area_id, selector_key, result)
    return result


def _split_bbox(box: BBox) -> tuple[BBox, BBox]:
    """Bisect the longer axis, keeping every part of the requested area."""
    if box.east - box.west >= box.north - box.south:
        middle = (box.west + box.east) / 2
        return (
            BBox(box.south, box.west, box.north, middle),
            BBox(box.south, middle, box.north, box.east),
        )
    middle = (box.south + box.north) / 2
    return (
        BBox(box.south, box.west, middle, box.east),
        BBox(middle, box.west, box.north, box.east),
    )
