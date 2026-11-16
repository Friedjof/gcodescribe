"""Encode an already planned route. No sorting, merging or geometry decisions here."""
from __future__ import annotations

import math

from plotter.artwork.export import calibration_comment
from plotter.core.calibration import feed_word, z_max_feedrate_line
from plotter.gcode.safety import GcodeSafetyChecker

from .model import PlotPlan


def encode_plot_plan(plan: PlotPlan) -> str:
    cal = plan.calibration
    pen_up = f"G0 Z{cal.pen_up_z:.3f} {feed_word(cal.z_feed)}"
    pen_down = f"G1 Z{cal.pen_down_z:.3f} {feed_word(cal.z_feed)}"
    lines = ["G21", "G90", z_max_feedrate_line(cal), pen_up]
    feed_floor = cal.draw_feed * 0.5
    feed_ceil = min(cal.travel_feed, cal.draw_feed * 1.4)

    def pressure_z(value: float) -> float:
        return round(cal.pen_down_z - min(1.0, max(0.0, value)) * cal.pen_pressure_max_depth, 3)

    for stroke, travel in zip(plan.strokes, plan.travels, strict=True):
        for x, y in travel:
            lines.append(f"G0 X{x:.3f} Y{y:.3f} {feed_word(cal.travel_feed)}")
        pressures = stroke.pressures
        current_z = cal.pen_down_z if pressures is None else pressure_z(pressures[0])
        lines.append(pen_down if pressures is None else
                     f"G1 Z{current_z:.3f} {feed_word(cal.z_feed)}")
        for i, (x, y) in enumerate(stroke.points[1:], start=1):
            feed = cal.draw_feed if stroke.feeds is None else min(
                feed_ceil, max(feed_floor, cal.draw_feed * stroke.feeds[i])
            )
            z_word = ""
            if pressures is not None:
                target_z = pressure_z(pressures[i])
                dz = abs(target_z - current_z)
                if dz > 0:
                    previous = tuple(round(v, 3) for v in stroke.points[i - 1])
                    distance = math.dist(previous, (round(x, 3), round(y, 3)))
                    path_length = math.hypot(distance, dz)
                    limit = min(cal.z_feed, cal.z_max_feedrate) * path_length / dz
                    feed = min(feed, math.floor(limit * 60 * 1_000_000) / 60 / 1_000_000)
                z_word = f" Z{target_z:.3f}"
                current_z = target_z
            lines.append(f"G1 X{x:.3f} Y{y:.3f}{z_word} {feed_word(feed)}")
        lines.append(pen_up)
    if cal.park_after_plot:
        park_lift_z = cal.resolved_park()[2]
        if abs(park_lift_z - cal.pen_up_z) > 1e-6:
            lines.append(f"G0 Z{park_lift_z:.3f} {feed_word(cal.z_feed)}")
        for x, y in plan.park_path:
            lines.append(f"G0 X{x:.3f} Y{y:.3f} {feed_word(cal.travel_feed)}")
    lines.append("M2")
    gcode = "\n".join(lines) + "\n"
    GcodeSafetyChecker(cal, allow_pressure=plan.pressure_enabled).check(gcode, name=plan.name)
    return calibration_comment(cal) + gcode
