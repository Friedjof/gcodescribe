"""Obstacle-aware travel routing for pen-up G-code moves.

Implements a visibility-graph + Dijkstra planner that routes around rectangular
no-go zones (e.g. paper clamps).  All coordinates are in printer/bed mm.
"""
from __future__ import annotations

import heapq
import math
from collections import OrderedDict
from collections.abc import Sequence

Point = tuple[float, float]

OBSTACLE_MARGIN = 3.0  # mm clearance added around each obstacle when routing
# Corner nodes are placed MARGIN + _CORNER_EXTRA mm from the obstacle so that
# the Liang-Barsky segment check (which counts boundary-touching as "blocked")
# does not falsely block paths from outside to a corner node.
_CORNER_EXTRA = 0.05


def seg_intersects_obs(a: Point, b: Point, obs: dict, margin: float = 0.0) -> bool:
    """True iff segment a→b intersects the (margin-inflated) obstacle rectangle.

    Uses the Liang-Barsky parametric line-clipping algorithm.
    """
    x0, y0 = obs["x"] - margin, obs["y"] - margin
    x1, y1 = obs["x"] + obs["w"] + margin, obs["y"] + obs["h"] + margin
    dx, dy = b[0] - a[0], b[1] - a[1]
    p = (-dx, dx, -dy, dy)
    q = (a[0] - x0, x1 - a[0], a[1] - y0, y1 - a[1])
    t0, t1 = 0.0, 1.0
    for pi, qi in zip(p, q, strict=False):
        if abs(pi) < 1e-9:
            if qi < 0:
                return False  # parallel and outside this boundary
        elif pi < 0:
            t0 = max(t0, qi / pi)
        else:
            t1 = min(t1, qi / pi)
        if t0 > t1:
            return False
    return t0 <= t1


class TravelRoutingError(ValueError):
    """No valid pen-up route exists under the supplied geometry constraints."""


def _finite_pair(value: Sequence[float], message: str) -> Point:
    try:
        if len(value) != 2 or any(isinstance(v, bool) for v in value):
            raise ValueError
        pair = (float(value[0]), float(value[1]))
        if not all(math.isfinite(v) for v in pair):
            raise ValueError
        return pair
    except (TypeError, ValueError, OverflowError, IndexError) as exc:
        raise TravelRoutingError(message) from exc


