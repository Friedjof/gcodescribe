"""Obstacle-aware travel routing for pen-up G-code moves.

Implements a visibility-graph + Dijkstra planner that routes around rectangular
no-go zones (e.g. paper clamps).  All coordinates are in printer/bed mm.
"""
from __future__ import annotations

import heapq
import math

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


def route_travel(start: Point, end: Point, obstacles: list[dict]) -> list[Point]:
    """Return waypoints (excluding start, including end) for a pen-up travel move.

    Routes around all obstacle rectangles using a visibility graph + Dijkstra.
    Falls back to the direct path when no obstacles are configured or the direct
    path is already clear.
    """
    if not obstacles:
        return [end]

    margin = OBSTACLE_MARGIN

    def blocked(a: Point, b: Point) -> bool:
        return any(seg_intersects_obs(a, b, obs, margin) for obs in obstacles)

    if not blocked(start, end):
        return [end]

    # Build visibility-graph nodes: start, end, and the 4 inflated corners of
    # every obstacle.  Corners that lie inside another (inflated) obstacle are
    # included anyway — Dijkstra simply won't find a clear edge through them.
    nodes: list[Point] = [start, end]
    c = margin + _CORNER_EXTRA  # corner clearance > margin so nodes lie strictly
    for obs in obstacles:       # outside the inflated boundary checked by blocked()
        x, y, w, h = obs["x"], obs["y"], obs["w"], obs["h"]
        nodes += [
            (x - c, y - c),
            (x + w + c, y - c),
            (x + w + c, y + h + c),
            (x - c, y + h + c),
        ]

    n = len(nodes)
    dist_arr = [math.inf] * n
    dist_arr[0] = 0.0
    prev_arr = [-1] * n
    heap: list[tuple[float, int]] = [(0.0, 0)]

    while heap:
        cost, u = heapq.heappop(heap)
        if cost > dist_arr[u] + 1e-9:
            continue
        if u == 1:
            break
        for v in range(n):
            if u == v:
                continue
            if not blocked(nodes[u], nodes[v]):
                nd = cost + math.hypot(
                    nodes[v][0] - nodes[u][0], nodes[v][1] - nodes[u][1]
                )
                if nd < dist_arr[v]:
                    dist_arr[v] = nd
                    prev_arr[v] = u
                    heapq.heappush(heap, (nd, v))

    if math.isinf(dist_arr[1]):
        # No safe path found (e.g. start/end both inside obstacles).
        # Fall back to direct path so the safety checker can flag it.
        return [end]

    path: list[Point] = []
    cur = 1
    while cur != 0:
        path.append(nodes[cur])
        cur = prev_arr[cur]
    path.reverse()
    return path
