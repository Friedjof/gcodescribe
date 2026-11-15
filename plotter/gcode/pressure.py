"""Pressure attributes that follow source strokes through clipping and placement."""
from __future__ import annotations

import math
from dataclasses import dataclass

from plotter.artwork.pipeline import PlotterError
from plotter.geometry.primitives import (
    EPS,
    Polygon,
    Polyline,
    inside_convex,
    subtract_polygon_from_segment,
)


@dataclass
class PressureLine:
    points: Polyline
    # Point values, interpolated along each motion. None retains fixed pen-down Z.
    pressures: list[float] | None = None


def point_pressures(raw: object, point_count: int) -> list[float] | None:
    """Turn Xournal's n−1 segment widths into a smooth, bounded point curve.

    Keep the source's relative magnitude; normalizing each stroke to its own
    maximum would make even a lightly written stroke use maximum pressure.
    """
    if raw is None:
        return None
    if not isinstance(raw, list) or len(raw) != point_count - 1:
        raise PlotterError(
            "Die Druckwerte passen nicht zu den Stiftwegen. "
            "Bitte das Xournal-Objekt erneut aus der Galerie einfügen."
        )
    if not raw:
        return None
    if any(isinstance(p, bool) or not isinstance(p, (int, float))
           or not math.isfinite(p) or not 0 <= p <= 1 for p in raw):
        raise PlotterError("Die Druckvariation enthält ungültige Werte.")
    middle = [(a + b) / 2 for a, b in zip(raw, raw[1:], strict=False)]
    return [float(raw[0]), *middle, float(raw[-1])]


def _clip_pressure_line(line: PressureLine, mask: Polygon) -> list[PressureLine]:
    clipped: list[PressureLine] = []
    current: Polyline = []
    values: list[float] | None = [] if line.pressures is not None else None

    def flush() -> None:
        nonlocal current, values
        if len(current) >= 2:
            clipped.append(PressureLine(current, values))
        current = []
        values = [] if line.pressures is not None else None

    for i, (a, b) in enumerate(zip(line.points, line.points[1:], strict=False)):
        length_sq = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2
        # Xournal dots are represented by two equal XY points.
        if length_sq <= EPS ** 2:
            visible = [[a, b]] if not inside_convex(a, mask) else []
        else:
            visible = subtract_polygon_from_segment(a, b, mask)
        for start, end in visible:
            if current and math.dist(current[-1], start) > EPS:
                flush()
            if not current:
                current.append(start)
                if values is not None:
                    t = 0.0 if length_sq <= EPS ** 2 else (
                        ((start[0] - a[0]) * (b[0] - a[0])
                         + (start[1] - a[1]) * (b[1] - a[1])) / length_sq
                    )
                    values.append(line.pressures[i]
                                  + t * (line.pressures[i + 1] - line.pressures[i]))
            current.append(end)
            if values is not None:
                t = 1.0 if length_sq <= EPS ** 2 else (
                    ((end[0] - a[0]) * (b[0] - a[0])
                     + (end[1] - a[1]) * (b[1] - a[1])) / length_sq
                )
                values.append(line.pressures[i]
                              + t * (line.pressures[i + 1] - line.pressures[i]))
        if not visible:
            flush()
    flush()
    return clipped


def clip_pressure_lines(lines: list[PressureLine], masks: list[Polygon]) -> list[PressureLine]:
    """Clip geometry and interpolate pressure at each newly created endpoint."""
    for mask in masks:
        lines = [piece for line in lines for piece in _clip_pressure_line(line, mask)]
    return lines


def page_uses_pressure(page: dict) -> bool:
    return any(
        not obj.get("plotted")
        and (obj.get("data") or {}).get("strokeOrder") == "source"
        and (obj.get("data") or {}).get("pressureEnabled") is True
        for obj in page.get("objects", [])
    )


def job_uses_pressure(meta: dict | None) -> bool:
    """Only sidecar metadata opts saved jobs into the calibrated pressure range."""
    return ((meta or {}).get("source") or {}).get("pressure_enabled") is True
