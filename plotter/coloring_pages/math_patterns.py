"""Full-page coloring patterns.

Every mode draws a different family of patterns; the seed picks a concrete
variant (tile sets, directions, densities) so two pages of the same mode
still look clearly different. Complexity scales cell size and nested detail.
"""

from __future__ import annotations

import math
import random

from .geometry import arc, circle, closed_polygon, polar, rect, regular_polygon
from .types import Point, Polyline

PATTERN_DEFAULTS = {
    "truchet": {"cell_size_mm": 15.0},
    "voronoi": {"cell_size_mm": 19.0},
    "hex_mosaic": {"cell_size_mm": 15.0},
    "wave_field": {"cell_size_mm": 11.0},
    "penrose": {"cell_size_mm": 18.0},
    "scales": {"cell_size_mm": 16.0},
    "stained_glass": {"cell_size_mm": 20.0},
    "bubbles": {"cell_size_mm": 16.0},
    "spiral": {"cell_size_mm": 14.0},
}

PATTERN_MODES = list(PATTERN_DEFAULTS)


def pattern_lines(
    rng: random.Random,
    mode: str,
    width_mm: float,
    height_mm: float,
    margin_mm: float,
    complexity: float,
    age_group: str,
    cell_size_mm: float | None,
    min_gap_mm: float,
    jitter: float,
    density: float,
    outer_frame: bool,
) -> tuple[list[Polyline], dict]:
    if mode not in PATTERN_DEFAULTS:
        raise ValueError(f"Unsupported math pattern mode: {mode}")
    complexity = min(1.0, max(0.0, complexity if complexity is not None else 0.4))
    jitter = 0.25 if jitter is None else jitter
    cell = cell_size_mm or PATTERN_DEFAULTS[mode]["cell_size_mm"]
    age_floor = {"4-6": 16.0, "6-8": 11.0, "8-10": 8.0}.get(age_group, 11.0)
    cell = max(cell * (1.45 - complexity * 0.9), min_gap_mm, age_floor * (1.25 - complexity * 0.6))
    x0, y0 = margin_mm, margin_mm
    w, h = width_mm - margin_mm * 2, height_mm - margin_mm * 2
    lines: list[Polyline] = [rect(x0, y0, w, h)] if outer_frame else []
    draw = {
        "truchet": _truchet,
        "hex_mosaic": _hex,
        "voronoi": _voronoi_like,
        "wave_field": _waves,
        "penrose": _penrose_like,
        "scales": _scales,
        "stained_glass": _stained_glass,
        "bubbles": _bubbles,
        "spiral": _spiral,
    }[mode]
    draw(lines, rng, x0, y0, w, h, cell, complexity, jitter, density)
    return lines, {"cell_size_mm": round(cell, 3)}


