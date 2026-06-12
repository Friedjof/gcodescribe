from __future__ import annotations

import random

from .geometry import circle, leaf, petal, polar, regular_polygon
from .types import Polyline

MANDALA_DEFAULTS = {
    "flower": {"radial_order": 8, "ring_count": 4, "complexity": 0.35},
    "star": {"radial_order": 8, "ring_count": 4, "complexity": 0.45},
    "butterfly": {"radial_order": 2, "ring_count": 3, "complexity": 0.35},
    "sun": {"radial_order": 12, "ring_count": 3, "complexity": 0.25},
    "nature": {"radial_order": 10, "ring_count": 5, "complexity": 0.45},
}


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
    if mode not in MANDALA_DEFAULTS:
        raise ValueError(f"Unsupported mandala mode: {mode}")
    defaults = MANDALA_DEFAULTS[mode]
    order = radial_order or defaults["radial_order"]
    rings = ring_count or defaults["ring_count"]
    complexity = complexity if complexity is not None else defaults["complexity"]
    cx, cy = width_mm / 2, height_mm / 2
    radius = radius_mm or max(12.0, min(width_mm, height_mm) / 2 - margin_mm)
    radius = min(radius, width_mm / 2 - margin_mm, height_mm / 2 - margin_mm)
    gap = max(min_gap_mm, _age_gap(age_group))
    rings = max(2, min(rings, int(radius / gap)))
    lines: list[Polyline] = []
    if outer_frame:
        lines.append(circle(cx, cy, radius, max(72, order * 10)))

    if mode == "butterfly":
        _butterfly(lines, cx, cy, radius, rings, rng)
    else:
        for ring in range(rings):
            inner = max(gap * 0.45, radius * (ring + 0.35) / (rings + 0.65))
            outer = min(radius - gap * 0.24, radius * (ring + 1.0) / (rings + 0.25))
            width_angle = 3.9 / order * (0.85 + complexity * 0.25)
            offset = (ring % 2) * 0.5 + rng.choice([0.0, 0.125, -0.125]) * min(complexity, 0.6)
            for spoke in range(order):
                angle = (spoke + offset) / order * 6.283185307179586
                if mode == "flower":
                    lines.append(petal(cx, cy, angle, inner, outer, width_angle))
                elif mode == "star":
                    sides = 4 if ring % 2 else 3
                    lines.append(regular_polygon(*polar(cx, cy, (inner + outer) / 2, angle), (outer - inner) * 0.42, sides, angle))
                elif mode == "sun":
                    lines.append(leaf(cx, cy, angle, inner, outer, width_angle * 0.6))
                else:
                    lines.append(leaf(cx, cy, angle, inner, outer, width_angle * 0.55))
        if mode in {"flower", "nature"} and rings >= 3:
            lines.append(circle(cx, cy, gap * 0.65, max(32, order * 4)))
        if mode == "sun":
            lines.append(circle(cx, cy, radius * 0.28, max(48, order * 4)))

    return lines, {"radial_order": order, "ring_count": rings, "radius_mm": round(radius, 3)}


def _butterfly(lines: list[Polyline], cx: float, cy: float, radius: float, rings: int, rng: random.Random) -> None:
    lines.append(circle(cx, cy, radius * 0.07, 24))
    body_w = radius * 0.09
    lines.append([(cx, cy - radius * 0.52), (cx + body_w, cy), (cx, cy + radius * 0.45), (cx - body_w, cy), (cx, cy - radius * 0.52)])
    for side in (-1, 1):
        for ring in range(rings):
            scale = (ring + 1) / rings
            top = cy - radius * (0.46 - ring * 0.035)
            bottom = cy + radius * (0.35 - ring * 0.02)
            outer = cx + side * radius * (0.34 + 0.42 * scale)
            inner = cx + side * radius * (0.08 + 0.04 * ring)
            waist = cy + rng.uniform(-0.025, 0.025) * radius
            lines.append([(inner, cy - radius * 0.08), (outer, top), (outer * 0.95 + cx * 0.05, waist), (outer, bottom), (inner, cy + radius * 0.08), (inner, cy - radius * 0.08)])


def _age_gap(age_group: str) -> float:
    if age_group == "4-6":
        return 8.0
    if age_group == "8-10":
        return 5.0
    return 6.0
