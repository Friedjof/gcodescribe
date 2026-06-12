from __future__ import annotations

import random

from .geometry import circle, diamond, leaf, petal, polar, regular_polygon
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
    order = radial_order or _complex_order(defaults["radial_order"], complexity, mode)
    rings = ring_count or _complex_rings(defaults["ring_count"], complexity, mode)
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
        _butterfly(lines, cx, cy, radius, rings, rng, complexity)
    else:
        palette = _motif_palette(mode, rng, complexity)
        for ring in range(rings):
            inner = max(gap * 0.45, radius * (ring + 0.35) / (rings + 0.65))
            outer = min(radius - gap * 0.24, radius * (ring + 1.0) / (rings + 0.25))
            width_angle = 3.9 / order * (0.85 + complexity * 0.25)
            offset = (ring % 2) * 0.5 + rng.choice([0.0, 0.125, -0.125]) * min(complexity, 0.6)
            motif = palette[ring % len(palette)]
            for spoke in range(order):
                angle = (spoke + offset) / order * 6.283185307179586
                if motif == "petal":
                    lines.append(petal(cx, cy, angle, inner, outer, width_angle))
                elif motif == "star":
                    sides = rng.choice([3, 4, 5]) if complexity > 0.45 else (4 if ring % 2 else 3)
                    lines.append(regular_polygon(*polar(cx, cy, (inner + outer) / 2, angle), (outer - inner) * 0.42, sides, angle))
                elif motif == "diamond":
                    lines.append(diamond(cx, cy, angle, inner, outer, width_angle * 0.5))
                else:
                    lines.append(leaf(cx, cy, angle, inner, outer, width_angle * rng.uniform(0.45, 0.75)))
                if complexity > 0.45 and rng.random() < complexity * 0.38:
                    sub_r = (outer - inner) * rng.uniform(0.12, 0.22)
                    sx, sy = polar(cx, cy, (inner + outer) / 2, angle)
                    lines.append(circle(sx, sy, sub_r, 18))
                if complexity > 0.65 and rng.random() < complexity * 0.25:
                    lines.append(diamond(cx, cy, angle + width_angle * 0.45, inner * 0.92, outer * 0.92, width_angle * 0.22))
        if mode in {"flower", "nature"} and rings >= 3:
            lines.append(circle(cx, cy, gap * 0.65, max(32, order * 4)))
        if mode == "sun":
            lines.append(circle(cx, cy, radius * 0.28, max(48, order * 4)))

    return lines, {"radial_order": order, "ring_count": rings, "radius_mm": round(radius, 3)}


def _motif_palette(mode: str, rng: random.Random, complexity: float) -> list[str]:
    base = {
        "flower": ["petal", "leaf", "petal"],
        "star": ["star", "diamond", "star"],
        "sun": ["leaf", "diamond"],
        "nature": ["leaf", "petal", "diamond", "leaf"],
    }[mode]
    extra = rng.sample(["petal", "star", "diamond", "leaf"], k=2 if complexity > 0.55 else 1)
    palette = [*base, *extra]
    rng.shuffle(palette)
    return palette


def _butterfly(lines: list[Polyline], cx: float, cy: float, radius: float, rings: int, rng: random.Random, complexity: float) -> None:
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
            if complexity > 0.35:
                spot_r = radius * rng.uniform(0.025, 0.055) * (0.7 + complexity)
                lines.append(circle((inner + outer) / 2, (top + waist) / 2, spot_r, 18))


def _age_gap(age_group: str) -> float:
    if age_group == "4-6":
        return 8.0
    if age_group == "8-10":
        return 5.0
    return 6.0


def _complex_order(default: int, complexity: float, mode: str) -> int:
    if mode == "butterfly":
        return 2
    return max(4, default + int(round((complexity - 0.4) * 6)))


def _complex_rings(default: int, complexity: float, mode: str) -> int:
    if mode == "sun":
        return max(2, default + int(round((complexity - 0.4) * 2)))
    return max(2, default + int(round((complexity - 0.4) * 4)))
