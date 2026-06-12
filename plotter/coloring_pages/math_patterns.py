from __future__ import annotations

import math
import random

from .geometry import circle, closed_polygon, rect, regular_polygon
from .types import Point, Polyline

PATTERN_DEFAULTS = {
    "truchet": {"cell_size_mm": 14.0, "complexity": 0.35, "jitter": 0.0},
    "voronoi": {"cell_size_mm": 18.0, "complexity": 0.4, "jitter": 0.3},
    "hex_mosaic": {"cell_size_mm": 14.0, "complexity": 0.35, "jitter": 0.15},
    "wave_field": {"cell_size_mm": 10.0, "complexity": 0.45, "jitter": 0.4},
    "penrose": {"cell_size_mm": 18.0, "complexity": 0.5, "jitter": 0.0},
}


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
    defaults = PATTERN_DEFAULTS[mode]
    cell = cell_size_mm or defaults["cell_size_mm"]
    complexity = complexity if complexity is not None else defaults["complexity"]
    jitter = defaults["jitter"] if jitter is None else jitter
    cell = max(cell, min_gap_mm, _age_cell(age_group))
    x0, y0 = margin_mm, margin_mm
    w, h = width_mm - margin_mm * 2, height_mm - margin_mm * 2
    lines: list[Polyline] = [rect(x0, y0, w, h)] if outer_frame else []
    if mode == "truchet":
        _truchet(lines, rng, x0, y0, w, h, cell)
    elif mode == "hex_mosaic":
        _hex(lines, rng, x0, y0, w, h, cell, jitter)
    elif mode == "voronoi":
        _voronoi_like(lines, rng, x0, y0, w, h, cell, jitter, density)
    elif mode == "wave_field":
        _waves(lines, rng, x0, y0, w, h, cell, complexity, density)
    else:
        _penrose_like(lines, x0, y0, w, h, cell)
    return lines, {"cell_size_mm": round(cell, 3)}


def _truchet(lines: list[Polyline], rng: random.Random, x0: float, y0: float, w: float, h: float, cell: float) -> None:
    cols, rows = max(1, int(w // cell)), max(1, int(h // cell))
    sx, sy = w / cols, h / rows
    for row in range(rows):
        for col in range(cols):
            x, y = x0 + col * sx, y0 + row * sy
            lines.append(rect(x, y, sx, sy))
            if rng.random() < 0.5:
                lines.append(_arc(x, y, sx, sy, 0))
                lines.append(_arc(x + sx, y + sy, sx, sy, 2))
            else:
                lines.append(_arc(x + sx, y, sx, sy, 1))
                lines.append(_arc(x, y + sy, sx, sy, 3))


def _arc(cx: float, cy: float, w: float, h: float, quadrant: int) -> Polyline:
    start = quadrant * math.pi / 2
    return [(cx + math.cos(start + i * math.pi / 18) * w / 2, cy + math.sin(start + i * math.pi / 18) * h / 2) for i in range(10)]


def _hex(lines: list[Polyline], rng: random.Random, x0: float, y0: float, w: float, h: float, cell: float, jitter: float) -> None:
    r = cell / 2
    dy = r * math.sqrt(3)
    row = 0
    y = y0 + r
    while y < y0 + h - r * 0.5:
        x = x0 + r + (row % 2) * r * 1.5
        while x < x0 + w - r * 0.5:
            jx = (rng.random() - 0.5) * r * jitter
            jy = (rng.random() - 0.5) * r * jitter
            lines.append(regular_polygon(x + jx, y + jy, r * 0.9, 6, math.pi / 6))
            x += r * 3
        y += dy
        row += 1


def _voronoi_like(lines: list[Polyline], rng: random.Random, x0: float, y0: float, w: float, h: float, cell: float, jitter: float, density: float) -> None:
    cols, rows = max(2, int(w // cell)), max(2, int(h // cell))
    sx, sy = w / cols, h / rows
    for row in range(rows):
        for col in range(cols):
            cx = x0 + (col + 0.5) * sx + (rng.random() - 0.5) * sx * jitter
            cy = y0 + (row + 0.5) * sy + (rng.random() - 0.5) * sy * jitter
            sides = 5 + int(rng.random() * 3)
            rr = min(sx, sy) * (0.38 + density * 0.18)
            pts: list[Point] = []
            for i in range(sides):
                a = math.tau * i / sides + rng.uniform(-0.12, 0.12) * jitter
                pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
            lines.append(closed_polygon(pts))


def _waves(lines: list[Polyline], rng: random.Random, x0: float, y0: float, w: float, h: float, cell: float, complexity: float, density: float) -> None:
    count = max(4, int(h / cell * (0.65 + density)))
    step = h / count
    for i in range(count + 1):
        base = y0 + i * step
        amp = step * (0.45 + complexity * 0.5)
        phase = rng.uniform(0, math.tau)
        pts = []
        samples = max(18, int(w / max(cell, 4)) * 4)
        for s in range(samples + 1):
            x = x0 + w * s / samples
            y = base + math.sin(s / samples * math.tau * (1.5 + complexity * 2.5) + phase) * amp
            y = min(y0 + h, max(y0, y))
            pts.append((x, y))
        lines.append(pts)


def _penrose_like(lines: list[Polyline], x0: float, y0: float, w: float, h: float, cell: float) -> None:
    r = cell * 0.55
    dy = math.sin(math.pi / 5) * r * 2
    rows = int((h - 2 * r) / dy) + 1
    for row in range(rows):
        y = y0 + r + row * dy
        cols = int((w - 2 * r) / (r * 1.8)) + 1
        for col in range(cols):
            x = x0 + r + col * r * 1.8 + (row % 2) * r * 0.9
            if x + r > x0 + w or y + r > y0 + h:
                continue
            lines.append(regular_polygon(x, y, r, 5, (row + col) * math.pi / 5))
            lines.append(regular_polygon(x, y, r * 0.52, 5, (row + col + 1) * math.pi / 5))


def _age_cell(age_group: str) -> float:
    if age_group == "4-6":
        return 16.0
    if age_group == "8-10":
        return 10.0
    return 12.0
