from __future__ import annotations

import math
from collections import Counter
from collections.abc import Callable
from functools import lru_cache
from threading import Lock

from plotter.geometry.linemerge import merge_polylines
from plotter.geometry.singlepass import dedupe_segments, single_pass_polylines

from .filters import map_selectors
from .overpass import fetch_roads
from .types import BBox, OsmMapRequest, OsmMapResult

Point = tuple[float, float]
Polyline = list[Point]
Projector = Callable[[float, float], Point]
PreparedMap = tuple[list[Polyline], float, float, tuple[float, float, float, float], int]

MAX_POINTS = 1_000_000

# Serialise cache misses: functools.lru_cache alone runs concurrent misses
# twice, including both the expensive OSM download and geometry preparation.
_map_lock = Lock()

# Endpoint snap distance (plotter mm) used to stitch OSM road fragments into
# continuous strokes. OSM splits roads at every junction; merging picks the
# straightest continuation through each junction, so a road becomes one long
# line instead of dozens of stubs — far fewer pen lifts and a much more
# plottable, map-like result.
SNAP_TOLERANCE = 0.001

# Blank margin (mm) kept around the map so it sits centred on the page.
MARGIN_MM = 4.0


def generate_osm_map(
    req: OsmMapRequest, fetcher: Callable[[str], dict] | None = None
) -> OsmMapResult:
    """Generate a map, reusing downloaded and prepared roads across detail changes."""
    req.bbox.validate(check_span=req.area_id is None)
    map_selectors(req)
    if not 0 <= req.min_length_mm <= 10:
        raise ValueError("Minimum line length must be between 0 and 10 mm.")
    if fetcher is not None:
        return _render_map(req, _prepare_roads(req, fetcher))
    with _map_lock:
        return _cached_map(req)


@lru_cache(maxsize=2)
def _cached_map(req: OsmMapRequest) -> OsmMapResult:
    return _render_map(req, _cached_roads(
        req.bbox, req.width, req.height, req.area_id, map_selectors(req)
    ))


@lru_cache(maxsize=2)
def _cached_roads(
    bbox: BBox, width: float, height: float, area_id: int | None,
    selectors: tuple[str, ...],
) -> PreparedMap:
    req = OsmMapRequest(bbox, width, height, area_id=area_id)
    return _prepare_roads(req, selectors=selectors)


def _prepare_roads(
    req: OsmMapRequest, fetcher: Callable[[str], dict] | None = None,
    *, selectors: tuple[str, ...] | None = None,
) -> PreparedMap:
    """Load selected line features, project them, and chain matching fragments."""
    data = fetch_roads(req.bbox, req.area_id, fetcher=fetcher,
                       selectors=selectors if selectors is not None else map_selectors(req))
    project, out_w, out_h, frame_rect = _build_projector(data, req)
    osm_lines = _road_lines(data, req, project)
    return osm_lines, out_w, out_h, frame_rect, len(data.get("elements", []))


def _render_map(req: OsmMapRequest, prepared: PreparedMap) -> OsmMapResult:
    osm_lines, out_w, out_h, frame_rect, element_count = prepared
    osm_lines = _simplify_network(osm_lines, _simplify_tolerance(req.detail))
    source_length = _line_length(osm_lines)
    osm_lines = single_pass_polylines(
        osm_lines, tol=SNAP_TOLERANCE, min_length_mm=req.min_length_mm
    )

    lines: list[Polyline] = []
    if req.include_frame:
        fx0, fy0, fx1, fy1 = frame_rect
        lines.append([(fx0, fy0), (fx1, fy0), (fx1, fy1), (fx0, fy1), (fx0, fy0)])
    lines.extend(osm_lines)

    protected_count = 1 if req.include_frame else 0
    lines, detail_reduced = _fit_detail_budget(lines, protected_count)
    point_count = sum(len(line) for line in lines)
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
            "osm_elements": element_count,
            "layers": list(req.layers),
            "road_level": req.road_level,
            "simplify_mm": round(_simplify_tolerance(req.detail), 3),
            "geometry_mm": round(_line_length(lines), 1),
            "filtered_mm": round(max(0.0, source_length - _line_length(osm_lines)), 1),
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
    # Separate rivers / rail lines stay separate: never invent ink connectors.
    merged = merge_polylines(dedupe_segments(ways), tol=SNAP_TOLERANCE)
    lines: list[Polyline] = []
    seen: set[tuple[Point, ...]] = set()
    for line in merged:
        if len(line) < 2:
            continue
        key = tuple(line)
        if key in seen or tuple(reversed(key)) in seen:
            continue
        seen.add(key)
        lines.append(line)
    return lines


# ---- connectivity ----------------------------------------------------------

class _UnionFind:
    def __init__(self, n: int) -> None:
        self.parent = list(range(n))
        self.size = [1] * n

    def find(self, a: int) -> int:
        while self.parent[a] != a:
            self.parent[a] = self.parent[self.parent[a]]
            a = self.parent[a]
        return a

    def union(self, a: int, b: int) -> bool:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        if self.size[ra] > self.size[rb]:
            ra, rb = rb, ra
        self.parent[ra] = rb
        self.size[rb] += self.size[ra]
        return True


