from __future__ import annotations

from plotter.linemerge import merge_polylines


def _as_tuples(line):
    return [tuple(p) for p in line]


def _normalize(line):
    """A stroke is the same whichever way it is drawn; compare orientation-free."""
    pts = _as_tuples(line)
    return min(pts, list(reversed(pts)))


def test_collinear_segments_join_into_one_stroke():
    segments = [
        [(0, 0), (1, 0)],
        [(1, 0), (2, 0)],
        [(2, 0), (3, 0)],
    ]
    merged = merge_polylines(segments)
    assert len(merged) == 1
    assert _normalize(merged[0]) == _normalize([(0, 0), (1, 0), (2, 0), (3, 0)])


def test_reversed_segment_is_joined():
    # The second piece is stored end-to-start; it must still chain on.
    merged = merge_polylines([[(0, 0), (1, 0)], [(2, 0), (1, 0)]])
    assert len(merged) == 1
    assert _normalize(merged[0]) == _normalize([(0, 0), (1, 0), (2, 0)])


def test_disjoint_lines_stay_separate():
    merged = merge_polylines([[(0, 0), (1, 0)], [(5, 5), (6, 5)]])
    assert len(merged) == 2


def test_straight_run_preferred_through_a_junction():
    # A horizontal line crosses a vertical stub at (1, 0). The pen should keep
    # going straight rather than turning down the stub.
    horizontal_a = [(0, 0), (1, 0)]
    horizontal_b = [(1, 0), (2, 0)]
    stub = [(1, 0), (1, 1)]
    merged = merge_polylines([horizontal_a, stub, horizontal_b])
    straight = next(m for m in merged if len(m) == 3)
    assert _normalize(straight) == _normalize([(0, 0), (1, 0), (2, 0)])


def test_closed_loop_is_preserved():
    loop = [(0, 0), (1, 0), (1, 1), (0, 1), (0, 0)]
    merged = merge_polylines([loop])
    assert len(merged) == 1
    assert _as_tuples(merged[0]) == _as_tuples(loop)


def test_endpoints_within_tolerance_merge():
    merged = merge_polylines([[(0, 0), (1, 0)], [(1.0001, 0), (2, 0)]], tol=0.05)
    assert len(merged) == 1


def test_maze_border_collapses_to_few_strokes():
    # Four sides of a square, each split into two unit segments (eight pieces),
    # should merge down to a single closed outline.
    pieces = [
        [(0, 0), (1, 0)], [(1, 0), (2, 0)],
        [(2, 0), (2, 1)], [(2, 1), (2, 2)],
        [(2, 2), (1, 2)], [(1, 2), (0, 2)],
        [(0, 2), (0, 1)], [(0, 1), (0, 0)],
    ]
    merged = merge_polylines(pieces)
    assert len(merged) == 1
    assert merged[0][0] == merged[0][-1]  # closed
