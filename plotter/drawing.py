from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
import vpype

from .calibration import Calibration
from .export import calibration_comment
from .pipeline import PlotterError
from .safety import GcodeSafetyChecker

PX_TO_MM = 25.4 / 96.0  # vpype works in CSS pixels


@dataclass
class Drawing:
    """Polylines of a source page in mm, SVG coordinates (y pointing down)."""

    polylines: list[np.ndarray]  # complex arrays, mm
    width: float  # page width in mm
    height: float  # page height in mm

    def bounds(self) -> tuple[float, float, float, float]:
        xs = np.concatenate([line.real for line in self.polylines])
        ys = np.concatenate([line.imag for line in self.polylines])
        return float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max())

    def is_empty(self) -> bool:
        return not self.polylines


@lru_cache(maxsize=6)
def _read_svg_drawing(path: str, mtime_ns: int, quantization_mm: float) -> Drawing:
    lc, width_px, height_px = vpype.read_svg(path, quantization=quantization_mm / PX_TO_MM)
    lc.merge(tolerance=0.05 / PX_TO_MM)
    polylines = [np.asarray(line) * PX_TO_MM for line in lc.lines if len(line) > 1]
    return Drawing(polylines, width_px * PX_TO_MM, height_px * PX_TO_MM)


def load_svg_drawing(path: Path, *, quantization_mm: float = 0.25) -> Drawing:
    """Parse an SVG into a Drawing (mm). Cached by path+mtime+quantization, so
    repeated parses of the same page (e.g. live placement scoring, then G-code)
    don't re-run the costly vpype parse — which can take tens of seconds for a
    detailed trace. Callers treat the result as read-only."""
    try:
        mtime_ns = path.stat().st_mtime_ns
    except OSError:
        mtime_ns = 0
    return _read_svg_drawing(str(path), mtime_ns, quantization_mm)


def _sorted_for_travel(polylines: list[np.ndarray]) -> list[np.ndarray]:
    """Greedy nearest-neighbour ordering (with reversal) to cut travel time."""
    if len(polylines) > 4000:
        return polylines
    remaining = list(polylines)
    ordered: list[np.ndarray] = []
    cursor = 0 + 0j
    while remaining:
        best_i, best_rev, best_d = 0, False, float("inf")
        for i, line in enumerate(remaining):
            d_start = abs(line[0] - cursor)
            d_end = abs(line[-1] - cursor)
            if d_start < best_d:
                best_i, best_rev, best_d = i, False, d_start
            if d_end < best_d:
                best_i, best_rev, best_d = i, True, d_end
        line = remaining.pop(best_i)
        if best_rev:
            line = line[::-1]
        ordered.append(line)
        cursor = line[-1]
    return ordered


def placed_gcode(
    drawing: Drawing,
    cal: Calibration,
    *,
    x: float,
    y: float,
    width: float,
    name: str = "placement",
) -> str:
    """G-code for the drawing scaled to ``width`` mm with its lower-left
    corner at printer position (``x``, ``y``).

    The SVG y-axis (down) is flipped into printer space (up). The result is
    validated by the safety checker, so it can never leave the plot area or
    the calibrated pen heights.
    """
    if drawing.is_empty():
        raise PlotterError("Die Zeichnung enthält keine Linien.")
    if width <= 0:
        raise PlotterError("Breite muss größer als 0 sein.")
    bx0, by0, bx1, by1 = drawing.bounds()
    bw = bx1 - bx0
    if bw <= 0:
        raise PlotterError("Zeichnung hat keine Breite.")
    scale = width / bw

    def tx(p: complex) -> tuple[float, float]:
        return (x + (p.real - bx0) * scale, y + (by1 - p.imag) * scale)

    pen_up = f"G0 Z{cal.pen_up_z:.3f} F{cal.z_feed:.0f}"
    pen_down = f"G1 Z{cal.pen_down_z:.3f} F{cal.z_feed:.0f}"
    lines = ["G21", "G90", pen_up]
    for poly in _sorted_for_travel(drawing.polylines):
        px, py = tx(poly[0])
        lines.append(f"G0 X{px:.3f} Y{py:.3f} F{cal.travel_feed:.0f}")
        lines.append(pen_down)
        for point in poly[1:]:
            px, py = tx(point)
            lines.append(f"G1 X{px:.3f} Y{py:.3f} F{cal.draw_feed:.0f}")
        lines.append(pen_up)
    # Park: bed all the way forward (Y max) so the sheet is easy to remove, head
    # centred on X — i.e. the nozzle rests at the back-centre of the bed.
    lines += [f"G0 X{cal.bed_width / 2:.3f} Y{cal.bed_height:.3f} F{cal.travel_feed:.0f}", "M2"]
    gcode = "\n".join(lines) + "\n"

    GcodeSafetyChecker(cal).check(gcode, name=name)
    return calibration_comment(cal) + gcode
