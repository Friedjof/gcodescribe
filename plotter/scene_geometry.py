"""Pure geometry helpers for scene polyline processing.

All functions here operate only on plain Python types (tuples/lists/floats)
and have no dependencies outside the standard library.
"""
from __future__ import annotations

import math

Point = tuple[float, float]
Polyline = list[Point]
Polygon = list[Point]
EPS = 1e-9


def transform_point(point: list | tuple, transform: dict) -> Point:
    scale = float(transform.get("scale", 1.0))
    x = float(point[0]) * float(transform.get("scaleX") or scale)
    y = float(point[1]) * float(transform.get("scaleY") or scale)
    rot = float(transform.get("rotation", 0.0))
    cos_r, sin_r = math.cos(rot), math.sin(rot)
    return (
        float(transform.get("x", 0.0)) + x * cos_r - y * sin_r,
        float(transform.get("y", 0.0)) + x * sin_r + y * cos_r,
    )


def is_mask(obj: dict) -> bool:
    return obj.get("type") == "mask-rect" or obj.get("data", {}).get("mask") == "erase"


def mask_polygon(obj: dict) -> Polygon | None:
    transform = obj.get("transform") or {"x": 0, "y": 0, "rotation": 0, "scale": 1}
    raw = next((line for line in obj.get("cachedPolylines") or [] if len(line) >= 4), None)
    if raw is None:
        return None
    pts = [transform_point(point, transform) for point in raw]
    if len(pts) > 1 and math.dist(pts[0], pts[-1]) <= EPS:
        pts = pts[:-1]
    return pts if len(pts) >= 3 else None


def inside_convex(p: Point, poly: Polygon) -> bool:
    signs: list[float] = []
    for i, a in enumerate(poly):
        b = poly[(i + 1) % len(poly)]
        cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
        if abs(cross) > EPS:
            signs.append(cross)
    return bool(signs) and (all(s >= 0 for s in signs) or all(s <= 0 for s in signs))


def _segment_intersection_t(a: Point, b: Point, c: Point, d: Point) -> float | None:
    rx, ry = b[0] - a[0], b[1] - a[1]
    sx, sy = d[0] - c[0], d[1] - c[1]
    den = rx * sy - ry * sx
    if abs(den) <= EPS:
        return None
    qpx, qpy = c[0] - a[0], c[1] - a[1]
    t = (qpx * sy - qpy * sx) / den
    u = (qpx * ry - qpy * rx) / den
    if -EPS <= t <= 1 + EPS and -EPS <= u <= 1 + EPS:
        return max(0.0, min(1.0, t))
    return None


def _lerp(a: Point, b: Point, t: float) -> Point:
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def subtract_polygon_from_segment(a: Point, b: Point, poly: Polygon) -> list[Polyline]:
    ts = {0.0, 1.0}
    for i, c in enumerate(poly):
        d = poly[(i + 1) % len(poly)]
        t = _segment_intersection_t(a, b, c, d)
        if t is not None:
            ts.add(t)
    ordered = sorted(ts)
    out: list[Polyline] = []
    for t0, t1 in zip(ordered, ordered[1:], strict=False):
        if t1 - t0 <= EPS:
            continue
        mid = _lerp(a, b, (t0 + t1) / 2)
        if inside_convex(mid, poly):
            continue
        p0, p1 = _lerp(a, b, t0), _lerp(a, b, t1)
        if math.dist(p0, p1) > EPS:
            out.append([p0, p1])
    return out


def subtract_polygon(line: Polyline, poly: Polygon) -> list[Polyline]:
    pieces: list[Polyline] = []
    current: Polyline = []
    for a, b in zip(line, line[1:], strict=False):
        visible = subtract_polygon_from_segment(a, b, poly)
        for seg in visible:
            if current and math.dist(current[-1], seg[0]) <= EPS:
                current.append(seg[1])
            else:
                if len(current) > 1:
                    pieces.append(current)
                current = seg[:]
        if not visible and len(current) > 1:
            pieces.append(current)
            current = []
    if len(current) > 1:
        pieces.append(current)
    return pieces


def apply_masks(lines: list[Polyline], masks: list[Polygon]) -> list[Polyline]:
    for mask in masks:
        next_lines: list[Polyline] = []
        for line in lines:
            next_lines.extend(subtract_polygon(line, mask))
        lines = next_lines
    return lines
