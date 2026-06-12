from __future__ import annotations

from html import escape

from .graph import edge_key
from .types import Point, Wall

# Matches the frontend game preview style: walls in --busy purple, the
# solution overlay in the translucent red used for sudoku solutions.
WALL_COLOR = "#bf5af2"
SOLUTION_COLOR = "#ff5050"


def stroke_width(width: int, height: int) -> float:
    return max(max(width, height) * 0.004, 0.45)


def svg_document(width: int, height: int, content: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="{width}mm" height="{height}mm">{content}</svg>'
    )


def path_d(points: list[Point]) -> str:
    if not points:
        return ""
    parts = [f"M {points[0].x:.3f} {points[0].y:.3f}"]
    parts.extend(f"L {p.x:.3f} {p.y:.3f}" for p in points[1:])
    return " ".join(parts)


def render_maze_svg(width: int, height: int, walls: list[Wall], markers: list[list[Point]]) -> str:
    stroke = stroke_width(width, height)
    content = [
        f'<path d="{escape(path_d(line))}" fill="none" stroke="{WALL_COLOR}" '
        f'stroke-width="{stroke:.3f}" stroke-linecap="round" stroke-linejoin="round" />'
        for line in [wall.points for wall in walls] + markers
    ]
    return svg_document(width, height, "".join(content))


def render_solution_svg(width: int, height: int, points: list[Point]) -> str:
    stroke = stroke_width(width, height) * 2.2
    content = (
        f'<path d="{escape(path_d(points))}" fill="none" stroke="{SOLUTION_COLOR}" '
        f'stroke-width="{stroke:.3f}" stroke-linecap="round" stroke-linejoin="round" '
        'opacity="0.85" />'
    )
    return svg_document(width, height, content)


def closed_walls(all_walls: dict[str, Wall], opened_edges: list[tuple[str, str]]) -> list[Wall]:
    opened = {edge_key(a, b) for a, b in opened_edges}
    walls = [wall for key, wall in sorted(all_walls.items()) if key not in opened]
    if len({wall.key for wall in walls}) != len(walls):
        raise ValueError("Duplicate walls")
    return walls
