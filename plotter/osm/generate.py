from __future__ import annotations

import math
from collections.abc import Callable

from .overpass import build_overpass_query, fetch_overpass
from .types import OsmMapRequest, OsmMapResult

Point = tuple[float, float]
Polyline = list[Point]

MAX_LINES = 6000
MAX_POINTS = 120000

# Endpoint snap distance (plotter mm) used to stitch OSM ways into continuous
# polylines. Shared OSM nodes project to identical coordinates, so a small grid
# is enough to absorb rounding noise.
SNAP_TOLERANCE = 0.05

# Categories whose open ways form a connected network and may be merged
# end-to-end. Closed footprints (buildings, water) are kept as separate loops.
MERGEABLE_CATEGORIES = frozenset({"highway", "waterway", "railway"})

# When many buildings would each render smaller than this (mm), individual
# footprints turn into confetti. Instead we aggregate them into the outline of
# the built-up area so the result reads like a map rather than scattered dots.
BUILDING_REF_M = 14.0
FOOTPRINT_MIN_MM = 2.5
BLOCK_MIN_BUILDINGS = 200
BLOCK_CELL_MIN_MM = 1.5
BLOCK_CELL_MAX_MM = 5.0


def generate_osm_map(
    req: OsmMapRequest, fetcher: Callable[[str], dict] | None = None
) -> OsmMapResult:
    """Load OSM ways and convert them into plotter-space polylines."""

    req.bbox.validate()
    query = build_overpass_query(req.bbox, req.layers)
    data = (fetcher or fetch_overpass)(query)
    osm_lines, extra_meta = _overpass_lines(data, req)
    lines: list[list[tuple[float, float]]] = []
    if req.include_frame:
        lines.append(
            [(0.0, 0.0), (req.width, 0.0), (req.width, req.height), (0.0, req.height), (0.0, 0.0)]
        )
    lines.extend(osm_lines)
    protected_count = 1 if req.include_frame else 0
    lines, detail_reduced = _fit_detail_budget(lines, protected_count)
    point_count = sum(len(line) for line in lines)
    elements = data.get("elements", [])
    return OsmMapResult(
        width=req.width,
        height=req.height,
        view_box=f"0 0 {req.width:g} {req.height:g}",
        lines=lines,
        metadata={
            "source": "osm",
            "status": "loaded",
            "layers": list(req.layers),
            "detail": req.detail,
            "detail_reduced": detail_reduced,
            "line_count": len(lines),
            "point_count": point_count,
            "osm_elements": len(elements) if isinstance(elements, list) else 0,
            **extra_meta,
            "bbox": {
                "south": req.bbox.south,
                "west": req.bbox.west,
                "north": req.bbox.north,
                "east": req.bbox.east,
            },
        },
    )


def _overpass_lines(data: dict, req: OsmMapRequest) -> tuple[list[Polyline], dict[str, object]]:
    elements = data.get("elements", [])
    if not isinstance(elements, list):
        raise ValueError("OSM returned an unexpected element list.")

    # Project every way first, but defer simplification. OSM splits roads at
    # each junction, so simplifying per way collapses every fragment to a 2-point
    # stub. Mergeable open ways are stitched into continuous polylines so a long
    # straight road becomes one line that Douglas-Peucker can keep straight.
    open_by_category: dict[str, list[Polyline]] = {}
    buildings: list[Polyline] = []
    standalone: list[Polyline] = []
    for element in elements:
        if not isinstance(element, dict) or element.get("type") != "way":
            continue
        geometry = element.get("geometry")
        if not isinstance(geometry, list):
            continue
        raw = [_project_point(point, req) for point in geometry if _has_lat_lon(point)]
        line = _dedupe_consecutive(raw)
        if len(line) < 2:
            continue
        category = _category(element)
        is_closed = len(line) >= 3 and line[0] == line[-1]
        if category == "building":
            buildings.append(line)
        elif category in MERGEABLE_CATEGORIES and not is_closed:
            open_by_category.setdefault(category, []).append(line)
        else:
            standalone.append(line)

    merged: list[Polyline] = []
    for group in open_by_category.values():
        merged.extend(_chain_lines(group, SNAP_TOLERANCE))
    merged.extend(standalone)
    building_lines, building_mode = _render_buildings(buildings, req)
    merged.extend(building_lines)

    # Simplify after merging so straight runs collapse to their endpoints.
    tolerance = _simplify_tolerance(req.detail)
    lines: list[Polyline] = []
    seen: set[tuple[Point, ...]] = set()
    for line in merged:
        line = _simplify(line, tolerance)
        if len(line) < 2:
            continue
        key = tuple((round(x, 3), round(y, 3)) for x, y in line)
        rev_key = tuple(reversed(key))
        if key in seen or rev_key in seen:
            continue
        seen.add(key)
        lines.append(line)
    return lines, {"building_mode": building_mode}


