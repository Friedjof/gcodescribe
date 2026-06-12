from __future__ import annotations

import math

from .types import Point, Polyline


def closed_polygon(points: list[Point]) -> Polyline:
    if points[0] != points[-1]:
        return [*points, points[0]]
    return points


def circle(cx: float, cy: float, r: float, segments: int = 96) -> Polyline:
    return closed_polygon([
        (cx + math.cos(math.tau * i / segments) * r, cy + math.sin(math.tau * i / segments) * r)
        for i in range(segments)
    ])


def regular_polygon(cx: float, cy: float, r: float, sides: int, rotation: float = 0.0) -> Polyline:
    return closed_polygon([
        (cx + math.cos(rotation + math.tau * i / sides) * r, cy + math.sin(rotation + math.tau * i / sides) * r)
        for i in range(sides)
    ])


def polar(cx: float, cy: float, radius: float, angle: float) -> Point:
    return (cx + math.cos(angle) * radius, cy + math.sin(angle) * radius)


def petal(cx: float, cy: float, angle: float, inner: float, outer: float, width_angle: float, samples: int = 9) -> Polyline:
    pts: list[Point] = [polar(cx, cy, inner, angle - width_angle * 0.45)]
    for i in range(samples):
        t = i / (samples - 1)
        a = angle - width_angle * 0.45 + width_angle * 0.9 * t
        bulge = math.sin(math.pi * t)
        r = inner + (outer - inner) * (0.28 + 0.72 * bulge)
        pts.append(polar(cx, cy, r, a))
    pts.append(polar(cx, cy, inner, angle + width_angle * 0.45))
    return closed_polygon(pts)


def leaf(cx: float, cy: float, angle: float, inner: float, outer: float, width_angle: float) -> Polyline:
    left = polar(cx, cy, (inner + outer) / 2, angle - width_angle)
    tip = polar(cx, cy, outer, angle)
    right = polar(cx, cy, (inner + outer) / 2, angle + width_angle)
    base = polar(cx, cy, inner, angle)
    return closed_polygon([base, left, tip, right])


def rect(x: float, y: float, w: float, h: float) -> Polyline:
    return closed_polygon([(x, y), (x + w, y), (x + w, y + h), (x, y + h)])
