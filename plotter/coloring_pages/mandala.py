"""Seed-driven mandala engine.

A mandala is composed from a random ring stack: the available radius is
partitioned into rings of varying width and each ring gets a style drawn
from a theme-weighted pool. Complexity controls ring count, radial order
and the amount of nested detail, so the scale runs from chunky toddler
pages to fine adult patterns.
"""

from __future__ import annotations

import math
import random

from .geometry import circle
from .rings import RING_STYLES, THIN_OK, WIDE_PREFERRED, center_medallion
from .types import Polyline

# Weighted style pools per theme; "magic" mixes everything.
MANDALA_THEMES = {
    "flower": {
        "petals": 3.0,
        "pointed": 2.0,
        "scallops": 2.0,
        "buds": 2.0,
        "hearts": 1.0,
        "dots": 1.0,
        "loops": 1.0,
        "fans": 0.5,
        "waves": 0.5,
    },
    "star": {
        "spikes": 3.0,
        "diamonds": 3.0,
        "zigzag": 2.0,
        "cells": 1.0,
        "dots": 1.0,
        "waves": 0.5,
        "fans": 0.5,
    },
    "sun": {
        "spikes": 3.0,
        "scallops": 2.0,
        "waves": 2.0,
        "fans": 1.5,
        "dots": 1.0,
        "cells": 1.0,
        "diamonds": 1.0,
    },
    "nature": {
        "pointed": 3.0,
        "buds": 2.0,
        "loops": 2.0,
        "waves": 1.5,
        "scallops": 1.5,
        "petals": 1.0,
        "fans": 1.0,
        "dots": 0.5,
    },
    "magic": dict.fromkeys(RING_STYLES, 1.0),
}

MANDALA_ORDER_POOLS = {
    "flower": [6, 8, 8, 10, 12],
    "star": [5, 6, 7, 8, 9, 10, 12],
    "sun": [8, 10, 12, 12, 14, 16],
    "nature": [6, 7, 8, 9, 10, 12],
    "magic": [5, 6, 7, 8, 9, 10, 11, 12, 14, 16],
}

MANDALA_MODES = [*MANDALA_THEMES, "butterfly"]


def mandala_lines(
    rng: random.Random,
    mode: str,
    width_mm: float,
    height_mm: float,
    margin_mm: float,
    radius_mm: float | None,
    complexity: float,
    age_group: str,
    radial_order: int | None,
    ring_count: int | None,
    min_gap_mm: float,
    outer_frame: bool,
) -> tuple[list[Polyline], dict]:
    if mode not in MANDALA_MODES:
        raise ValueError(f"Unsupported mandala mode: {mode}")
    complexity = min(1.0, max(0.0, complexity if complexity is not None else 0.4))
    cx, cy = width_mm / 2, height_mm / 2
    radius = radius_mm or max(12.0, min(width_mm, height_mm) / 2 - margin_mm)
    radius = min(radius, width_mm / 2 - margin_mm, height_mm / 2 - margin_mm)

    lines: list[Polyline] = []
    if outer_frame:
        lines.append(circle(cx, cy, radius, 160))

    if mode == "butterfly":
        _butterfly(lines, cx, cy, radius, rng, complexity)
        return lines, {"radius_mm": round(radius, 3), "ring_styles": ["butterfly"]}

    # Feature floor: how small the things to color in may get (mm).
    age_base = {"4-6": 9.0, "6-8": 7.0, "8-10": 5.5}.get(age_group, 7.0)
    feature_min = max(2.8, age_base * (1.2 - 0.85 * complexity))
    min_ring_w = max(3.2, feature_min * 0.8, min_gap_mm * (1.25 - 0.9 * complexity))

    order = radial_order or _pick_order(rng, mode, complexity)
    draw_r = radius * rng.uniform(0.96, 1.0)
    rings = _partition_rings(rng, draw_r, complexity, min_ring_w, ring_count)

    styles = _pick_styles(rng, mode, len(rings) - 1)
    lines.extend(center_medallion(cx, cy, rings[0], rng, complexity))

    used_orders: list[int] = []
    for i, style in enumerate(styles):
        r0, r1 = rings[i], rings[i + 1]
        n = _ring_order(rng, order, style, (r0 + r1) / 2, feature_min)
        used_orders.append(n)
        phase = (i % 2) * 0.5 + rng.choice([0.0, 0.25, -0.25]) * (1 if complexity > 0.3 else 0)
        lines.extend(RING_STYLES[style](cx, cy, r0, r1, n, phase, rng, complexity))
        if rng.random() < 0.55 and style not in {"scallops", "zigzag", "cells", "fans"}:
            lines.append(circle(cx, cy, r1, max(64, n * 8)))

    derived = {
        "radial_order": order,
        "ring_count": len(styles),
        "ring_styles": styles,
        "ring_orders": used_orders,
        "radius_mm": round(radius, 3),
    }
    return lines, derived


def _pick_order(rng: random.Random, mode: str, complexity: float) -> int:
    base = rng.choice(MANDALA_ORDER_POOLS[mode])
    boost = int(round((complexity - 0.4) * 6))
    return max(4, min(24, base + boost))


def _partition_rings(
    rng: random.Random,
    radius: float,
    complexity: float,
    min_ring_w: float,
    ring_count: int | None,
) -> list[float]:
    center_r = radius * rng.uniform(0.1, 0.18)
    usable = radius - center_r
    target = ring_count or max(2, 3 + round(complexity * 5) + rng.choice([-1, 0, 1]))
    count = max(2, min(target, int(usable / min_ring_w)))
    weights = [rng.uniform(0.65, 1.75) for _ in range(count)]
    total = sum(weights)
    bounds = [center_r]
    acc = center_r
    for w in weights:
        acc += usable * w / total
        bounds.append(acc)
    bounds[-1] = radius
    return bounds


