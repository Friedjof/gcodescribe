from __future__ import annotations

import networkx as nx

from ..types import MazeGeometry
from .grid import SIDES, build_grid_geometry, grid_dimensions
from .masks import MASK_NAMES, mask_polygon, point_in_polygon

# The mask is evaluated on a square so the shape keeps its aspect ratio even
# when the plot area is not square.
MASK_SCALE = 0.98
MIN_ACTIVE_CELLS = 24


def generate(size: int, width: int, height: int, rng) -> MazeGeometry:
    cols, rows = grid_dimensions(size, width, height)
    mask_name = MASK_NAMES[rng.randrange(len(MASK_NAMES))]
    active = _masked_cells(cols, rows, mask_name)
    if len(active) < MIN_ACTIVE_CELLS:
        mask_name = "circle"
        active = _masked_cells(cols, rows, mask_name)
    return build_grid_geometry(active, width, height, meta={"mask": mask_name})


def _masked_cells(cols: int, rows: int, mask_name: str) -> set[tuple[int, int]]:
    polygon = mask_polygon(mask_name)
    half = min(cols, rows) / 2
    cells = set()
    for r in range(rows):
        for c in range(cols):
            u = (c + 0.5 - cols / 2) / (half * MASK_SCALE)
            v = (r + 0.5 - rows / 2) / (half * MASK_SCALE)
            if point_in_polygon(u, v, polygon):
                cells.add((c, r))
    return _largest_component(cells)


def _largest_component(cells: set[tuple[int, int]]) -> set[tuple[int, int]]:
    graph = nx.Graph()
    graph.add_nodes_from(cells)
    for c, r in cells:
        for dc, dr in SIDES.values():
            if (c + dc, r + dr) in cells:
                graph.add_edge((c, r), (c + dc, r + dr))
    if graph.number_of_nodes() == 0:
        return set()
    return set(max(nx.connected_components(graph), key=len))
