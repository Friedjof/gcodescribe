from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

MazeType = Literal["classic", "masked", "hex", "polar"]


@dataclass(frozen=True)
class Point:
    x: float
    y: float


@dataclass(frozen=True)
class Wall:
    key: str
    points: list[Point]


@dataclass(frozen=True)
class MazeGeometry:
    """Type-neutral maze layout produced by a generator.

    ``graph`` holds every possible passage between cells; the maze itself is a
    spanning tree of it. ``walls`` maps passage walls (keyed by ``edge_key``)
    and border walls (unique keys) to their geometry, so both the closed-wall
    rendering and the solution path are derived from the same model.
    """

    graph: object
    positions: dict[str, Point]
    walls: dict[str, Wall]
    start: str
    end: str
    entry_wall: str | None
    exit_wall: str | None
    marker_radius: float
    meta: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class MazeResult:
    type: MazeType
    seed: str
    size: int
    width: int
    height: int
    viewBox: str
    maze_svg: str
    solution_svg: str
    start: Point
    end: Point
    wall_lines: list[list[list[float]]]
    marker_lines: list[list[list[float]]]
    solution_lines: list[list[list[float]]]
    metadata: dict[str, object]
