from __future__ import annotations

import networkx as nx
import pytest

from plotter.maze.generate import GENERATORS, generate_maze
from plotter.maze.graph import growing_tree, validate_maze
from plotter.maze.rng import create_rng

MAZE_TYPES = ["classic", "masked", "hex", "polar"]


@pytest.mark.parametrize("maze_type", MAZE_TYPES)
def test_maze_is_deterministic(maze_type):
    a = generate_maze(maze_type, "demo", 18, 192, 158)
    b = generate_maze(maze_type, "demo", 18, 192, 158)
    c = generate_maze(maze_type, "other", 18, 192, 158)

    assert a.maze_svg == b.maze_svg
    assert a.solution_svg == b.solution_svg
    assert a.wall_lines == b.wall_lines
    assert a.maze_svg != c.maze_svg


@pytest.mark.parametrize("maze_type", MAZE_TYPES)
def test_maze_svgs_share_viewbox(maze_type):
    result = generate_maze(maze_type, "demo", 18, 192, 158)

    assert result.viewBox == "0 0 192 158"
    assert 'viewBox="0 0 192 158"' in result.maze_svg
    assert 'viewBox="0 0 192 158"' in result.solution_svg
    assert len(result.wall_lines) > 8
    assert len(result.solution_lines[0]) > 2
    assert result.metadata["unique_solution"] is True
    assert result.metadata["solution_length"] >= 2


@pytest.mark.parametrize("maze_type", MAZE_TYPES)
def test_maze_is_perfect_spanning_tree(maze_type):
    geometry = GENERATORS[maze_type](18, 192, 158, create_rng("demo", maze_type, 18))
    tree = growing_tree(geometry.graph, create_rng("demo", maze_type, 18, 0))

    assert nx.is_connected(geometry.graph)
    assert tree.number_of_edges() == tree.number_of_nodes() - 1
    solution = validate_maze(geometry.graph, tree, geometry.start, geometry.end)
    assert solution[0] == geometry.start
    assert solution[-1] == geometry.end


@pytest.mark.parametrize("maze_type", MAZE_TYPES)
@pytest.mark.parametrize("seed", ["demo", "12345", "summer-2026"])
def test_solution_never_crosses_a_wall(maze_type, seed):
    """The solution polyline must stay clear of every rendered wall segment."""
    result = generate_maze(maze_type, seed, 16, 192, 158)
    wall_segments = [
        (line[i], line[i + 1])
        for line in result.wall_lines
        for i in range(len(line) - 1)
    ]
    solution = result.solution_lines[0]
    for i in range(len(solution) - 1):
        for wall in wall_segments:
            assert not _segments_cross(solution[i], solution[i + 1], *wall), (
                f"solution segment {solution[i]}->{solution[i + 1]} crosses wall {wall}"
            )


@pytest.mark.parametrize("maze_type", MAZE_TYPES)
def test_walls_stay_inside_requested_area(maze_type):
    result = generate_maze(maze_type, "demo", 18, 192, 158)
    xs = [p[0] for line in result.wall_lines for p in line]
    ys = [p[1] for line in result.wall_lines for p in line]
    assert min(xs) >= -0.01 and max(xs) <= 192.01
    assert min(ys) >= -0.01 and max(ys) <= 158.01


def test_masked_maze_reports_mask_and_is_connected():
    geometry = GENERATORS["masked"](18, 192, 158, create_rng("demo", "masked", 18))
    assert nx.is_connected(geometry.graph)
    result = generate_maze("masked", "demo", 18, 192, 158)
    assert result.metadata["mask"] in {"circle", "heart", "star", "diamond"}


def test_route_clamps_to_plot_area(workspace):
    from fastapi.testclient import TestClient

    from plotter.calibration import Calibration
    from plotter.web.app import create_app

    Calibration(plot_width=150.0, plot_height=120.0).save()
    client = TestClient(create_app())
    params = {"type": "classic", "width": 1900, "height": 1900}
    payload = client.get("/api/maze", params=params).json()
    assert payload["width"] == 150
    assert payload["height"] == 120
    assert "metadata" in payload and payload["metadata"]["algorithm"] == "growing_tree"


def _segments_cross(a, b, c, d, eps=1e-9) -> bool:
    """True if segment ab properly crosses segment cd (shared interiors)."""

    def orient(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

    def opposite(u, v):
        return (u > eps and v < -eps) or (u < -eps and v > eps)

    return opposite(orient(a, b, c), orient(a, b, d)) and opposite(orient(c, d, a), orient(c, d, b))
