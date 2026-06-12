from __future__ import annotations

import math

MASK_NAMES = ["circle", "heart", "star", "diamond"]


def mask_polygon(name: str) -> list[tuple[float, float]]:
    """Outline of a mask shape in normalized coordinates ([-1, 1], y down)."""
    if name == "circle":
        return [(math.cos(i / 36 * math.tau), math.sin(i / 36 * math.tau)) for i in range(36)]
    if name == "heart":
        points = []
        for i in range(72):
            t = i / 72 * math.tau
            x = 16 * math.sin(t) ** 3
            y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
            points.append((x / 17, -y / 17))
        return points
    if name == "star":
        points = []
        for i in range(10):
            angle = -math.pi / 2 + i * math.pi / 5
            radius = 1.0 if i % 2 == 0 else 0.47
            points.append((math.cos(angle) * radius, math.sin(angle) * radius))
        return points
    if name == "diamond":
        return [(0.0, -1.0), (1.0, 0.0), (0.0, 1.0), (-1.0, 0.0)]
    raise ValueError(f"Unknown mask: {name}")


def point_in_polygon(x: float, y: float, polygon: list[tuple[float, float]]) -> bool:
    inside = False
    j = len(polygon) - 1
    for i, (xi, yi) in enumerate(polygon):
        xj, yj = polygon[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside
