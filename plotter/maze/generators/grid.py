from __future__ import annotations

import networkx as nx

from ..graph import edge_key
from ..types import MazeGeometry, Point, Wall

MARGIN = 1.0

SIDES = {
    "top": (0, -1),
    "right": (1, 0),
    "bottom": (0, 1),
    "left": (-1, 0),
}


def grid_dimensions(size: int, width: int, height: int) -> tuple[int, int]:
    cols = max(6, min(40, size))
    rows = max(6, min(48, round(cols * (height - 2 * MARGIN) / max(width - 2 * MARGIN, 1))))
    return cols, rows


def build_grid_geometry(
    active: set[tuple[int, int]],
    width: int,
    height: int,
    meta: dict[str, object] | None = None,
) -> MazeGeometry:
    """Build the maze model for a set of active square cells.

    The active bounding box is scaled to fill the available area. Walls exist
    between active orthogonal neighbours (passages) and on every active cell
    side facing an inactive cell or the outside (border).
    """
    if not active:
        raise ValueError("Masked maze has no active cells")
    c0 = min(c for c, _ in active)
    c1 = max(c for c, _ in active)
    r0 = min(r for _, r in active)
    r1 = max(r for _, r in active)
    span_c = c1 - c0 + 1
    span_r = r1 - r0 + 1
    cell = min((width - 2 * MARGIN) / span_c, (height - 2 * MARGIN) / span_r)
    x0 = (width - span_c * cell) / 2 - c0 * cell
    y0 = (height - span_r * cell) / 2 - r0 * cell

    def corner(c: int, r: int) -> Point:
        return Point(x0 + c * cell, y0 + r * cell)

    graph = nx.Graph()
    positions: dict[str, Point] = {}
    walls: dict[str, Wall] = {}
    for c, r in sorted(active):
        node = _id(c, r)
        positions[node] = Point(x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell)
        graph.add_node(node)
        for side, (dc, dr) in SIDES.items():
            neighbor = (c + dc, r + dr)
            line = _side_line(c, r, side, corner)
            if neighbor in active:
                other = _id(*neighbor)
                if node < other:
                    graph.add_edge(node, other)
                    walls[edge_key(node, other)] = Wall(edge_key(node, other), line)
            else:
                key = f"outer:{node}:{side}"
                walls[key] = Wall(key, line)

    start = _id(*min(active, key=lambda cr: (cr[1], cr[0])))
    end = _id(*max(active, key=lambda cr: (cr[1], cr[0])))
    return MazeGeometry(
        graph=graph,
        positions=positions,
        walls=walls,
        start=start,
        end=end,
        entry_wall=f"outer:{start}:top",
        exit_wall=f"outer:{end}:bottom",
        marker_radius=cell * 0.22,
        meta={"cell_mm": round(cell, 3), **(meta or {})},
    )


def _id(c: int, r: int) -> str:
    return f"{c}:{r}"


def _side_line(c: int, r: int, side: str, corner) -> list[Point]:
    if side == "top":
        return [corner(c, r), corner(c + 1, r)]
    if side == "bottom":
        return [corner(c, r + 1), corner(c + 1, r + 1)]
    if side == "left":
        return [corner(c, r), corner(c, r + 1)]
    return [corner(c + 1, r), corner(c + 1, r + 1)]
