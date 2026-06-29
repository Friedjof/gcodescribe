from __future__ import annotations

from plotter.calibration import Calibration
from plotter.scene import scene_gcode


def _plus_object() -> dict:
    # A "+" centred at (30,30): four arms meeting at one degree-4 junction.
    # merge_polylines keeps it as 2 strokes (H + V); the graph is connected, so
    # the continuous pass must draw it as a single stroke.
    return {
        "id": "plus",
        "type": "line",
        "zOrder": 0,
        "transform": {"x": 0, "y": 0, "rotation": 0, "scale": 1},
        "cachedPolylines": [
            [[20, 30], [30, 30]],
            [[30, 30], [40, 30]],
            [[30, 20], [30, 30]],
            [[30, 30], [30, 40]],
        ],
    }


def _pen_down(cal: Calibration) -> str:
    return f"G1 Z{cal.pen_down_z:.3f}"


def test_scene_gcode_continuous_collapses_to_one_pen_down():
    cal = Calibration()
    pd = _pen_down(cal)

    # Continuous is the default now → one continuous stroke (single pen-down).
    default = scene_gcode({"id": "p", "name": "p", "objects": [_plus_object()]}, cal)
    cont = scene_gcode(
        {"id": "p", "name": "p", "objects": [_plus_object()], "continuous": True}, cal
    )
    # Opt-out restores the classic per-stroke behaviour (multiple pen-downs).
    plain = scene_gcode(
        {"id": "p", "name": "p", "objects": [_plus_object()], "continuous": False}, cal
    )

    assert default.count(pd) == 1  # default ON
    assert cont.count(pd) == 1
    assert plain.count(pd) >= 2  # H + V strokes when explicitly disabled