def _render_buildings(buildings: list[Polyline], req: OsmMapRequest) -> tuple[list[Polyline], str]:
    """Draw real footprints when buildings are big enough, otherwise aggregate.

    At wide extents each footprint shrinks to sub-millimeter confetti. There we
    rasterize building coverage and trace the outline of the built-up area, which
    reads like a printed map instead of scattered dots.
    """
    if not buildings:
        return [], "none"
    scale = _mm_per_meter(req)
    if (
        len(buildings) < BLOCK_MIN_BUILDINGS
        or scale <= 0
        or BUILDING_REF_M * scale >= FOOTPRINT_MIN_MM
    ):
        return buildings, "footprints"
    return _building_blocks(buildings, req), "blocks"


def _mm_per_meter(req: OsmMapRequest) -> float:
    bbox = req.bbox
    mid_lat = math.radians((bbox.north + bbox.south) / 2)
    span_m = (bbox.east - bbox.west) * 111_320.0 * math.cos(mid_lat)
    if span_m <= 0:
        return 0.0
    return req.width / span_m


def _building_blocks(buildings: list[Polyline], req: OsmMapRequest) -> list[Polyline]:
    cell = _clamp(
        BLOCK_CELL_MIN_MM + (1.0 - req.detail) * 3.0,
        BLOCK_CELL_MIN_MM,
        BLOCK_CELL_MAX_MM,
    )
    cols = max(1, math.ceil(req.width / cell))
    rows = max(1, math.ceil(req.height / cell))
    filled: set[tuple[int, int]] = set()
    for poly in buildings:
        _rasterize_polygon(poly, filled, cols, rows, cell)
    if not filled:
        return []

    # Emit each cell edge that borders the empty side; chaining stitches them
    # into the silhouette of the built-up blocks.
    edges: list[Polyline] = []
    for i, j in filled:
        x0, y0 = i * cell, j * cell
        x1, y1 = min((i + 1) * cell, req.width), min((j + 1) * cell, req.height)
        if (i - 1, j) not in filled:
            edges.append([(x0, y0), (x0, y1)])
        if (i + 1, j) not in filled:
            edges.append([(x1, y0), (x1, y1)])
        if (i, j - 1) not in filled:
            edges.append([(x0, y0), (x1, y0)])
        if (i, j + 1) not in filled:
            edges.append([(x0, y1), (x1, y1)])

    chained = _chain_lines(edges, SNAP_TOLERANCE)
    return [_simplify(line, cell) for line in chained]


