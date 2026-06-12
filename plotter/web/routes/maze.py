from __future__ import annotations

from fastapi import APIRouter, Query

from ...calibration import Calibration
from ...maze.generate import generate_maze, point_to_json
from ...maze.types import MazeType

router = APIRouter(tags=["maze"])

MIN_SIDE = 60


@router.get("/maze")
def maze(
    type: MazeType = Query("classic"),
    seed: str = Query("demo", min_length=1, max_length=64),
    size: int = Query(20, ge=6, le=40),
    width: int = Query(180, ge=MIN_SIDE, le=2000),
    height: int = Query(180, ge=MIN_SIDE, le=2000),
    difficulty: float = Query(0.85, ge=0.0, le=1.0),
    complexity: float = Query(0.6, ge=0.0, le=1.0),
) -> dict:
    # The maze never exceeds the calibrated plot area, regardless of what the
    # caller asks for.
    cal = Calibration.load()
    width = max(MIN_SIDE, min(width, int(cal.plot_width)))
    height = max(MIN_SIDE, min(height, int(cal.plot_height)))
    result = generate_maze(type, seed, size, width, height, difficulty, complexity)
    return {
        "type": result.type,
        "seed": result.seed,
        "size": result.size,
        "width": result.width,
        "height": result.height,
        "viewBox": result.viewBox,
        "maze_svg": result.maze_svg,
        "solution_svg": result.solution_svg,
        "start": point_to_json(result.start),
        "end": point_to_json(result.end),
        "wall_lines": result.wall_lines,
        "marker_lines": result.marker_lines,
        "solution_lines": result.solution_lines,
        "metadata": result.metadata,
    }
