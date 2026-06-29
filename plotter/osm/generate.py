from __future__ import annotations

import math
from collections.abc import Callable

from ..linemerge import merge_polylines
from .overpass import build_overpass_query, fetch_overpass
from .types import OsmMapRequest, OsmMapResult

Point = tuple[float, float]
Polyline = list[Point]
Projector = Callable[[float, float], Point]

MAX_LINES = 9000
MAX_POINTS = 200000

# Endpoint snap distance (plotter mm) used to stitch OSM road fragments into
# continuous strokes. OSM splits roads at every junction; merging picks the
# straightest continuation through each junction, so a road becomes one long
# line instead of dozens of stubs — far fewer pen lifts and a much more
# plottable, map-like result.
SNAP_TOLERANCE = 0.2

# Blank margin (mm) kept around the map so it sits centred on the page.
MARGIN_MM = 4.0


def generate_osm_map(
    req: OsmMapRequest, fetcher: Callable[[str], dict] | None = None
) -> OsmMapResult:
    """Load every road in the area and convert it to plotter-space polylines.

    Roads-only, city-roads style: Web-Mercator projection, aspect-correct fit,
    fragments chained into continuous lines, then simplified to a point budget.
    """
    # In boundary mode the bbox is only a hint, so skip the span cap.
    if req.area_id is None:
        req.bbox.validate()
    query = build_overpass_query(req.bbox, req.area_id)
    data = (fetcher or fetch_overpass)(query)

    project, out_w, out_h, frame_rect = _build_projector(data, req)
    osm_lines = _road_lines(data, req, project)

    lines: list[Polyline] = []
    if req.include_frame:
        fx0, fy0, fx1, fy1 = frame_rect
        lines.append([(fx0, fy0), (fx1, fy0), (fx1, fy1), (fx0, fy1), (fx0, fy0)])
    lines.extend(osm_lines)

    protected_count = 1 if req.include_frame else 0
    lines, detail_reduced = _fit_detail_budget(lines, protected_count)
    point_count = sum(len(line) for line in lines)
    elements = data.get("elements", []) if isinstance(data, dict) else []
    return OsmMapResult(
        width=out_w,
        height=out_h,
        view_box=f"0 0 {out_w:g} {out_h:g}",
        lines=lines,
        metadata={
            "source": "osm",
            "status": "loaded",
            "detail": req.detail,
            "detail_reduced": detail_reduced,
            "line_count": len(lines),
            "point_count": point_count,
            "osm_elements": len(elements) if isinstance(elements, list) else 0,
            "bbox": {
                "south": req.bbox.south,
                "west": req.bbox.west,
                "north": req.bbox.north,
                "east": req.bbox.east,
            },
        },
    )


def _road_lines(data: dict, req: OsmMapRequest, project: Projector) -> list[Polyline]:
    elements = data.get("elements", [])
    if not isinstance(elements, list):
        raise ValueError("OSM returned an unexpected element list.")

    ways: list[Polyline] = []
    for element in elements:
        if not isinstance(element, dict) or element.get("type") != "way":
            continue
        geometry = element.get("geometry")
        if not isinstance(geometry, list):
            continue
        raw = [
            project(float(point["lon"]), float(point["lat"]))
            for point in geometry
            if _has_lat_lon(point)
        ]
        line = _dedupe_consecutive(raw)
        if len(line) >= 2:
            ways.append(line)

    # Merge fragments into long continuous strokes (straightest continuation at
    # junctions) — this is what makes the result plottable.
    merged = merge_polylines(ways, tol=SNAP_TOLERANCE)

    # Join every separate component into one connected network with the shortest
    # possible links, so the map can be plotted as a single continuous stroke
    # (no pen lifts between islands).
    merged = _connect_components(merged, SNAP_TOLERANCE)

    tolerance = _simplify_tolerance(req.detail)
    lines: list[Polyline] = []
    seen: set[tuple[Point, ...]] = set()
    for line in merged:
        line = _simplify(line, tolerance)
        if len(line) < 2:
            continue
        key = tuple((round(x, 3), round(y, 3)) for x, y in line)
        if key in seen or tuple(reversed(key)) in seen:
            continue
        seen.add(key)
        lines.append(line)
    return lines


