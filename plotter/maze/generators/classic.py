from __future__ import annotations

from ..types import MazeGeometry
from .grid import build_grid_geometry, grid_dimensions


def generate(size: int, width: int, height: int, rng) -> MazeGeometry:
    cols, rows = grid_dimensions(size, width, height)
    active = {(c, r) for r in range(rows) for c in range(cols)}
    geometry = build_grid_geometry(active, width, height, meta={"cols": cols, "rows": rows})
    return geometry