def _connect_components(lines: list[Polyline], tol: float) -> list[Polyline]:
    """Join all separate components into ONE connected network.

    Components that share vertices are already one piece; the rest are linked at
    their **nearest points** (the touched stroke is split there) with the
    short connectors, chosen via a KD-tree + Kruskal forest. The result
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
        for point in line:
            key = (round(point[0] * inv), round(point[1] * inv))
            other = seen_node.get(key)
            if other is None:
                seen_node[key] = i
            else:
                uf.union(i, other)

    if len({uf.find(i) for i in range(len(lines))}) <= 1:
        return lines

    # Unique vertices, tagged with their owning stroke, for nearest-point linking.
    pts: list[Point] = []
    owner: list[tuple[int, int]] = []
    seen_points: set[Point] = set()
    for i, line in enumerate(lines):
        for j, p in enumerate(line):
            if p in seen_points:
                continue
            seen_points.add(p)
            pts.append(p)
            owner.append((i, j))
    coords = np.asarray(pts, dtype=float)
    tree = cKDTree(coords)
    k = min(len(pts), 8)
    labels = np.asarray([uf.find(i) for i, _ in owner])
    # Retain only the best link for each component pair. Query in batches so
    # a million-vertex map does not allocate million-by-k distance matrices.
    best_pairs: dict[tuple[int, int], tuple[float, int, int]] = {}
    for start in range(0, len(pts), 4096):
        dists, idxs = tree.query(coords[start:start + 4096], k=k)
        # Most neighbours belong to the main road network. Filter those in
        # NumPy before entering Python rather than iterating millions of pairs.
        rows, cols = np.nonzero(labels[idxs[:, 1:]] != labels[start:start + len(idxs), None])
        for offset, column in zip(rows, cols + 1, strict=True):
            a = start + offset
            ra = int(labels[a])
            b = int(idxs[offset, column])
            d = float(dists[offset, column])
            rb = int(labels[b])
            pair = (min(ra, rb), max(ra, rb))
            previous = best_pairs.get(pair)
            if previous is None or d < previous[0]:
                best_pairs[pair] = (d, int(a), b)
    candidates = sorted(best_pairs.values())

    splits: dict[int, set[int]] = {}
    connectors: list[Polyline] = []
    for _, a, b in candidates:
        la, pa = owner[a]
        lb, pb = owner[b]
        if uf.union(la, lb):
            splits.setdefault(la, set()).add(pa)
            splits.setdefault(lb, set()).add(pb)
            connectors.append([pts[a], pts[b]])

    # Dense islands can hide all other components beyond the first k nearest
    # vertices. Link the remaining islands to the largest network using a
    # second KD-tree, rather than comparing every endpoint pair in Python.
    labels = np.asarray([uf.find(i) for i, _ in owner])
    roots, counts = np.unique(labels, return_counts=True)
    if len(roots) > 1:
        base = roots[counts.argmax()]
        base_idx = np.flatnonzero(labels == base)
        other_idx = np.flatnonzero(labels != base)
        base_tree = cKDTree(coords[base_idx])
        nearest: dict[int, tuple[float, int, int]] = {}
        for start in range(0, len(other_idx), 4096):
            batch = other_idx[start:start + 4096]
            dists, idxs = base_tree.query(coords[batch])
            for a, d, b in zip(batch, dists, idxs, strict=True):
                root = int(labels[a])
                previous = nearest.get(root)
                if previous is None or d < previous[0]:
                    nearest[root] = (float(d), int(a), int(base_idx[b]))
        for _, a, b in sorted(nearest.values()):
            la, pa = owner[a]
            lb, pb = owner[b]
            if uf.union(la, lb):
                splits.setdefault(la, set()).add(pa)
                splits.setdefault(lb, set()).add(pb)
                connectors.append([pts[a], pts[b]])

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
    min_lon = min_lat = math.inf
    max_lon = max_lat = -math.inf
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
                lon, lat = float(point["lon"]), float(point["lat"])
                min_lon, max_lon = min(min_lon, lon), max(max_lon, lon)
                min_lat, max_lat = min(min_lat, lat), max(max_lat, lat)

    if min_lon == math.inf:
        return (lambda lon, lat: (page_w / 2, page_h / 2)), page_w, page_h, full
    # Mercator is monotonic: project the extrema once, not every vertex twice.
    min_x, min_y = _mercator(min_lon, min_lat)
    max_x, max_y = _mercator(max_lon, max_lat)

    span_x = max_x - min_x
    span_y = max_y - min_y
    if span_x <= 0 and span_y <= 0:
        return (lambda lon, lat: (page_w / 2, page_h / 2)), page_w, page_h, full

    avail_w = max(1.0, page_w - 2 * MARGIN_MM)
    avail_h = max(1.0, page_h - 2 * MARGIN_MM)
    scale = min(avail_w / max(span_x, 1e-12), avail_h / max(span_y, 1e-12))
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
    for tolerance in (0.05, 0.1, 0.2, 0.4, 0.8, 1.6, 3.2):
        reduced = _simplify_network(reduced, tolerance)
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
    # At maximum detail retain the original OSM geometry. Low detail still
    # smooths roads, but never removes shared junctions.
    return (1.0 - _clamp(detail, 0.0, 1.0)) ** 2 * 1.5


def _line_length(lines: list[Polyline]) -> float:
    return sum(math.dist(a, b) for line in lines for a, b in zip(line, line[1:], strict=False))


def _simplify_network(lines: list[Polyline], tolerance: float) -> list[Polyline]:
    if tolerance <= 0:
        return lines
    counts = Counter(point for line in lines for point in line)
    out: list[Polyline] = []
    for line in lines:
        simplified: Polyline = []
        start = 0
        # Protect junctions inside merged strokes (including self-crossings).
        for end in range(1, len(line)):
            if end == len(line) - 1 or counts[line[end]] > 1:
                segment = _simplify(line[start:end + 1], tolerance)
                simplified.extend(segment if not simplified else segment[1:])
                start = end
        out.append(simplified)
    return out


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