class TravelPlanner:
    """Reusable rectangular-obstacle planner in machine millimetres.

    Supplying ``bed_bounds`` enables strict planning: every endpoint and waypoint
    stays in the closed bed rectangle and an impossible route raises instead of
    returning an unsafe fallback. The caller still validates serialized G-code.
    Without bounds the historic direct fallback is retained for existing callers.

    The static corner visibility graph is built lazily once. A bounded distance
    cache serves repeated, symmetric route-cost queries during optimization.
    Obstacle coordinates are copied so later profile mutations cannot affect a
    planner that is already working on a captured profile.
    """

    def __init__(
        self, obstacles: Sequence[dict], *, bed_bounds: Point | None = None,
    ) -> None:
        self.bed_bounds = None if bed_bounds is None else _finite_pair(
            bed_bounds, "Die Bettgrenzen für die Leerfahrt sind ungültig.",
        )
        if self.bed_bounds is not None and min(self.bed_bounds) <= 0:
            raise TravelRoutingError("Die Bettgrenzen für die Leerfahrt müssen positiv sein.")
        try:
            self._obstacles = tuple(
                {key: float(obs[key]) for key in ("x", "y", "w", "h")}
                for obs in obstacles
            )
        except (KeyError, TypeError, ValueError, OverflowError) as exc:
            raise TravelRoutingError("Die Hindernisse für die Leerfahrt sind ungültig.") from exc
        if self.bed_bounds is not None and any(
            not all(math.isfinite(v) for v in obs.values()) or obs["w"] <= 0 or obs["h"] <= 0
            for obs in self._obstacles
        ):
            raise TravelRoutingError("Die Hindernisse für die Leerfahrt sind ungültig.")
        self._corners: tuple[Point, ...] | None = None
        self._edges: tuple[tuple[tuple[int, float], ...], ...] = ()
        self._distances: OrderedDict[tuple[Point, Point], float] = OrderedDict()

    def _blocked(self, a: Point, b: Point) -> bool:
        return any(
            seg_intersects_obs(a, b, obs, OBSTACLE_MARGIN) for obs in self._obstacles
        )

    def _within_bed(self, point: Point) -> bool:
        return self.bed_bounds is None or (
            0 <= point[0] <= self.bed_bounds[0] and 0 <= point[1] <= self.bed_bounds[1]
        )

    def _endpoint(self, value: Point) -> Point:
        if self.bed_bounds is None:
            return tuple(value)
        point = _finite_pair(value, "Die Leerfahrt enthält ungültige Koordinaten.")
        if not self._within_bed(point):
            raise TravelRoutingError("Die Leerfahrt beginnt oder endet außerhalb des Betts.")
        if self._blocked(point, point):
            raise TravelRoutingError(
                "Die Leerfahrt beginnt oder endet innerhalb eines Hindernisabstands."
            )
        return point

    def _corner_extra(self) -> float:
        # A fixed 0.05 mm offset can erase a physically clear, narrower corridor.
        # Keep the usual offset, but shrink it below positive separations between
        # inflated rectangle edges (and bed edges). The 3 mm safety margin never
        # changes. Nearly coincident edges may conservatively remain unreachable.
        if self.bed_bounds is None:
            return _CORNER_EXTRA
        extra = _CORNER_EXTRA
        for axis, extent in (("x", "w"), ("y", "h")):
            limit = self.bed_bounds[0 if axis == "x" else 1]
            coordinates = {0.0, limit}
            for obs in self._obstacles:
                coordinates.add(obs[axis] - OBSTACLE_MARGIN)
                coordinates.add(obs[axis] + obs[extent] + OBSTACLE_MARGIN)
            ordered = sorted(coordinates)
            for a, b in zip(ordered, ordered[1:], strict=False):
                if b - a > 1e-9:
                    extra = min(extra, (b - a) / 4)
        return extra

    def _build_graph(self) -> None:
        if self._corners is not None:
            return
        c = OBSTACLE_MARGIN + self._corner_extra()
        candidates = []
        for obs in self._obstacles:
            x, y, w, h = obs["x"], obs["y"], obs["w"], obs["h"]
            candidates.extend(((x - c, y - c), (x + w + c, y - c),
                               (x + w + c, y + h + c), (x - c, y + h + c)))
        corners = []
        seen = set()
        for point in candidates:
            if self.bed_bounds is not None:
                # When only the extra offset crosses the bed edge, its projection
                # can still be a valid node. An inflated obstacle on the boundary
                # is rejected by the clearance check below.
                point = (min(self.bed_bounds[0], max(0.0, point[0])),
                         min(self.bed_bounds[1], max(0.0, point[1])))
            if point in seen or self._blocked(point, point):
                continue
            seen.add(point)
            corners.append(point)
        edges: list[list[tuple[int, float]]] = [[] for _ in corners]
        for i, a in enumerate(corners):
            for j in range(i + 1, len(corners)):
                if not self._blocked(a, corners[j]):
                    distance = math.dist(a, corners[j])
                    edges[i].append((j, distance))
                    edges[j].append((i, distance))
        self._corners = tuple(corners)
        self._edges = tuple(tuple(adjacent) for adjacent in edges)

    def route(self, start: Point, end: Point) -> list[Point]:
        """Waypoints excluding start and including end, without modifying inputs."""
        start, end = self._endpoint(start), self._endpoint(end)
        if not self._obstacles or not self._blocked(start, end):
            return [end]
        self._build_graph()
        nodes = (start, end, *self._corners)
        adjacent: list[list[tuple[int, float]]] = [[], []]
        adjacent.extend([[(j + 2, cost) for j, cost in edges] for edges in self._edges])
        for endpoint in (0, 1):
            for i, corner in enumerate(self._corners, start=2):
                if not self._blocked(nodes[endpoint], corner):
                    distance = math.dist(nodes[endpoint], corner)
                    adjacent[endpoint].append((i, distance))
                    adjacent[i].append((endpoint, distance))
        distances = [math.inf] * len(nodes)
        distances[0] = 0.0
        previous = [-1] * len(nodes)
        queue = [(0.0, 0)]
        while queue:
            cost, node = heapq.heappop(queue)
            if cost > distances[node]:
                continue
            if node == 1:
                break
            for neighbor, distance in adjacent[node]:
                candidate = cost + distance
                if candidate < distances[neighbor]:
                    distances[neighbor] = candidate
                    previous[neighbor] = node
                    heapq.heappush(queue, (candidate, neighbor))
        if math.isinf(distances[1]):
            if self.bed_bounds is None:
                return [end]  # historic fallback; existing final safety check rejects it
            raise TravelRoutingError("Keine freie Leerfahrt innerhalb des Betts gefunden.")
        path = []
        current = 1
        while current != 0:
            path.append(nodes[current])
            current = previous[current]
        return list(reversed(path))

    def distance(self, start: Point, end: Point) -> float:
        """Actual pen-up distance, symmetric and cached for repeated candidates."""
        start, end = self._endpoint(start), self._endpoint(end)
        key = (start, end) if start <= end else (end, start)
        if key in self._distances:
            self._distances.move_to_end(key)
            return self._distances[key]
        path = [start, *self.route(start, end)]
        distance = sum(math.dist(a, b) for a, b in zip(path, path[1:], strict=False))
        self._distances[key] = distance
        if len(self._distances) > 4096:
            self._distances.popitem(last=False)
        return distance


def route_travel(
    start: Point, end: Point, obstacles: list[dict], *, bed_bounds: Point | None = None,
) -> list[Point]:
    """Route one move; reuse ``TravelPlanner`` when planning multiple moves.

    ``bed_bounds=(width, height)`` enables strict routing with no unsafe fallback.
    Omitted bounds retain the legacy behavior for callers not yet migrated.
    """
    return TravelPlanner(obstacles, bed_bounds=bed_bounds).route(start, end)
