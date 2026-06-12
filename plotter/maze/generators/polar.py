from __future__ import annotations

import math

import networkx as nx

from ..graph import edge_key
from ..types import MazeGeometry, Point, Wall

MARGIN = 1.0
BASE_SEGMENTS = 6
# A ring's segment count doubles once cells get wider than this many ring
# heights, which keeps cell proportions roughly constant towards the outside.
MAX_ARC_RATIO = 1.9


def generate(size: int, width: int, height: int, rng) -> MazeGeometry:
    rings = max(4, min(16, round(size * 0.45)))
    cx = width / 2
    cy = height / 2
    max_r = min(width, height) / 2 - MARGIN
    dr = max_r / rings
    segments = _segment_counts(rings, dr)

    graph = nx.Graph()
    positions: dict[str, Point] = {_id(0, 0): Point(cx, cy)}
    walls: dict[str, Wall] = {}
    graph.add_node(_id(0, 0))

    for ring in range(1, rings):
        segs = segments[ring]
        inner_segs = segments[ring - 1]
        inner_r = ring * dr
        outer_r = (ring + 1) * dr
        for index in range(segs):
            node = _id(ring, index)
            a0 = index / segs * math.tau
            a1 = (index + 1) / segs * math.tau
            mid_r = (inner_r + outer_r) / 2
            mid_a = (a0 + a1) / 2
            positions[node] = Point(cx + math.cos(mid_a) * mid_r, cy + math.sin(mid_a) * mid_r)
            graph.add_node(node)

            right = _id(ring, (index + 1) % segs)
            graph.add_edge(node, right)
            radial = _radial(cx, cy, inner_r, outer_r, a1)
            walls[edge_key(node, right)] = Wall(edge_key(node, right), radial)

            inner = _id(ring - 1, index * inner_segs // segs) if ring > 1 else _id(0, 0)
            graph.add_edge(node, inner)
            arc = _arc(cx, cy, inner_r, a0, a1)
            walls[edge_key(node, inner)] = Wall(edge_key(node, inner), arc)

            if ring == rings - 1:
                key = f"outer:{node}"
                walls[key] = Wall(key, _arc(cx, cy, outer_r, a0, a1))

    start = _id(rings - 1, rng.randrange(segments[rings - 1]))
    return MazeGeometry(
        graph=graph,
        positions=positions,
        walls=walls,
        start=start,
        end=_id(0, 0),
        entry_wall=f"outer:{start}",
        exit_wall=None,
        marker_radius=dr * 0.3,
        meta={"rings": rings, "outer_segments": segments[rings - 1]},
    )


def _segment_counts(rings: int, dr: float) -> list[int]:
    counts = [1, BASE_SEGMENTS]
    for ring in range(2, rings):
        segs = counts[ring - 1]
        arc = math.tau * (ring + 0.5) * dr / segs
        counts.append(segs * 2 if arc > MAX_ARC_RATIO * dr else segs)
    return counts


def _id(ring: int, index: int) -> str:
    return f"{ring}:{index}"


def _radial(cx: float, cy: float, r0: float, r1: float, angle: float) -> list[Point]:
    return [
        Point(cx + math.cos(angle) * r0, cy + math.sin(angle) * r0),
        Point(cx + math.cos(angle) * r1, cy + math.sin(angle) * r1),
    ]


def _arc(cx: float, cy: float, r: float, a0: float, a1: float) -> list[Point]:
    steps = max(3, math.ceil((a1 - a0) / 0.12))
    return [
        Point(
            cx + math.cos(a0 + (a1 - a0) * i / steps) * r,
            cy + math.sin(a0 + (a1 - a0) * i / steps) * r,
        )
        for i in range(steps + 1)
    ]