# ---- connectivity ----------------------------------------------------------

class _UnionFind:
    def __init__(self, n: int) -> None:
        self.parent = list(range(n))

    def find(self, a: int) -> int:
        while self.parent[a] != a:
            self.parent[a] = self.parent[self.parent[a]]
            a = self.parent[a]
        return a

    def union(self, a: int, b: int) -> bool:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        self.parent[ra] = rb
        return True


def _connect_components(lines: list[Polyline], tol: float) -> list[Polyline]:
    """Join all separate components into ONE connected network.

    Components that share endpoints are already one piece; the rest are linked at
    their **nearest points** (the touched stroke is split there) with the
    shortest possible connectors, chosen via a KD-tree + Kruskal MST. The result
    can be drawn as a single continuous stroke with no pen lifts between islands.
    """
    import numpy as np
    from scipy.spatial import cKDTree

    if len(lines) <= 1:
        return lines

    uf = _UnionFind(len(lines))
    inv = 1.0 / tol if tol > 0 else 1e9
    seen_node: dict[tuple[int, int], int] = {}
    for i, line in enumerate(lines):
        for end in (line[0], line[-1]):
            key = (round(end[0] * inv), round(end[1] * inv))
            other = seen_node.get(key)
            if other is None:
                seen_node[key] = i
            else:
                uf.union(i, other)

    if len({uf.find(i) for i in range(len(lines))}) <= 1:
        return lines

    # Every vertex, tagged with its owning stroke, for nearest-point linking.
    pts: list[Point] = []
    owner: list[tuple[int, int]] = []
    for i, line in enumerate(lines):
        for j, p in enumerate(line):
            pts.append(p)
            owner.append((i, j))
    coords = np.asarray(pts, dtype=float)
    tree = cKDTree(coords)
    k = min(len(pts), 8)
    dists, idxs = tree.query(coords, k=k)
    if k == 1:  # degenerate
        idxs = idxs.reshape(-1, 1)
        dists = dists.reshape(-1, 1)

    candidates: list[tuple[float, int, int]] = []
    for a in range(len(pts)):
        ra = uf.find(owner[a][0])
        for d, b in zip(dists[a][1:], idxs[a][1:], strict=False):
            if uf.find(owner[int(b)][0]) != ra:
                candidates.append((float(d), a, int(b)))
    candidates.sort(key=lambda t: t[0])

    splits: dict[int, set[int]] = {}
    connectors: list[Polyline] = []
    for _, a, b in candidates:
        la, pa = owner[a]
        lb, pb = owner[b]
        if uf.union(la, lb):
            splits.setdefault(la, set()).add(pa)
            splits.setdefault(lb, set()).add(pb)
            connectors.append([pts[a], pts[b]])

    # Close any components the k-NN candidates missed (rare): link via nearest
    # endpoints among the few remaining roots.
    roots = {uf.find(i) for i in range(len(lines))}
    while len(roots) > 1:
        by_root: dict[int, list[int]] = {}
        for i in range(len(lines)):
            by_root.setdefault(uf.find(i), []).append(i)
        root_list = list(by_root)
        base = root_list[0]
        best = None  # (dist, line_a, end_a_point, line_b, end_b_point)
        base_ends = [(i, e) for i in by_root[base] for e in (lines[i][0], lines[i][-1])]
        for other in root_list[1:]:
            for j in by_root[other]:
                for q in (lines[j][0], lines[j][-1]):
                    for i, p in base_ends:
                        d = math.dist(p, q)
                        if best is None or d < best[0]:
                            best = (d, i, p, j, q)
        if best is None:
            break
        _, i, p, j, q = best
        uf.union(i, j)
        connectors.append([p, q])
        roots = {uf.find(x) for x in range(len(lines))}

    if not splits and not connectors:
        return lines

    out: list[Polyline] = []
    for i, line in enumerate(lines):
        cuts = sorted(splits.get(i, ()))
        if not cuts:
            out.append(line)
            continue
        prev = 0
        for c in cuts:
            piece = line[prev:c + 1]
            if len(piece) >= 2:
                out.append(piece)
            prev = c
        tail = line[prev:]
        if len(tail) >= 2:
            out.append(tail)
    out.extend(connectors)
    return out


