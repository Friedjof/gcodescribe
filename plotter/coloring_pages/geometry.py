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


def diamond(cx: float, cy: float, angle: float, inner: float, outer: float, width: float) -> Polyline:
    mid = (inner + outer) / 2
    return closed_polygon([
        polar(cx, cy, inner, angle),
        polar(cx, cy, mid, angle - width),
        polar(cx, cy, outer, angle),
        polar(cx, cy, mid, angle + width),
    ])


def rect(x: float, y: float, w: float, h: float) -> Polyline:
    return closed_polygon([(x, y), (x + w, y), (x + w, y + h), (x, y + h)])


def arc(cx: float, cy: float, r: float, a0: float, a1: float, segments: int = 16) -> Polyline:
    return [polar(cx, cy, r, a0 + (a1 - a0) * i / segments) for i in range(segments + 1)]


def heart(cx: float, cy: float, angle: float, center_r: float, size: float, samples: int = 28) -> Polyline:
    """Heart placed on the ring at center_r, lobes pointing away from the center."""
    ux, uy = math.cos(angle), math.sin(angle)
    px, py = -uy, ux
    pts: list[Point] = []
    for i in range(samples):
        t = math.tau * i / samples
        hx = 16 * math.sin(t) ** 3 / 17
        hy = (13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)) / 17
        bx = cx + ux * center_r
        by = cy + uy * center_r
        pts.append((bx + ux * hy * size + px * hx * size, by + uy * hy * size + py * hx * size))
    return closed_polygon(pts)


def bud(cx: float, cy: float, angle: float, inner: float, outer: float, half_width: float, samples: int = 14) -> Polyline:
    """Drop/bud shape: round base near inner radius, pointed tip at outer radius."""
    left: list[Point] = []
    right: list[Point] = []
    for i in range(samples + 1):
        t = i / samples
        r = inner + (outer - inner) * t
        hw = half_width * math.sin(math.pi * min(1.0, t * 1.18)) ** 0.75
        a_off = hw / max(r, 1e-6)
        left.append(polar(cx, cy, r, angle - a_off))
        right.append(polar(cx, cy, r, angle + a_off))
    return closed_polygon([*left, *reversed(right)])