def _truchet(
    lines: list[Polyline],
    rng: random.Random,
    x0: float,
    y0: float,
    w: float,
    h: float,
    cell: float,
    complexity: float,
    jitter: float,
    density: float,
) -> None:
    cols, rows = max(1, int(w // cell)), max(1, int(h // cell))
    sx, sy = w / cols, h / rows
    tile_sets = [
        ["arcs", "arcs", "diag"],
        ["arcs", "diamond", "circle"],
        ["diag", "diamond", "circle"],
        ["arcs", "arcs", "diamond", "diag", "circle"],
    ]
    tiles = rng.choice(tile_sets if complexity > 0.45 else tile_sets[:3])
    for row in range(rows):
        for col in range(cols):
            x, y = x0 + col * sx, y0 + row * sy
            lines.append(rect(x, y, sx, sy))
            tile = rng.choice(tiles)
            if tile == "arcs":
                if rng.random() < 0.5:
                    lines.append(_quarter(x, y, sx, sy, 0))
                    lines.append(_quarter(x + sx, y + sy, sx, sy, 2))
                else:
                    lines.append(_quarter(x + sx, y, sx, sy, 1))
                    lines.append(_quarter(x, y + sy, sx, sy, 3))
            elif tile == "diag":
                if rng.random() < 0.5:
                    lines.append([(x, y), (x + sx, y + sy)])
                else:
                    lines.append([(x + sx, y), (x, y + sy)])
            elif tile == "diamond":
                lines.append(
                    closed_polygon(
                        [
                            (x, y + sy / 2),
                            (x + sx / 2, y),
                            (x + sx, y + sy / 2),
                            (x + sx / 2, y + sy),
                        ]
                    )
                )
                if complexity > 0.55 and rng.random() < complexity * 0.6:
                    lines.append(
                        closed_polygon(
                            [
                                (x + sx * 0.25, y + sy / 2),
                                (x + sx / 2, y + sy * 0.25),
                                (x + sx * 0.75, y + sy / 2),
                                (x + sx / 2, y + sy * 0.75),
                            ]
                        )
                    )
            else:
                lines.append(
                    circle(x + sx / 2, y + sy / 2, min(sx, sy) * rng.uniform(0.2, 0.32), 20)
                )


def _quarter(cx: float, cy: float, w: float, h: float, quadrant: int) -> Polyline:
    start = quadrant * math.pi / 2
    return [
        (
            cx + math.cos(start + i * math.pi / 18) * w / 2,
            cy + math.sin(start + i * math.pi / 18) * h / 2,
        )
        for i in range(10)
    ]


def _hex(
    lines: list[Polyline],
    rng: random.Random,
    x0: float,
    y0: float,
    w: float,
    h: float,
    cell: float,
    complexity: float,
    jitter: float,
    density: float,
) -> None:
    r = cell / 2
    dy = r * math.sqrt(3)
    fillings = ["plain", "nested", "flower", "triangle"]
    weights = [3.0, 1.0 + complexity * 2, complexity * 2, complexity * 1.5]
    row = 0
    y = y0 + r
    while y < y0 + h - r * 0.5:
        x = x0 + r + (row % 2) * r * 1.5
        while x < x0 + w - r * 0.5:
            jx = (rng.random() - 0.5) * r * jitter
            jy = (rng.random() - 0.5) * r * jitter
            lines.append(regular_polygon(x + jx, y + jy, r * 0.9, 6, math.pi / 6))
            filling = rng.choices(fillings, weights=weights)[0]
            if filling == "nested":
                lines.append(
                    regular_polygon(x + jx, y + jy, r * rng.uniform(0.45, 0.62), 6, math.pi / 6)
                )
            elif filling == "flower":
                for k in range(6):
                    sx, sy = polar(x + jx, y + jy, r * 0.45, k / 6 * math.tau)
                    lines.append(circle(sx, sy, r * 0.2, 12))
            elif filling == "triangle":
                lines.append(
                    regular_polygon(
                        x + jx, y + jy, r * rng.uniform(0.35, 0.5), 3, rng.uniform(0, math.tau)
                    )
                )
            x += r * 3
        y += dy
        row += 1


def _voronoi_like(
    lines: list[Polyline],
    rng: random.Random,
    x0: float,
    y0: float,
    w: float,
    h: float,
    cell: float,
    complexity: float,
    jitter: float,
    density: float,
) -> None:
    cols, rows = max(2, int(w // cell)), max(2, int(h // cell))
    sx, sy = w / cols, h / rows
    wobble = max(jitter, 0.25) + complexity * 0.3
    for row in range(rows):
        for col in range(cols):
            cx = x0 + (col + 0.5) * sx + (rng.random() - 0.5) * sx * wobble
            cy = y0 + (row + 0.5) * sy + (rng.random() - 0.5) * sy * wobble
            sides = 5 + int(rng.random() * 4)
            rr = min(sx, sy) * (0.36 + density * 0.2)
            pts: list[Point] = []
            for i in range(sides):
                a = math.tau * i / sides + rng.uniform(-0.2, 0.2) * wobble
                radius = rr * rng.uniform(0.8, 1.12)
                pts.append((cx + math.cos(a) * radius, cy + math.sin(a) * radius))
            pts = [(min(x0 + w, max(x0, px)), min(y0 + h, max(y0, py))) for px, py in pts]
            lines.append(closed_polygon(pts))
            if complexity > 0.45 and rng.random() < complexity * 0.55:
                lines.append(
                    circle(
                        min(x0 + w - 2, max(x0 + 2, cx)),
                        min(y0 + h - 2, max(y0 + 2, cy)),
                        rr * rng.uniform(0.18, 0.34),
                        16,
                    )
                )


def _waves(
    lines: list[Polyline],
    rng: random.Random,
    x0: float,
    y0: float,
    w: float,
    h: float,
    cell: float,
    complexity: float,
    jitter: float,
    density: float,
) -> None:
    layout = rng.choice(
        ["horizontal", "horizontal", "vertical", "cross"]
        if complexity > 0.35
        else ["horizontal", "vertical"]
    )
    if layout in {"horizontal", "cross"}:
        _wave_set(lines, rng, x0, y0, w, h, cell, complexity, density, horizontal=True)
    if layout in {"vertical", "cross"}:
        _wave_set(
            lines,
            rng,
            x0,
            y0,
            w,
            h,
            cell,
            complexity,
            density * (0.55 if layout == "cross" else 1.0),
            horizontal=False,
        )


def _wave_set(
    lines: list[Polyline],
    rng: random.Random,
    x0: float,
    y0: float,
    w: float,
    h: float,
    cell: float,
    complexity: float,
    density: float,
    horizontal: bool,
) -> None:
    span, breadth = (h, w) if horizontal else (w, h)
    count = max(4, int(span / cell * (0.65 + density)))
    step = span / count
    freq = 1.2 + complexity * 2.8
    for i in range(count + 1):
        base = i * step
        amp = step * rng.uniform(0.35, 0.45 + complexity * 0.5)
        phase = rng.uniform(0, math.tau)
        f = freq * rng.uniform(0.8, 1.2)
        samples = max(24, int(breadth / 3))
        pts: list[Point] = []
        for s in range(samples + 1):
            t = s / samples
            offset = base + math.sin(t * math.tau * f + phase) * amp
            offset = min(span, max(0.0, offset))
            pts.append(
                (x0 + breadth * t, y0 + offset) if horizontal else (x0 + offset, y0 + breadth * t)
            )
        lines.append(pts)


def _penrose_like(
    lines: list[Polyline],
    rng: random.Random,
    x0: float,
    y0: float,
    w: float,
    h: float,
    cell: float,
    complexity: float,
    jitter: float,
    density: float,
) -> None:
    r = cell * 0.55
    dy = math.sin(math.pi / 5) * r * 2
    rows = int((h - 2 * r) / dy) + 1
    twist = rng.choice([math.pi / 5, math.pi / 7, math.pi / 4])
    for row in range(rows):
        y = y0 + r + row * dy
        cols = int((w - 2 * r) / (r * 1.8)) + 1
        for col in range(cols):
            x = x0 + r + col * r * 1.8 + (row % 2) * r * 0.9
            if x + r > x0 + w or y + r > y0 + h:
                continue
            rot = (row + col) * twist + rng.choice([0, 0.2, -0.2]) * complexity
            lines.append(regular_polygon(x, y, r, 5, rot))
            lines.append(regular_polygon(x, y, r * rng.uniform(0.42, 0.62), 5, rot + math.pi / 5))
            if complexity > 0.55 and rng.random() < 0.4:
                lines.append(regular_polygon(x, y, r * 0.26, rng.choice([3, 4, 5]), rot * 0.5))


def _scales(
    lines: list[Polyline],
    rng: random.Random,
    x0: float,
    y0: float,
    w: float,
    h: float,
    cell: float,
    complexity: float,
    jitter: float,
    density: float,
) -> None:
    cols = max(2, int(round(w / cell)))
    r = w / cols / 2
    row_h = r * rng.uniform(0.55, 0.72)
    echo_p = complexity * 0.75

    def clamped_arc(cx: float, cy: float, rr: float) -> Polyline:
        return [
            (min(x0 + w, max(x0, px)), min(y0 + h, max(y0, py)))
            for px, py in arc(cx, cy, rr, 0.0, math.pi, 18)
        ]

    row = 0
    y = y0 + row_h
    while y <= y0 + h + 1e-6:
        offset = r if row % 2 else 0.0
        cx = x0 + offset - (2 * r if offset else 0.0) + r
        while cx - r < x0 + w:
            lines.append(clamped_arc(cx, y, r))
            if rng.random() < echo_p:
                lines.append(clamped_arc(cx, y, r * rng.uniform(0.5, 0.68)))
            cx += 2 * r
        y += row_h
        row += 1


def _stained_glass(
    lines: list[Polyline],
    rng: random.Random,
    x0: float,
    y0: float,
    w: float,
    h: float,
    cell: float,
    complexity: float,
    jitter: float,
    density: float,
) -> None:
    chords = 4 + round(complexity * 9) + rng.randrange(3)
    for _ in range(chords):
        lines.append(_random_chord(rng, x0, y0, w, h))
    blobs = 1 + round(complexity * 4) + rng.randrange(2)
    for _ in range(blobs):
        rr = min(w, h) * rng.uniform(0.05, 0.13 + complexity * 0.08)
        cx = rng.uniform(x0 + rr + 1, x0 + w - rr - 1)
        cy = rng.uniform(y0 + rr + 1, y0 + h - rr - 1)
        if rng.random() < 0.65:
            lines.append(circle(cx, cy, rr, 36))
            if complexity > 0.5 and rng.random() < complexity:
                lines.append(circle(cx, cy, rr * 0.55, 24))
        else:
            lines.append(
                regular_polygon(cx, cy, rr, rng.choice([3, 4, 5, 6]), rng.uniform(0, math.tau))
            )


def _random_chord(rng: random.Random, x0: float, y0: float, w: float, h: float) -> Polyline:
    edges = rng.sample(["top", "bottom", "left", "right"], 2)
    pts = []
    for edge in edges:
        if edge == "top":
            pts.append((x0 + rng.uniform(0, w), y0))
        elif edge == "bottom":
            pts.append((x0 + rng.uniform(0, w), y0 + h))
        elif edge == "left":
            pts.append((x0, y0 + rng.uniform(0, h)))
        else:
            pts.append((x0 + w, y0 + rng.uniform(0, h)))
    return pts


def _bubbles(
    lines: list[Polyline],
    rng: random.Random,
    x0: float,
    y0: float,
    w: float,
    h: float,
    cell: float,
    complexity: float,
    jitter: float,
    density: float,
) -> None:
    r_max = cell * rng.uniform(0.75, 0.95)
    r_min = max(2.5, cell * 0.16)
    target = int(w * h / (cell * cell) * (2.2 + density * 2))
    placed: list[tuple[float, float, float]] = []
    attempts = 0
    while len(placed) < target and attempts < target * 40:
        attempts += 1
        rr = rng.uniform(r_min, r_max) * rng.uniform(0.55, 1.0)
        bx = rng.uniform(x0 + rr + 0.5, x0 + w - rr - 0.5)
        by = rng.uniform(y0 + rr + 0.5, y0 + h - rr - 0.5)
        if any((bx - px) ** 2 + (by - py) ** 2 < (rr + pr + 0.8) ** 2 for px, py, pr in placed):
            continue
        placed.append((bx, by, rr))
        lines.append(circle(bx, by, rr, max(14, int(rr * 2.2))))
        if rr > r_max * 0.45 and rng.random() < complexity * 0.8:
            lines.append(circle(bx, by, rr * rng.uniform(0.45, 0.62), 16))


def _spiral(
    lines: list[Polyline],
    rng: random.Random,
    x0: float,
    y0: float,
    w: float,
    h: float,
    cell: float,
    complexity: float,
    jitter: float,
    density: float,
) -> None:
    cx, cy = x0 + w / 2, y0 + h / 2
    r_max = math.hypot(w, h) / 2
    turns = 3 + complexity * 5 + rng.uniform(0, 1.5)
    direction = rng.choice([-1, 1])
    a0 = rng.uniform(0, math.tau)
    samples = int(turns * 60)
    pts: list[Point] = []
    for i in range(samples + 1):
        t = i / samples
        r = r_max * t
        a = a0 + direction * turns * math.tau * t
        px, py = polar(cx, cy, r, a)
        if x0 <= px <= x0 + w and y0 <= py <= y0 + h:
            pts.append((px, py))
        elif len(pts) > 1:
            lines.append(pts)
            pts = []
        else:
            pts = []
    if len(pts) > 1:
        lines.append(pts)
    rays = 6 + round(complexity * 8) + rng.randrange(3)
    for k in range(rays):
        a = a0 + k / rays * math.tau
        end = _ray_to_rect(cx, cy, a, x0, y0, w, h)
        start_r = cell * rng.uniform(0.2, 0.7)
        lines.append([polar(cx, cy, start_r, a), end])


def _ray_to_rect(
    cx: float, cy: float, angle: float, x0: float, y0: float, w: float, h: float
) -> Point:
    dx, dy = math.cos(angle), math.sin(angle)
    best = float("inf")
    for bound, d, c in ((x0, dx, cx), (x0 + w, dx, cx)):
        if abs(d) > 1e-9:
            t = (bound - c) / d
            if t > 0:
                best = min(best, t)
    for bound, d, c in ((y0, dy, cy), (y0 + h, dy, cy)):
        if abs(d) > 1e-9:
            t = (bound - c) / d
            if t > 0:
                best = min(best, t)
    best = 0.0 if best == float("inf") else best
    return (min(x0 + w, max(x0, cx + dx * best)), min(y0 + h, max(y0, cy + dy * best)))
