from __future__ import annotations

import math

from .types import Point


def polyline_midpoint(points: list[Point]) -> Point:
    """Point at half the arc length of a polyline (e.g. a passage opening)."""
    if len(points) == 1:
        return points[0]
    lengths = [math.hypot(b.x - a.x, b.y - a.y) for a, b in zip(points, points[1:], strict=False)]
    target = sum(lengths) / 2
    for (a, b), length in zip(zip(points, points[1:], strict=False), lengths, strict=False):
        if target <= length or length == lengths[-1]:
            if length == 0:
                return a
            f = min(target / length, 1.0)
            return Point(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f)
        target -= length
    return points[-1]


def circle_polyline(center: Point, radius: float, segments: int = 16) -> list[Point]:
    return [
        Point(
            center.x + math.cos(i / segments * math.tau) * radius,
            center.y + math.sin(i / segments * math.tau) * radius,
        )
        for i in range(segments + 1)
    ]
