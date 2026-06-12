from __future__ import annotations

import math

import networkx as nx

from ..graph import edge_key
from ..types import MazeGeometry, Point, Wall

MARGIN = 1.0

# Pointy-top hexagons, axial coordinates, y down, r increasing downwards.
# Corner i sits at angle 60°*i - 30°; side i connects corners i and i+1, so
# side 0 is the east edge and the directions follow clockwise from there.
DIRS = [(1, 0), (0, 1), (-1, 1), (-1, 0), (0, -1), (1, -1)]


def generate(size: int, width: int, height: int, rng) -> MazeGeometry:
    cols = max(5, min(30, round(size * 0.8)))
    inner_w = width - 2 * MARGIN
    inner_h = height - 2 * MARGIN
    radius = inner_w / (math.sqrt(3) * (cols + 0.5))
    rows = max(5, min(40, math.floor((inner_h / radius - 0.5) / 1.5)))

    cells: dict[str, tuple[int, int]] = {}
    for r in range(rows):
        for c in range(cols):
            q = c - (r // 2)
            cells[_id(q, r)] = (q, r)

    centers = {node: _center(q, r, radius) for node, (q, r) in cells.items()}
    corners = {node: _corners(center, radius) for node, center in centers.items()}
    min_x = min(p.x for poly in corners.values() for p in poly)
    max_x = max(p.x for poly in corners.values() for p in poly)
    min_y = min(p.y for poly in corners.values() for p in poly)
    max_y = max(p.y for poly in corners.values() for p in poly)
    ox = (width - (max_x - min_x)) / 2 - min_x
    oy = (height - (max_y - min_y)) / 2 - min_y

    graph = nx.Graph()
    positions: dict[str, Point] = {}
    walls: dict[str, Wall] = {}
    outer_walls: dict[str, list[str]] = {}
    for node, (q, r) in cells.items():
        positions[node] = Point(centers[node].x + ox, centers[node].y + oy)
        shifted = [Point(p.x + ox, p.y + oy) for p in corners[node]]
        graph.add_node(node)
        for side, (dq, dr) in enumerate(DIRS):
            neighbor = _id(q + dq, r + dr)
            line = [shifted[side], shifted[(side + 1) % 6]]
            if neighbor in cells:
                if node < neighbor:
                    graph.add_edge(node, neighbor)
                    walls[edge_key(node, neighbor)] = Wall(edge_key(node, neighbor), line)
            else:
                key = f"outer:{node}:{side}"
                walls[key] = Wall(key, line)
                outer_walls.setdefault(node, []).append(key)

    start = min(positions, key=lambda n: (positions[n].x, positions[n].y))
    end = max(positions, key=lambda n: (positions[n].x, positions[n].y))
    entry_wall = min(outer_walls[start], key=lambda k: _wall_mid_x(walls[k]))
    exit_wall = max(outer_walls[end], key=lambda k: _wall_mid_x(walls[k]))
    return MazeGeometry(
        graph=graph,
        positions=positions,
        walls=walls,
        start=start,
        end=end,
        entry_wall=entry_wall,
        exit_wall=exit_wall,
        marker_radius=radius * 0.4,
        meta={"cols": cols, "rows": rows, "cell_radius_mm": round(radius, 3)},
    )


def _id(q: int, r: int) -> str:
    return f"{q}:{r}"


def _center(q: int, r: int, radius: float) -> Point:
    return Point(radius * math.sqrt(3) * (q + r / 2), radius * 1.5 * r)


def _corners(center: Point, radius: float) -> list[Point]:
    return [
        Point(
            center.x + radius * math.cos(math.radians(60 * i - 30)),
            center.y + radius * math.sin(math.radians(60 * i - 30)),
        )
        for i in range(6)
    ]


def _wall_mid_x(wall: Wall) -> float:
    return sum(p.x for p in wall.points) / len(wall.points)
