"""Behavioral contracts for the conservative final-coordinate route optimizer."""

from __future__ import annotations

import itertools
import math
import random
from collections import Counter
from copy import deepcopy
from dataclasses import FrozenInstanceError

import pytest

from plotter.geometry.routing import TravelPlanner, TravelRoutingError
from plotter.plotplan.routing import _Search, _Visit, optimize_routes


def segments(lines):
    return Counter(tuple(sorted((tuple(a), tuple(b)))) for line in lines
                   for a, b in zip(line, line[1:], strict=False))


def travel(lines, *, start=(0.0, 0.0), end=None, obstacles=(), bed_bounds=None):
    planner = TravelPlanner(obstacles, bed_bounds=bed_bounds)
    cursor = start
    distances = []
    for line in lines:
        distances.append(planner.distance(cursor, line[0]))
        cursor = line[-1]
    if end is not None:
        distances.append(planner.distance(cursor, end))
    return math.fsum(distances)


def test_result_keeps_every_duplicate_segment_and_contact_without_mutating_input():
    lines = [
        [[80.0, 80.0], [80.0, 90.0]],
        [[10.0, 10.0], [20.0, 10.0]],
        [[10.0, 10.0], [20.0, 10.0]],
        [[25.0, 25.0], [25.0, 25.0]],  # an explicit point contact must survive
    ]
    before = deepcopy(lines)
    result = optimize_routes(lines, end=(100, 100), bed_bounds=(120, 120))
    assert lines == before
    assert len(result.lines) == len(lines)
    assert segments(result.lines) == segments(lines)
    assert sorted(result.source_indices) == list(range(len(lines)))
    assert result.distance_mm <= result.baseline_distance_mm
    assert result.distance_mm == pytest.approx(travel(result.lines, end=(100, 100)))
    assert result == optimize_routes(lines, end=(100, 100), bed_bounds=(120, 120))
    with pytest.raises(FrozenInstanceError):
        result.algorithm = "mutated"
    with pytest.raises(TypeError):
        result.lines[0][0] = (0, 0)


def test_good_baseline_is_retained_when_every_candidate_has_the_same_distance():
    lines = (((1, 0), (2, 0)), ((3, 0), (4, 0)))
    result = optimize_routes(lines, end=(5, 0))
    assert result.lines == lines
    assert result.algorithm == "baseline"
    assert result.distance_mm == result.baseline_distance_mm == 3


def test_end_anchor_changes_direction_even_when_start_is_equidistant():
    lines = (((0, 0), (10, 0)),)
    result = optimize_routes(lines, start=(5, 5), end=(0, 0))
    assert result.lines == (((10, 0), (0, 0)),)
    assert result.reversed == (True,)
    assert result.distance_mm == pytest.approx(math.sqrt(50))


def test_direction_dynamic_program_matches_all_orientations_including_end():
    rng = random.Random(1001)
    for size in range(1, 8):
        lines = tuple(tuple((rng.random() * 20, rng.random() * 20) for _ in range(3))
                      for _ in range(size))
        search = _Search(lines, (7, 12), (19, 3), [], None)
        order = [_Visit(i) for i in range(size)]
        actual = search.cost(search.orient(order))
        expected = min(
            search.cost([_Visit(i, reverse) for i, reverse in enumerate(bits)])
            for bits in itertools.product((False, True), repeat=size)
        )
        assert actual == pytest.approx(expected)


def test_ring_seam_moves_to_an_existing_vertex_without_shortcutting():
    lines = (((20, 20), (20, 10), (10, 10), (10, 20), (20, 20)),)
    result = optimize_routes(lines, start=(0, 0), end=(0, 0))
    assert result.lines[0][0] == result.lines[0][-1] == (10, 10)
    assert result.seam_offsets == (2,)
    assert result.distance_mm == pytest.approx(2 * math.sqrt(200))
    assert segments(result.lines) == segments(lines)


def test_result_metadata_reconstructs_each_original_stroke():
    lines = (
        ((40, 40), (40, 10), (10, 10), (10, 40), (40, 40)),
        ((80, 15), (90, 12), (100, 5)),
        ((70, 70), (75, 76)),
    )
    result = optimize_routes(lines, start=(0, 0), end=(90, 90))
    for output, source, reverse, seam in zip(
        result.lines, result.source_indices, result.reversed, result.seam_offsets, strict=True
    ):
        original = lines[source]
        if seam:
            ring = original[:-1]
            original = ring[seam:] + ring[:seam] + (ring[seam],)
        assert output == (original[::-1] if reverse else original)


