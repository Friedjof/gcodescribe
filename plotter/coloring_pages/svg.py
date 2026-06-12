from __future__ import annotations

import html
import json
from typing import Any

from .types import Polyline


def fmt(value: float) -> str:
    text = f"{value:.3f}".rstrip("0").rstrip(".")
    return text or "0"


def rounded_point(point: tuple[float, float]) -> tuple[float, float]:
    return (round(point[0], 3), round(point[1], 3))


def rounded_lines(lines: list[Polyline]) -> list[Polyline]:
    return [[rounded_point(p) for p in line] for line in lines if len(line) >= 2]


def path_data(line: Polyline) -> str:
    first, *rest = line
    parts = [f"M {fmt(first[0])} {fmt(first[1])}"]
    parts.extend(f"L {fmt(x)} {fmt(y)}" for x, y in rest)
    if len(line) > 2 and line[0] == line[-1]:
        parts.append("Z")
    return " ".join(parts)


def create_svg_canvas(
    width_mm: float,
    height_mm: float,
    lines: list[Polyline],
    metadata: dict[str, Any],
    stroke_width_mm: float,
) -> str:
    body = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{fmt(width_mm)}mm" height="{fmt(height_mm)}mm" viewBox="0 0 {fmt(width_mm)} {fmt(height_mm)}">',
        f"<metadata>{html.escape(json.dumps(metadata, ensure_ascii=False, sort_keys=True, indent=2), quote=False)}</metadata>",
        f'<rect x="0" y="0" width="{fmt(width_mm)}" height="{fmt(height_mm)}" fill="white"/>',
        f'<g fill="none" stroke="black" stroke-width="{fmt(stroke_width_mm)}" stroke-linecap="round" stroke-linejoin="round">',
    ]
    for line in lines:
        body.append(f'<path d="{path_data(line)}"/>')
    body.extend(["</g>", "</svg>"])
    return "\n".join(body)


def validate_plotter_safety(lines: list[Polyline], width_mm: float, height_mm: float) -> None:
    for line in lines:
        for x, y in line:
            if x < -0.01 or y < -0.01 or x > width_mm + 0.01 or y > height_mm + 0.01:
                raise ValueError("Generated coloring page exceeds the SVG canvas.")
