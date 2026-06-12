from __future__ import annotations

import math
import time
from pathlib import Path

from .calibration import Calibration
from .export import calibration_comment
from .pipeline import PlotterError
from .safety import GcodeSafetyChecker
from .storage import jobs_dir

Point = tuple[float, float]
Polyline = list[Point]


def _transform_point(point: list | tuple, transform: dict) -> Point:
    scale = float(transform.get("scale", 1.0))
    x = float(point[0]) * float(transform.get("scaleX") or scale)
    y = float(point[1]) * float(transform.get("scaleY") or scale)
    rot = float(transform.get("rotation", 0.0))
    cos_r, sin_r = math.cos(rot), math.sin(rot)
    return (
        float(transform.get("x", 0.0)) + x * cos_r - y * sin_r,
        float(transform.get("y", 0.0)) + x * sin_r + y * cos_r,
    )


def page_polylines(page: dict) -> list[Polyline]:
    """Return unplotted scene polylines in plot-area mm, editor y-down space."""
    lines: list[Polyline] = []
    objects = sorted(
        (obj for obj in page.get("objects", []) if not obj.get("plotted")),
        key=lambda obj: float(obj.get("zOrder", 0.0)),
    )
    for obj in objects:
        transform = obj.get("transform") or {"x": 0, "y": 0, "rotation": 0, "scale": 1}
        for raw_line in obj.get("cachedPolylines") or []:
            if len(raw_line) < 2:
                continue
            line = [_transform_point(point, transform) for point in raw_line]
            if len(line) > 1:
                lines.append(line)
    return lines


def _sorted_for_travel(polylines: list[Polyline]) -> list[Polyline]:
    if len(polylines) > 4000:
        return polylines
    remaining = list(polylines)
    ordered: list[Polyline] = []
    cursor = (0.0, 0.0)
    while remaining:
        best_i, best_rev, best_d = 0, False, float("inf")
        for i, line in enumerate(remaining):
            d_start = math.hypot(line[0][0] - cursor[0], line[0][1] - cursor[1])
            d_end = math.hypot(line[-1][0] - cursor[0], line[-1][1] - cursor[1])
            if d_start < best_d:
                best_i, best_rev, best_d = i, False, d_start
            if d_end < best_d:
                best_i, best_rev, best_d = i, True, d_end
        line = remaining.pop(best_i)
        if best_rev:
            line = list(reversed(line))
        ordered.append(line)
        cursor = line[-1]
    return ordered


def scene_gcode(page: dict, cal: Calibration) -> str:
    polylines = page_polylines(page)
    if not polylines:
        raise PlotterError("Die Seite enthält keine ungeplotteten Linien.")

    pen_up = f"G0 Z{cal.pen_up_z:.3f} F{cal.z_feed:.0f}"
    pen_down = f"G1 Z{cal.pen_down_z:.3f} F{cal.z_feed:.0f}"
    lines = ["G21", "G90", pen_up]

    def printer(point: Point) -> Point:
        x, y = point
        if cal.flip_y:
            return cal.origin_x + x, cal.origin_y + cal.plot_height - y
        return cal.origin_x + x, cal.origin_y + y

    for poly in _sorted_for_travel(polylines):
        x, y = printer(poly[0])
        lines.append(f"G0 X{x:.3f} Y{y:.3f} F{cal.travel_feed:.0f}")
        lines.append(pen_down)
        for point in poly[1:]:
            x, y = printer(point)
            lines.append(f"G1 X{x:.3f} Y{y:.3f} F{cal.draw_feed:.0f}")
        lines.append(pen_up)

    # Park: bed all the way forward (Y max) so the sheet is easy to remove, head
    # centred on X — i.e. the nozzle rests at the back-centre of the bed.
    lines += [f"G0 X{cal.bed_width / 2:.3f} Y{cal.bed_height:.3f} F{cal.travel_feed:.0f}", "M2"]
    gcode = "\n".join(lines) + "\n"
    GcodeSafetyChecker(cal).check(gcode, name=page.get("name") or page.get("id") or "Paint-Seite")
    return calibration_comment(cal) + gcode


def save_scene_job(page: dict, cal: Calibration | None = None) -> Path:
    cal = cal or Calibration.load()
    gcode = scene_gcode(page, cal)
    raw_stem = str(page.get("name") or page.get("id") or "paint")
    stem = "".join(c if c.isalnum() or c in "-_" else "-" for c in raw_stem)
    path = jobs_dir() / f"paint-{stem[:40]}-{int(time.time())}.gcode"
    path.write_text(gcode)
    return path