def _rasterize_polygon(
    poly: Polyline, filled: set[tuple[int, int]], cols: int, rows: int, cell: float
) -> None:
    pts = poly if poly[0] == poly[-1] else [*poly, poly[0]]
    ys = [p[1] for p in pts]
    j_min = max(0, int(min(ys) // cell))
    j_max = min(rows - 1, int(max(ys) // cell))
    for j in range(j_min, j_max + 1):
        yc = (j + 0.5) * cell
        crossings: list[float] = []
        for (x1, y1), (x2, y2) in zip(pts, pts[1:], strict=False):
            if (y1 <= yc < y2) or (y2 <= yc < y1):
                crossings.append(x1 + (yc - y1) / (y2 - y1) * (x2 - x1))
        crossings.sort()
        for xa, xb in zip(crossings[0::2], crossings[1::2], strict=False):
            i_a = max(0, math.ceil(xa / cell - 0.5))
            i_b = min(cols - 1, math.floor(xb / cell - 0.5))
            for i in range(i_a, i_b + 1):
                filled.add((i, j))


def _category(element: dict) -> str:
    tags = element.get("tags")
    if not isinstance(tags, dict):
        return "other"
    if "highway" in tags:
        return "highway"
    if "waterway" in tags:
        return "waterway"
    if "railway" in tags:
        return "railway"
    if "building" in tags:
        return "building"
    return "other"


def _snap_key(point: Point, snap: float) -> tuple[int, int]:
    return (round(point[0] / snap), round(point[1] / snap))


def _chain_lines(lines: list[Polyline], snap: float) -> list[Polyline]:
    """Stitch open ways that share an endpoint into maximal polylines.

    Walks through pass-through nodes (exactly two way-ends meet) and stops at
    real junctions (degree != 2) so the network topology is preserved.
    """
    if len(lines) <= 1:
        return list(lines)
    ends: dict[tuple[int, int], list[tuple[int, int]]] = {}
    for idx, line in enumerate(lines):
        ends.setdefault(_snap_key(line[0], snap), []).append((idx, 0))
        ends.setdefault(_snap_key(line[-1], snap), []).append((idx, 1))
    used = [False] * len(lines)
    result: list[Polyline] = []
    for start_idx in range(len(lines)):
        if used[start_idx]:
            continue
        used[start_idx] = True
        chain: Polyline = list(lines[start_idx])
        _extend_chain(chain, lines, ends, used, snap, at_tail=True)
        _extend_chain(chain, lines, ends, used, snap, at_tail=False)
        result.append(chain)
    return result


def _extend_chain(
    chain: Polyline,
    lines: list[Polyline],
    ends: dict[tuple[int, int], list[tuple[int, int]]],
    used: list[bool],
    snap: float,
    at_tail: bool,
) -> None:
    while True:
        node = _snap_key(chain[-1] if at_tail else chain[0], snap)
        entries = ends.get(node, ())
        if len(entries) != 2:
            break
        nxt = next(((i, e) for i, e in entries if not used[i]), None)
        if nxt is None:
            break
        idx, end = nxt
        used[idx] = True
        seg = lines[idx]
        outward = seg if end == 0 else list(reversed(seg))
        new_points = outward[1:]
        if not new_points:
            break
        if at_tail:
            chain.extend(new_points)
        else:
            chain[:0] = list(reversed(new_points))


def _fit_detail_budget(lines: list[Polyline], protected_count: int) -> tuple[list[Polyline], bool]:
    if len(lines) <= MAX_LINES and sum(len(line) for line in lines) <= MAX_POINTS:
        return lines, False

    protected = lines[:protected_count]
    candidates = lines[protected_count:]
    reduced = candidates
    for tolerance in (2.5, 4.0, 6.0, 8.0, 12.0):
        reduced = [_simplify(line, tolerance) for line in reduced]
        reduced = [line for line in reduced if len(line) >= 2]
        if (
            len(protected) + len(reduced) <= MAX_LINES
            and _point_count(protected, reduced) <= MAX_POINTS
        ):
            return protected + reduced, True

    max_candidates = max(0, MAX_LINES - len(protected))
    if len(reduced) > max_candidates:
        reduced = _sample_evenly(reduced, max_candidates)

    while reduced and _point_count(protected, reduced) > MAX_POINTS:
        reduced = _sample_evenly(reduced, max(1, len(reduced) * 3 // 4))

    return protected + reduced, True


def _point_count(protected: list[Polyline], candidates: list[Polyline]) -> int:
    return sum(len(line) for line in protected) + sum(len(line) for line in candidates)


def _sample_evenly(lines: list[Polyline], limit: int) -> list[Polyline]:
    if limit <= 0:
        return []
    if len(lines) <= limit:
        return lines
    if limit == 1:
        return [lines[0]]
    last = len(lines) - 1
    indexes = {round(i * last / (limit - 1)) for i in range(limit)}
    return [line for index, line in enumerate(lines) if index in indexes]


def _has_lat_lon(value: object) -> bool:
    return (
        isinstance(value, dict)
        and isinstance(value.get("lat"), int | float)
        and isinstance(value.get("lon"), int | float)
    )


def _project_point(point: dict, req: OsmMapRequest) -> Point:
    bbox = req.bbox
    x = (float(point["lon"]) - bbox.west) / (bbox.east - bbox.west) * req.width
    y = (bbox.north - float(point["lat"])) / (bbox.north - bbox.south) * req.height
    return (round(_clamp(x, 0.0, req.width), 4), round(_clamp(y, 0.0, req.height), 4))


def _dedupe_consecutive(line: Polyline) -> Polyline:
    result: Polyline = []
    last: Point | None = None
    for point in line:
        if point != last:
            result.append(point)
            last = point
    return result


def _simplify_tolerance(detail: float) -> float:
    return 0.15 + (1.0 - detail) * 1.85


def _simplify(line: Polyline, tolerance: float) -> Polyline:
    n = len(line)
    if n <= 2 or tolerance <= 0:
        return line
    # Iterative Douglas-Peucker: merged chains can carry thousands of points,
    # so recursion would risk hitting Python's stack limit.
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        s, e = stack.pop()
        if e <= s + 1:
            continue
        start = line[s]
        end = line[e]
        max_distance = -1.0
        index = -1
        for i in range(s + 1, e):
            distance = _point_line_distance(line[i], start, end)
            if distance > max_distance:
                max_distance = distance
                index = i
        if max_distance > tolerance:
            keep[index] = True
            stack.append((s, index))
            stack.append((index, e))
    return [line[i] for i in range(n) if keep[i]]


def _point_line_distance(point: Point, start: Point, end: Point) -> float:
    if start == end:
        return math.dist(point, start)
    x, y = point
    x1, y1 = start
    x2, y2 = end
    numerator = abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1)
    denominator = math.hypot(y2 - y1, x2 - x1)
    return numerator / denominator


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))
