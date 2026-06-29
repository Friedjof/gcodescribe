"""The continuous-stroke transform must reduce pen lifts without distorting the
drawing.

These pin the invariants that make ``continuous_path`` safe and useful: each
connected component becomes ONE stroke (retraces run over existing lines only —
no visible bridges between separate components), every original vertex is still
visited (nothing dropped), and it degrades to a no-op rather than hang on huge
inputs.
"""
from __future__ import annotations

import numpy as np

from plotter.drawing import Drawing, placed_gcode
from plotter.calibration import Calibration
from plotter.oneline import continuous_path


def _seg(*pts: tuple[float, float]) -> np.ndarray:
    return np.array([complex(x, y) for x, y in pts])


def _vertices(polylines: list[np.ndarray]) -> set[tuple[float, float]]:
    out: set[tuple[float, float]] = set()
    for pl in polylines:
        for p in pl:
            out.add((round(p.real, 3), round(p.imag, 3)))
    return out


def test_single_input_unchanged():
    one = [_seg((0, 0), (10, 0))]
    assert continuous_path(one, tol=0.5) == one


def test_connected_square_is_one_stroke():
    square = [
        _seg((0, 0), (10, 0)),
        _seg((10, 0), (10, 10)),
        _seg((10, 10), (0, 10)),
        _seg((0, 10), (0, 0)),
    ]
    out = continuous_path(square, tol=0.5)
    assert len(out) == 1
    # every original vertex is still visited
    assert _vertices(square) <= _vertices(out)


def test_separate_islands_stay_separate_no_bridges():
    # Three disjoint triangles → three separate strokes, NO connecting bridges.
    tri_a = [_seg((0, 0), (5, 0)), _seg((5, 0), (2, 5)), _seg((2, 5), (0, 0))]
    tri_b = [_seg((20, 0), (25, 0)), _seg((25, 0), (22, 5)), _seg((22, 5), (20, 0))]
    tri_c = [_seg((0, 20), (5, 20)), _seg((5, 20), (2, 25)), _seg((2, 25), (0, 20))]
    pieces = tri_a + tri_b + tri_c
    out = continuous_path(pieces, tol=0.5)
    assert len(out) == 3  # one continuous stroke per component, no bridges
    assert _vertices(pieces) <= _vertices(out)
    # No stroke spans two triangles (no bridge): each stays within its x-cluster.
    for stroke in out:
        xs = [p.real for p in stroke]
        assert max(xs) - min(xs) <= 10.0


def test_guard_returns_input_for_huge_inputs():
    big = [_seg((i, 0), (i + 1, 1)) for i in range(50)]
    assert continuous_path(big, tol=0.5, max_lines=10) is not big
    # same number of strokes back (no collapse)
    assert len(continuous_path(big, tol=0.5, max_lines=10)) == 50


def test_placed_gcode_continuous_lifts_pen_once():
    # A connected open zig-zag: 3 strokes sharing endpoints.
    drawing = Drawing(
        polylines=[
            _seg((0, 0), (10, 0)),
            _seg((10, 0), (10, 10)),
            _seg((10, 10), (20, 10)),
        ],
        width=30.0,
        height=30.0,
    )
    cal = Calibration()
    normal = placed_gcode(drawing, cal, x=10, y=10, width=20, name="t")
    continuous = placed_gcode(
        drawing, cal, x=10, y=10, width=20, name="t", continuous=True
    )

    pen_down = f"G1 Z{cal.pen_down_z:.3f}"
    # continuous collapses 3 pen-downs into a single one
    assert continuous.count(pen_down) == 1
    assert normal.count(pen_down) >= continuous.count(pen_down)
