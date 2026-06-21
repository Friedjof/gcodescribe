"""How well the stroke merge works on the real generators (mazes, mandalas,
math patterns).

The merge must be *safe* everywhere — it may only reverse and chain existing
pieces, never invent, drop or move a segment — and *effective* on grid-like art
where many short pieces line up into continuous strokes. These tests pin both:
a per-game correctness invariant (the segment multiset is preserved) plus the
pen-lift reduction we expect on mazes.
"""
from __future__ import annotations

import math
from collections import Counter

import pytest

from plotter.coloring_pages import ColoringPageGenerator
from plotter.linemerge import merge_polylines
from plotter.maze.generate import generate_maze

MANDALA_MODES = ["flower", "star", "butterfly", "sun", "nature", "magic"]
PATTERN_MODES = [
    "truchet", "voronoi", "hex_mosaic", "wave_field", "penrose",
    "scales", "stained_glass", "bubbles", "spiral",
]
MAZE_TYPES = ["classic", "masked", "hex", "polar"]


def _mandala(mode):
    return ColoringPageGenerator().generate_mandala_page("anna-7", mode, 164, 200).polylines


def _pattern(mode):
    return ColoringPageGenerator().generate_math_pattern_page("max-12", mode, 164, 200).polylines


def _maze(maze_type):
    return generate_maze(maze_type, "demo", 12, 200, 200).wall_lines


# (id, callable producing the raw polylines for one generated page)
GAMES = (
    [(f"mandala-{m}", lambda m=m: _mandala(m)) for m in MANDALA_MODES]
    + [(f"pattern-{m}", lambda m=m: _pattern(m)) for m in PATTERN_MODES]
    + [(f"maze-{m}", lambda m=m: _maze(m)) for m in MAZE_TYPES]
)
GAME_IDS = [g[0] for g in GAMES]


def _segment_counter(lines, ndigits=6):
    """Multiset of drawn segments, each as an orientation-free, rounded pair.

    Merging may reverse and concatenate pieces but must preserve exactly which
    point-to-point segments get drawn, so this Counter is invariant under it.
    """
    counter: Counter = Counter()
    for line in lines:
        for a, b in zip(line, line[1:], strict=False):
            pa = (round(a[0], ndigits), round(a[1], ndigits))
            pb = (round(b[0], ndigits), round(b[1], ndigits))
            counter[tuple(sorted((pa, pb)))] += 1
    return counter


def _total_length(lines):
    return sum(
        math.hypot(b[0] - a[0], b[1] - a[1])
        for line in lines
        for a, b in zip(line, line[1:], strict=False)
    )


@pytest.mark.parametrize("produce", [g[1] for g in GAMES], ids=GAME_IDS)
def test_merge_preserves_every_segment(produce):
    raw = [[tuple(p) for p in line] for line in produce()]
    merged = merge_polylines(raw)
    # The exact set of drawn segments is unchanged: no ink invented or lost,
    # only the order and direction of pieces changes.
    assert _segment_counter(merged) == _segment_counter(raw)


@pytest.mark.parametrize("produce", [g[1] for g in GAMES], ids=GAME_IDS)
def test_merge_never_increases_strokes_or_breaks_them(produce):
    raw = [[tuple(p) for p in line] for line in produce()]
    merged = merge_polylines(raw)
    assert len(merged) <= len(raw)          # at worst nothing connects
    assert all(len(line) >= 2 for line in merged)  # every stroke still draws


@pytest.mark.parametrize("produce", [g[1] for g in GAMES], ids=GAME_IDS)
def test_merge_preserves_total_pen_down_length(produce):
    raw = [[tuple(p) for p in line] for line in produce()]
    merged = merge_polylines(raw)
    assert math.isclose(_total_length(merged), _total_length(raw), rel_tol=1e-9, abs_tol=1e-6)


@pytest.mark.parametrize("produce", [g[1] for g in GAMES], ids=GAME_IDS)
def test_merge_is_idempotent(produce):
    raw = [[tuple(p) for p in line] for line in produce()]
    once = merge_polylines(raw)
    twice = merge_polylines(once)
    assert len(twice) == len(once)
    assert _segment_counter(twice) == _segment_counter(once)


@pytest.mark.parametrize("maze_type", MAZE_TYPES)
def test_mazes_collapse_to_far_fewer_strokes(maze_type):
    raw = [[tuple(p) for p in line] for line in _maze(maze_type)]
    merged = merge_polylines(raw)
    # Maze walls are unit grid edges that line up into long runs, so the pen
    # should lift less than half as often as it did per-segment.
    assert len(merged) <= len(raw) * 0.5


def test_continuous_wall_is_one_uninterrupted_stroke():
    # A straight interior wall split across cells must come out as a single
    # stroke with no pen lift in the middle, regardless of how it was diced.
    diced = [[(x, 5.0), (x + 1.0, 5.0)] for x in range(10)]
    merged = merge_polylines(diced)
    assert len(merged) == 1
    assert len(merged[0]) == 11
