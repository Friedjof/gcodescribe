from __future__ import annotations

from plotter.calibration import Calibration
from plotter.scene import scene_gcode


def _cal() -> Calibration:
    return Calibration(park_after_plot=False, draw_feed=3000.0, travel_feed=6000.0)


def _pen_down(cal: Calibration) -> str:
    return f"G1 Z{cal.pen_down_z:.3f}"


def test_scene_gcode_uses_cached_feed_scales_once():
    cal = _cal()
    page = {
        "id": "p",
        "name": "p",
        "continuous": True,
        "objects": [
            {
                "id": "stroke-text",
                "type": "text",
                "transform": {"x": 0, "y": 0, "rotation": 0, "scale": 1},
                "cachedPolylines": [[[10, 10], [20, 10], [30, 10]]],
                "cachedFeeds": [[1.0, 1.4, 0.5]],
            }
        ],
    }

    gcode = scene_gcode(page, cal)

    assert gcode.count(_pen_down(cal)) == 1
    assert "G1 X25.000 Y195.000 F4200" in gcode
    assert "G1 X35.000 Y195.000 F1500" in gcode


def test_scene_gcode_clamps_feed_scales_to_safety_band():
    cal = _cal()
    page = {
        "id": "p",
        "name": "p",
        "objects": [
            {
                "id": "stroke-text",
                "type": "text",
                "transform": {"x": 0, "y": 0, "rotation": 0, "scale": 1},
                "cachedPolylines": [[[10, 20], [20, 20], [30, 20]]],
                "cachedFeeds": [[0.01, 99.0, -10.0]],
            }
        ],
    }

    gcode = scene_gcode(page, cal)

    assert "G1 X25.000 Y185.000 F4200" in gcode
    assert "G1 X35.000 Y185.000 F1500" in gcode


def test_scene_gcode_masked_feed_line_falls_back_to_uniform_feed():
    cal = _cal()
    page = {
        "id": "p",
        "name": "p",
        "continuous": False,
        "objects": [
            {
                "id": "stroke-text",
                "type": "text",
                "zOrder": 0,
                "transform": {"x": 0, "y": 0, "rotation": 0, "scale": 1},
                "cachedPolylines": [[[10, 30], [20, 30], [30, 30]]],
                "cachedFeeds": [[1.0, 1.4, 0.5]],
            },
            {
                "id": "mask",
                "type": "mask-rect",
                "zOrder": 1,
                "transform": {"x": 0, "y": 0, "rotation": 0, "scale": 1},
                "cachedPolylines": [[[18, 28], [22, 28], [22, 32], [18, 32], [18, 28]]],
            },
        ],
    }

    gcode = scene_gcode(page, cal)

    assert "F4200" not in gcode
    assert "F1500" not in gcode
    assert "F3000" in gcode