def test_obstacle_route_uses_actual_distances_instead_of_airline_cost():
    obstacles = [{"x": 84, "y": 10, "w": 2, "h": 180}]
    lines = [((x, y), (x + 1, y)) for y in range(25, 186, 20) for x in (79, 90)]
    result = optimize_routes(lines, end=(0, 200), obstacles=obstacles, bed_bounds=(210, 210))
    actual = travel(result.lines, end=(0, 200), obstacles=obstacles, bed_bounds=(210, 210))
    assert result.distance_mm == pytest.approx(actual)
    assert result.baseline_distance_mm == pytest.approx(
        travel(lines, end=(0, 200), obstacles=obstacles, bed_bounds=(210, 210))
    )
    assert result.distance_mm < result.baseline_distance_mm * 0.6
    assert segments(result.lines) == segments(lines)


def test_bed_boundary_route_uses_valid_side_of_obstacle():
    obstacles = [{"x": 90, "y": 0, "w": 20, "h": 140}]
    result = optimize_routes([((150, 50), (155, 50))], start=(50, 50),
                             obstacles=obstacles, bed_bounds=(210, 210))
    assert math.isfinite(result.distance_mm)
    assert result.distance_mm > 200


@pytest.mark.parametrize("bounds", [(100, 100), None])
def test_unreachable_route_fails_closed(bounds):
    with pytest.raises(TravelRoutingError):
        optimize_routes([((15, 15), (18, 15))], obstacles=[{"x": 10, "y": 10,
                        "w": 10, "h": 10}], bed_bounds=bounds)


def test_invalid_obstacle_is_rejected_even_without_bed_bounds():
    with pytest.raises(TravelRoutingError):
        optimize_routes([((15, 15), (18, 15))],
                        obstacles=[{"x": 10, "y": math.nan, "w": 10, "h": 10}])


@pytest.mark.parametrize("lines", [
    [[(0, 0)]], [[(0, 0), (float("nan"), 1)]], [[(0, 0), (1, float("inf"))]],
    [[(0, 0), (True, 1)]], [[(0, 0), ("1", 2)]],
])
def test_invalid_geometry_is_rejected_before_search(lines):
    with pytest.raises(ValueError):
        optimize_routes(lines)


def test_empty_route_only_accounts_for_its_anchors():
    result = optimize_routes([], start=(1, 1), end=(4, 5))
    assert result.lines == ()
    assert result.source_indices == ()
    assert result.distance_mm == result.baseline_distance_mm == 5


def test_large_shared_endpoint_fixture_has_bounded_work_and_no_dropped_strokes():
    # Repeated endpoints are the adversarial case for a KD-tree that repeatedly
    # expands searches through already used entries. Assert work, not CPU time.
    lines = [((10, 10), (20, 10)) for _ in range(4096)]
    result = optimize_routes(lines, end=(0, 0), bed_bounds=(100, 100))
    assert len(result.lines) == len(lines)
    assert segments(result.lines) == segments(lines)
    assert result.evaluations < 150 * len(lines)
    assert result.distance_mm <= result.baseline_distance_mm


def test_bounded_local_search_reaches_the_end_of_a_large_page():
    xs = [*range(998), 999, 998]
    lines = tuple(((x, 0), (x, 0)) for x in xs)
    search = _Search(lines, (0, 0), (1000, 0), [], None)
    initial = [_Visit(i) for i in range(len(lines))]
    improved = search.two_opt(initial)
    assert search.cost(improved) == pytest.approx(search.cost(initial) - 2)


@pytest.mark.parametrize("seed", range(5))
def test_random_routes_preserve_geometry_and_never_worsen_total_travel(seed):
    rng = random.Random(seed)
    lines = [tuple((rng.uniform(10, 190), rng.uniform(10, 190)) for _ in range(4))
             for _ in range(90)]
    result = optimize_routes(lines, start=(20, 170), end=(170, 20), bed_bounds=(200, 200))
    assert segments(result.lines) == segments(lines)
    assert len(result.lines) == len(lines)
    assert result.distance_mm == pytest.approx(travel(result.lines, start=(20, 170), end=(170, 20)))
    assert result.distance_mm <= result.baseline_distance_mm + 1e-9
