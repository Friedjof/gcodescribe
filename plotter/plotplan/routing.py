"""Conservative routing for freely reorderable strokes in final machine mm.

Only order, direction and the existing start vertex of a closed stroke change.
The supplied route is always a candidate: a result is adopted only when its
actual obstacle-aware travel, including start/end anchors, is shorter. This
module never merges, simplifies, removes or adds drawing segments.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from functools import lru_cache
from numbers import Real

import numpy as np
from scipy.spatial import cKDTree

from plotter.geometry.routing import (
    OBSTACLE_MARGIN,
    TravelPlanner,
    TravelRoutingError,
    seg_intersects_obs,
)

Point = tuple[float, float]
Stroke = tuple[Point, ...]

_EPS = 1e-9
_TWO_OPT_CHECKS = 20_000
_OBSTACLE_TWO_OPT_CHECKS = 4_000
_TWO_OPT_WINDOW = 32
_SEAM_CANDIDATES = 32
_GREEDY_QUERY_LIMIT = 64


@dataclass(frozen=True)
class RouteResult:
    lines: tuple[Stroke, ...]
    source_indices: tuple[int, ...]
    reversed: tuple[bool, ...]
    seam_offsets: tuple[int, ...]
    baseline_distance_mm: float
    distance_mm: float
    algorithm: str
    diagnostics: tuple[str, ...]
    evaluations: int


@dataclass(frozen=True)
class _Visit:
    source: int
    reverse: bool = False
    seam: int = 0

    def flipped(self) -> _Visit:
        return _Visit(self.source, not self.reverse, self.seam)


def _point(point: Sequence[float]) -> Point:
    if len(point) != 2 or any(
        isinstance(value, bool) or not isinstance(value, Real) or not math.isfinite(value)
        for value in point
    ):
        raise ValueError("Plot route coordinates must be finite XY numbers")
    return (point[0], point[1])


class _Search:
    def __init__(self, lines, start, end, obstacles, bed_bounds):
        self.lines = lines
        self.start = start
        self.end = end
        self.closed = tuple(len(line) > 2 and line[0] == line[-1] for line in lines)
        self.planner = TravelPlanner(obstacles, bed_bounds=bed_bounds)
        self.bed_bounds = bed_bounds
        self.obstacles = tuple({key: float(obs[key]) for key in ("x", "y", "w", "h")}
                               for obs in obstacles)
        if any(not all(math.isfinite(value) for value in obs.values())
               or obs["w"] <= 0 or obs["h"] <= 0 for obs in self.obstacles):
            raise TravelRoutingError("Plot route obstacles must have finite positive dimensions")
        self.has_obstacles = bool(obstacles)
        self.evaluations = 0
        self.diagnostics: set[str] = set()

        # A bounded cache avoids an endpoint-pair matrix on large drawings. The
        # planner itself reuses its obstacle visibility graph.
        self.distance = lru_cache(maxsize=32768)(self._distance)

    def _distance(self, a: Point, b: Point) -> float:
        self.evaluations += 1
        try:
            if self.has_obstacles and self.bed_bounds is None:
                # TravelPlanner intentionally keeps a legacy direct fallback
                # without bed bounds. A new optimizer must never score that
                # unsafe fallback as a valid improvement.
                path = (a, *self.planner.route(a, b))
                if any(seg_intersects_obs(p, q, obs, OBSTACLE_MARGIN)
                       for p, q in zip(path, path[1:], strict=False)
                       for obs in self.obstacles):
                    return math.inf
                return math.fsum(math.dist(p, q)
                                 for p, q in zip(path, path[1:], strict=False))
            return self.planner.distance(a, b)
        except TravelRoutingError:
            return math.inf

    def entry(self, visit: _Visit) -> Point:
        line = self.lines[visit.source]
        return line[visit.seam] if self.closed[visit.source] else line[-1 if visit.reverse else 0]

    def exit(self, visit: _Visit) -> Point:
        if self.closed[visit.source]:
            return self.entry(visit)
        return self.lines[visit.source][0 if visit.reverse else -1]

    def cost(self, visits: Sequence[_Visit]) -> float:
        cursor = self.start
        distances = []
        for visit in visits:
            distances.append(self.distance(cursor, self.entry(visit)))
            cursor = self.exit(visit)
        if self.end is not None:
            distances.append(self.distance(cursor, self.end))
        return math.fsum(distances)

    def orient(self, visits: list[_Visit]) -> list[_Visit]:
        """Exact two-state directions for this fixed order and symmetric costs."""
        if not visits:
            return []
        costs = [self.distance(self.start, self.entry(visits[0])),
                 self.distance(self.start, self.exit(visits[0]))]
        parents = []
        for previous, visit in zip(visits, visits[1:], strict=False):
            exits = (self.exit(previous), self.entry(previous))
            next_costs, back = [], []
            for entry in (self.entry(visit), self.exit(visit)):
                values = [costs[state] + self.distance(exits[state], entry)
                          for state in range(2)]
                state = min(range(2), key=values.__getitem__)
                back.append(state)
                next_costs.append(values[state])
            parents.append(back)
            costs = next_costs
        if self.end is not None:
            costs = [costs[0] + self.distance(self.exit(visits[-1]), self.end),
                     costs[1] + self.distance(self.entry(visits[-1]), self.end)]
        state = min(range(2), key=costs.__getitem__)
        states = [state]
        for back in reversed(parents):
            state = back[state]
            states.append(state)
        return [visit.flipped() if state else visit
                for visit, state in zip(visits, reversed(states), strict=True)]

    def greedy(self) -> list[_Visit]:
        """Bounded spatial shortlist, with periodic removal of used endpoints.

        A shortlist is a heuristic, especially around obstacles. It is never
        assumed better than the baseline. Bounded fallback avoids quadratic
        expanding queries when thousands of strokes share the same endpoint.
        """
        n = len(self.lines)
        used = bytearray(n)
        active = list(range(n))
        cursor = self.start
        first_unused = 0
        since_rebuild = 0
        visits = []

        def build():
            indices = [i for i in active if not used[i]]
            points = np.asarray([point for i in indices
                                 for point in (self.lines[i][0], self.lines[i][-1])])
            return indices, cKDTree(points)

        active, tree = build()
        for _ in range(n):
            if since_rebuild >= max(1, len(active) // 2):
                active, tree = build()
                since_rebuild = 0
            count = min(16, len(active) * 2)
            candidates: list[_Visit] = []
            while not candidates:
                _, indices = tree.query(cursor, k=count)
                candidates = [
                    _Visit(active[int(index) // 2], bool(int(index) % 2))
                    for index in np.atleast_1d(indices)
                    if not used[active[int(index) // 2]]
                ]
                if candidates or count >= min(_GREEDY_QUERY_LIMIT, len(active) * 2):
                    break
                count = min(count * 2, _GREEDY_QUERY_LIMIT, len(active) * 2)
            if not candidates:
                while used[first_unused]:
                    first_unused += 1
                candidates = [_Visit(first_unused), _Visit(first_unused, True)]
                self.diagnostics.add("bounded-greedy-fallback")
            chosen = min(candidates, key=lambda visit: (
                self.distance(cursor, self.entry(visit)), visit.source, visit.reverse
            ))
            visits.append(chosen)
            used[chosen.source] = 1
            since_rebuild += 1
            cursor = self.exit(chosen)
        return visits

    def two_opt(self, visits: list[_Visit]) -> list[_Visit]:
        """Bounded deterministic local search, including the end-anchor edge."""
        result = list(visits)
        count = len(result)
        budget = _OBSTACLE_TWO_OPT_CHECKS if self.has_obstacles else _TWO_OPT_CHECKS
        if count < 2:
            return result
        rows = range(count - 1)
        if count > 200:
            # Spread a bounded search across the entire page, not just its
            # first strokes. Include the final pair so the park anchor matters.
            row_limit = max(2, budget // (2 * _TWO_OPT_WINDOW))
            if count - 1 > row_limit:
                rows = [i * (count - 2) // (row_limit - 1) for i in range(row_limit)]
                self.diagnostics.add("bounded-2opt-search")
        checks = 0
        for _ in range(2):
            improved = False
            for i in rows:
                limit = count if count <= 200 else min(count, i + _TWO_OPT_WINDOW + 1)
                for j in range(i + 1, limit):
                    if checks >= budget:
                        self.diagnostics.add("bounded-2opt-search")
                        return result
                    checks += 1
                    previous = self.start if i == 0 else self.exit(result[i - 1])
                    tail = self.end if j == count - 1 else self.entry(result[j + 1])
                    before = self.distance(previous, self.entry(result[i]))
                    after = self.distance(previous, self.exit(result[j]))
                    if tail is not None:
                        before += self.distance(self.exit(result[j]), tail)
                        after += self.distance(self.entry(result[i]), tail)
                    if after + _EPS < before:
                        result[i:j + 1] = [visit.flipped() for visit in reversed(result[i:j + 1])]
                        improved = True
            if not improved:
                break
        return result

    def seams(self, visits: list[_Visit]) -> list[_Visit]:
        """Choose only existing ring vertices; never create an ink connector."""
        result = list(visits)
        for i, visit in enumerate(result):
            if not self.closed[visit.source]:
                continue
            ring = self.lines[visit.source][:-1]
            previous = self.start if i == 0 else self.exit(result[i - 1])
            tail = self.end if i == len(result) - 1 else self.entry(result[i + 1])
            candidates = {visit.seam}
            candidates.update(j * len(ring) // min(len(ring), _SEAM_CANDIDATES)
                              for j in range(min(len(ring), _SEAM_CANDIDATES)))
            candidates.add(min(range(len(ring)), key=lambda j: math.dist(previous, ring[j])))
            if tail is not None:
                candidates.add(min(range(len(ring)), key=lambda j: math.dist(ring[j], tail)))
            if len(ring) > _SEAM_CANDIDATES:
                self.diagnostics.add("bounded-seam-search")

            def cost(j, previous=previous, ring=ring, tail=tail):
                return self.distance(previous, ring[j]) + (
                    0.0 if tail is None else self.distance(ring[j], tail)
                )

            chosen = min(sorted(candidates), key=cost)
            if cost(chosen) + _EPS < cost(visit.seam):
                result[i] = _Visit(visit.source, visit.reverse, chosen)
        return result

    def materialize(self, visit: _Visit) -> Stroke:
        line = self.lines[visit.source]
        if self.closed[visit.source] and visit.seam:
            ring = line[:-1]
            line = ring[visit.seam:] + ring[:visit.seam] + (ring[visit.seam],)
        return line[::-1] if visit.reverse else line


def optimize_routes(
    lines: Sequence[Sequence[Point]],
    *,
    start: Point = (0.0, 0.0),
    end: Point | None = None,
    obstacles: Sequence[dict] = (),
    bed_bounds: tuple[float, float] | None = None,
) -> RouteResult:
    """Return a non-worsening route for unprotected, freely reversible strokes.

    Callers must keep pressure/feed/source-order/pen-direction groups separate.
    Coordinates are final machine millimetres; a non-None ``end`` is either the
    first protected following stroke or the park anchor. Search bounds are
    deterministic, independent of machine load. Unreachable routes fail closed.
    """
    strokes = tuple(tuple(_point(point) for point in line) for line in lines)
    if any(len(line) < 2 for line in strokes):
        raise ValueError("Each plot stroke needs at least two points")
    start = _point(start)
    end = _point(end) if end is not None else None
    search = _Search(strokes, start, end, list(obstacles), bed_bounds)
    best = [_Visit(i) for i in range(len(strokes))]
    baseline = best_cost = search.cost(best)
    algorithm = "baseline"

    def consider(candidate: list[_Visit], name: str) -> None:
        nonlocal best, best_cost, algorithm
        cost = search.cost(candidate)
        if cost + _EPS < best_cost:
            best, best_cost, algorithm = candidate, cost, name

    if strokes:
        consider(search.orient(best), "directions")
        consider(search.orient(search.greedy()), "spatial-greedy+directions")
        for _ in range(2):
            before = best_cost
            consider(search.orient(search.two_opt(best)), algorithm + "+2opt")
            consider(search.orient(search.seams(best)), algorithm + "+seams")
            if best_cost >= before - _EPS:
                break
    if not math.isfinite(best_cost):
        raise TravelRoutingError("No valid plot route connects all strokes and anchors")
    # Routing operates on immutable references. A permutation plus flips/ring
    # rotations constructively preserves every segment including duplicates.
    if sorted(visit.source for visit in best) != list(range(len(strokes))):
        raise AssertionError("Route optimization lost or duplicated a stroke")
    result = RouteResult(
        lines=tuple(search.materialize(visit) for visit in best),
        source_indices=tuple(visit.source for visit in best),
        reversed=tuple(visit.reverse for visit in best),
        seam_offsets=tuple(visit.seam for visit in best),
        baseline_distance_mm=baseline,
        distance_mm=best_cost,
        algorithm=algorithm,
        diagnostics=tuple(sorted(search.diagnostics)),
        evaluations=search.evaluations,
    )
    # The per-instance lru wrapper holds a bound method. Break that reference
    # cycle so large source tuples/caches are released immediately after a plan.
    search.distance.cache_clear()
    del search.distance
    return result