# ---- projection ------------------------------------------------------------

def _mercator(lon: float, lat: float) -> Point:
    lat = _clamp(lat, -85.05, 85.05)
    return (math.radians(lon), math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)))


def _build_projector(
    data: dict, req: OsmMapRequest
) -> tuple[Projector, float, float, tuple[float, float, float, float]]:
    """Web-Mercator projector that fits the roads into ``req.width × req.height``
    preserving aspect ratio and **centring** them on the page (city-roads style).

    Returns ``(project, page_w, page_h, frame_rect)`` where the page is the full
    requested box and ``frame_rect`` is the centred content rectangle.
    """
    page_w, page_h = req.width, req.height
    full = (0.0, 0.0, page_w, page_h)
    elements = data.get("elements", []) if isinstance(data, dict) else []
    min_x = min_y = math.inf
    max_x = max_y = -math.inf
    if isinstance(elements, list):
        for element in elements:
            if not isinstance(element, dict):
                continue
            geometry = element.get("geometry")
            if not isinstance(geometry, list):
                continue
            for point in geometry:
                if not _has_lat_lon(point):
                    continue
                mx, my = _mercator(float(point["lon"]), float(point["lat"]))
                min_x, max_x = min(min_x, mx), max(max_x, mx)
                min_y, max_y = min(min_y, my), max(max_y, my)

    span_x = max_x - min_x
    span_y = max_y - min_y
    if span_x <= 0 or span_y <= 0:
        return (lambda lon, lat: (page_w / 2, page_h / 2)), page_w, page_h, full

    avail_w = max(1.0, page_w - 2 * MARGIN_MM)
    avail_h = max(1.0, page_h - 2 * MARGIN_MM)
    scale = min(avail_w / span_x, avail_h / span_y)
    content_w = span_x * scale
    content_h = span_y * scale
    off_x = (page_w - content_w) / 2
    off_y = (page_h - content_h) / 2

    def project(lon: float, lat: float) -> Point:
        mx, my = _mercator(lon, lat)
        x = off_x + (mx - min_x) * scale
        y = off_y + (max_y - my) * scale  # flip: north on top
        return (round(x, 4), round(y, 4))

    frame_rect = (
        round(off_x, 4),
        round(off_y, 4),
        round(off_x + content_w, 4),
        round(off_y + content_h, 4),
    )
    return project, page_w, page_h, frame_rect


# ---- detail budget ---------------------------------------------------------

def _fit_detail_budget(lines: list[Polyline], protected_count: int) -> tuple[list[Polyline], bool]:
    """Keep the point count within budget by simplifying harder — never by
    dropping whole strokes, which would re-introduce islands. Connectivity is
    preserved (Douglas-Peucker keeps endpoints)."""
    if sum(len(line) for line in lines) <= MAX_POINTS:
        return lines, False

    protected = lines[:protected_count]
    candidates = lines[protected_count:]
    reduced = candidates
    for tolerance in (2.5, 4.0, 6.0, 8.0, 12.0, 18.0, 26.0):
        reduced = [_simplify(line, tolerance) for line in reduced]
        reduced = [line for line in reduced if len(line) >= 2]
        if _point_count(protected, reduced) <= MAX_POINTS:
            return protected + reduced, True
    return protected + reduced, True


def _point_count(protected: list[Polyline], candidates: list[Polyline]) -> int:
    return sum(len(line) for line in protected) + sum(len(line) for line in candidates)


# ---- geometry helpers ------------------------------------------------------

def _has_lat_lon(value: object) -> bool:
    return (
        isinstance(value, dict)
        and isinstance(value.get("lat"), int | float)
        and isinstance(value.get("lon"), int | float)
    )


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