def _pick_styles(rng: random.Random, mode: str, count: int) -> list[str]:
    pool = MANDALA_THEMES[mode]
    names = list(pool)
    styles: list[str] = []
    prev = ""
    for _ in range(count):
        weights = [0.0 if name == prev else pool[name] for name in names]
        style = rng.choices(names, weights=weights)[0]
        styles.append(style)
        prev = style
    return styles


def _ring_order(
    rng: random.Random, order: int, style: str, mid_r: float, feature_min: float
) -> int:
    n = order
    if style in THIN_OK and rng.random() < 0.4:
        n = order * 2
    elif style in WIDE_PREFERRED and order >= 12 and order % 2 == 0 and rng.random() < 0.35:
        n = order // 2
    # Keep cells wide enough to color: shrink symmetric (halving keeps alignment).
    while n > 4 and math.tau * mid_r / n < feature_min:
        n = max(4, math.ceil(n / 2))
    return n


def _butterfly(
    lines: list[Polyline],
    cx: float,
    cy: float,
    radius: float,
    rng: random.Random,
    complexity: float,
) -> None:
    # Body with segments and head.
    head_r = radius * 0.06
    lines.append(circle(cx, cy - radius * 0.5, head_r, 20))
    body_w = radius * rng.uniform(0.05, 0.08)
    body_top, body_bottom = cy - radius * 0.44, cy + radius * 0.5
    lines.append(
        [
            (cx, body_top),
            (cx + body_w, cy - radius * 0.1),
            (cx + body_w * 0.7, body_bottom),
            (cx, body_bottom + radius * 0.02),
            (cx - body_w * 0.7, body_bottom),
            (cx - body_w, cy - radius * 0.1),
            (cx, body_top),
        ]
    )
    segments = 3 + int(complexity * 3)
    for s in range(1, segments):
        t = s / segments
        y = body_top + (body_bottom - body_top) * t
        w = body_w * (1 - t * 0.3)
        lines.append([(cx - w, y), (cx + w, y)])
    # Antennae with end dots.
    for side in (-1, 1):
        ax = cx + side * radius * 0.16
        ay = cy - radius * (0.72 + rng.uniform(0.0, 0.06))
        lines.append(
            [
                (cx + side * head_r * 0.5, cy - radius * 0.54),
                (cx + side * radius * 0.08, cy - radius * 0.65),
                (ax, ay),
            ]
        )
        lines.append(circle(ax, ay, radius * 0.018, 10))

    # Wings: random control points, mirrored; nested outlines + spots inside.
    upper = _wing_shape(rng, upper=True)
    lower = _wing_shape(rng, upper=False)
    nests = 1 + int(complexity * 2.5)
    for side in (-1, 1):
        for shape, anchor_y in ((upper, -0.18), (lower, 0.16)):
            for nest in range(nests + 1):
                f = 1 - nest * (0.55 / max(1, nests + 0.4))
                pts = [
                    (
                        cx + side * (radius * (px * f + 0.05)),
                        cy + radius * (anchor_y + (py - anchor_y) * f),
                    )
                    for px, py in shape
                ]
                if pts[0] != pts[-1]:
                    pts.append(pts[0])
                lines.append(pts)
            if complexity > 0.25:
                spots = 1 + int(complexity * 3 * rng.uniform(0.6, 1.0))
                for _ in range(spots):
                    px, py = _wing_inner_point(rng, shape, anchor_y)
                    spot_r = radius * rng.uniform(0.02, 0.05) * (0.6 + complexity)
                    sx = cx + side * radius * (px * 0.62 + 0.05)
                    sy = cy + radius * (anchor_y + (py - anchor_y) * 0.62)
                    lines.append(circle(sx, sy, spot_r, 14))


def _wing_shape(rng: random.Random, upper: bool) -> list[tuple[float, float]]:
    """Wing outline in unit space (x outward from the body, y down). Closed."""
    if upper:
        reach = rng.uniform(0.72, 0.88)
        top = -rng.uniform(0.62, 0.78)
        pts = [
            (0.04, -0.38),
            (rng.uniform(0.3, 0.45), top),
            (reach, top * rng.uniform(0.55, 0.8)),
            (reach * rng.uniform(0.88, 1.0), -0.05),
            (rng.uniform(0.3, 0.5), rng.uniform(0.04, 0.12)),
            (0.04, 0.02),
        ]
    else:
        reach = rng.uniform(0.5, 0.66)
        bottom = rng.uniform(0.55, 0.72)
        pts = [
            (0.04, 0.0),
            (rng.uniform(0.34, 0.48), rng.uniform(0.02, 0.1)),
            (reach, bottom * rng.uniform(0.5, 0.75)),
            (rng.uniform(0.16, 0.3), bottom),
            (0.04, rng.uniform(0.3, 0.42)),
        ]
    return _smooth_closed(pts)


def _smooth_closed(pts: list[tuple[float, float]], rounds: int = 2) -> list[tuple[float, float]]:
    for _ in range(rounds):
        out: list[tuple[float, float]] = []
        m = len(pts)
        for i in range(m):
            x0, y0 = pts[i]
            x1, y1 = pts[(i + 1) % m]
            out.append((x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25))
            out.append((x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75))
        pts = out
    return pts


def _wing_inner_point(
    rng: random.Random, shape: list[tuple[float, float]], anchor_y: float
) -> tuple[float, float]:
    xs = [p[0] for p in shape]
    ys = [p[1] for p in shape]
    return (
        rng.uniform(min(xs) + 0.12, max(xs) * 0.85),
        rng.uniform(min(ys) + (max(ys) - min(ys)) * 0.25, max(ys) - (max(ys) - min(ys)) * 0.25),
    )
