from __future__ import annotations

from .generators import classic, hex, masked, polar
from .geometry import circle_polyline, polyline_midpoint
from .graph import edge_key, growing_tree, validate_maze
from .render_svg import closed_walls, render_maze_svg, render_solution_svg
from .rng import create_rng
from .types import MazeGeometry, MazeResult, MazeType, Point

GENERATORS = {
    "classic": classic.generate,
    "masked": masked.generate,
    "hex": hex.generate,
    "polar": polar.generate,
}

# Several spanning trees are carved per request; ``difficulty`` selects by
# solution length among them.
CANDIDATE_COUNT = 4


def generate_maze(
    maze_type: MazeType,
    seed: str,
    size: int,
    width: int,
    height: int,
    difficulty: float = 0.85,
    complexity: float = 0.6,
) -> MazeResult:
    rng = create_rng(seed, maze_type, size)
    geometry = GENERATORS[maze_type](size, width, height, rng)
    maze_graph, solution_nodes = _pick_candidate(
        geometry, seed, maze_type, size, difficulty, complexity
    )

    opened = {geometry.entry_wall, geometry.exit_wall} - {None}
    remaining = {key: wall for key, wall in geometry.walls.items() if key not in opened}
    walls = closed_walls(remaining, list(maze_graph.edges))
    solution_points = _solution_points(geometry, solution_nodes)
    markers = [
        circle_polyline(geometry.positions[geometry.start], geometry.marker_radius),
        circle_polyline(geometry.positions[geometry.end], geometry.marker_radius),
    ]

    return MazeResult(
        type=maze_type,
        seed=seed,
        size=size,
        width=width,
        height=height,
        viewBox=f"0 0 {width} {height}",
        maze_svg=render_maze_svg(width, height, walls, markers),
        solution_svg=render_solution_svg(width, height, solution_points),
        start=geometry.positions[geometry.start],
        end=geometry.positions[geometry.end],
        wall_lines=[[[p.x, p.y] for p in wall.points] for wall in walls],
        marker_lines=[[[p.x, p.y] for p in marker] for marker in markers],
        solution_lines=[[[p.x, p.y] for p in solution_points]],
        metadata={
            "maze_type": maze_type,
            "algorithm": "growing_tree",
            "seed": seed,
            "difficulty": difficulty,
            "complexity": complexity,
            "unique_solution": True,
            "cells": geometry.graph.number_of_nodes(),
            "solution_length": len(solution_nodes),
            **geometry.meta,
        },
    )


def point_to_json(point: Point) -> dict[str, float]:
    return {"x": point.x, "y": point.y}


def _pick_candidate(
    geometry: MazeGeometry,
    seed: str,
    maze_type: str,
    size: int,
    difficulty: float,
    complexity: float,
) -> tuple[object, list[str]]:
    backtrack = 0.35 + max(0.0, min(1.0, complexity)) * 0.6
    candidates = []
    for index in range(CANDIDATE_COUNT):
        tree = growing_tree(geometry.graph, create_rng(seed, maze_type, size, index), backtrack)
        solution = validate_maze(geometry.graph, tree, geometry.start, geometry.end)
        candidates.append((len(solution), index, tree, solution))
    candidates.sort(key=lambda item: (item[0], item[1]))
    pick = candidates[round(max(0.0, min(1.0, difficulty)) * (len(candidates) - 1))]
    return pick[2], pick[3]


def _solution_points(geometry: MazeGeometry, nodes: list[str]) -> list[Point]:
    """Path from entry to exit, threaded through the passage openings.

    Every step goes cell center -> opening midpoint -> next cell center, so
    the line provably crosses cell boundaries only where a wall was removed.
    """
    points: list[Point] = []
    if geometry.entry_wall:
        points.append(polyline_midpoint(geometry.walls[geometry.entry_wall].points))
    points.append(geometry.positions[nodes[0]])
    for a, b in zip(nodes, nodes[1:], strict=False):
        points.append(polyline_midpoint(geometry.walls[edge_key(a, b)].points))
        points.append(geometry.positions[b])
    if geometry.exit_wall:
        points.append(polyline_midpoint(geometry.walls[geometry.exit_wall].points))
    return points
