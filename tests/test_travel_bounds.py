from __future__ import annotations

import math

import pytest

from plotter.core.calibration import Calibration
from plotter.gcode.safety import GcodeSafetyChecker
from plotter.geometry.routing import (
    OBSTACLE_MARGIN,
    TravelPlanner,
    TravelRoutingError,
    route_travel,
    seg_intersects_obs,
)


def assert_clear(start, route, obstacles, bounds):
    assert route
    for point in [start, *route]:
        assert 0 <= point[0] <= bounds[0]
        assert 0 <= point[1] <= bounds[1]
    for a, b in zip([start, *route], route, strict=False):
        assert all(not seg_intersects_obs(a, b, obs, OBSTACLE_MARGIN) for obs in obstacles)


def test_boundary_obstacle_uses_valid_upper_route_and_passes_gcode_check():
    obstacle = {"x": 90, "y": 0, "w": 20, "h": 140}
    route = route_travel((50, 50), (150, 50), [obstacle], bed_bounds=(210, 210))
    assert route == [(86.95, 143.05), (113.05, 143.05), (150, 50)]
    assert_clear((50, 50), route, [obstacle], (210, 210))
    code = "G21\nG90\nG0 Z5\nG0 X50 Y50\n" + "\n".join(
        f"G0 X{x:.3f} Y{y:.3f}" for x, y in route
    )
    GcodeSafetyChecker(Calibration(obstacles=[obstacle])).check(code)


def test_unreachable_bed_does_not_return_direct_collision():
    planner = TravelPlanner([{"x": 90, "y": 0, "w": 20, "h": 210}], bed_bounds=(210, 210))
    for _ in range(2):
        with pytest.raises(TravelRoutingError, match="Keine freie Leerfahrt"):
            planner.route((50, 50), (150, 50))


def test_legacy_without_bounds_keeps_direct_fallback():
    obstacle = {"x": 90, "y": 0, "w": 20, "h": 140}
    assert route_travel((100, 50), (150, 50), [obstacle]) == [(150, 50)]
    assert route_travel((-2, 0), (220, 0), []) == [(220, 0)]


@pytest.mark.parametrize("point", [(-0.01, 0), (0, 211), (math.nan, 0), (0, math.inf)])
def test_invalid_endpoint_rejected_even_without_obstacles(point):
    with pytest.raises(TravelRoutingError):
        route_travel(point, (20, 20), [], bed_bounds=(210, 210))
    with pytest.raises(TravelRoutingError):
        route_travel((20, 20), point, [], bed_bounds=(210, 210))


@pytest.mark.parametrize("bounds", [(0, 210), (-1, 210), (math.inf, 210), (210, math.nan)])
def test_invalid_bed_bounds_rejected(bounds):
    with pytest.raises(TravelRoutingError):
        TravelPlanner([], bed_bounds=bounds)


@pytest.mark.parametrize("obstacle", [
    {"x": 10, "y": 10, "w": -1, "h": 10},
    {"x": 10, "y": 10, "w": math.nan, "h": 10},
    {"x": 10, "y": 10, "w": 10},
])
def test_invalid_obstacles_rejected(obstacle):
    with pytest.raises(TravelRoutingError):
        TravelPlanner([obstacle], bed_bounds=(210, 210))


def test_endpoint_inside_clearance_is_not_silently_routed_out():
    with pytest.raises(TravelRoutingError, match="Hindernisabstands"):
        route_travel((88, 50), (150, 50), [{"x": 90, "y": 0, "w": 20, "h": 140}],
                     bed_bounds=(210, 210))


def test_overlapping_obstacles_and_symmetric_distance():
    obstacles = [{"x": 30, "y": 30, "w": 30, "h": 40},
                 {"x": 50, "y": 40, "w": 30, "h": 40}]
    planner = TravelPlanner(obstacles, bed_bounds=(100, 100))
    start, end = (10, 50), (90, 50)
    route = planner.route(start, end)
    assert_clear(start, route, obstacles, (100, 100))
    length = sum(math.dist(a, b) for a, b in zip([start, *route], route, strict=False))
    assert planner.distance(start, end) == pytest.approx(length)
    assert planner.distance(end, start) == planner.distance(start, end)
    assert planner.route(start, end) == route
    assert_clear(end, planner.route(end, start), obstacles, (100, 100))


def test_snapshot_ignores_later_obstacle_mutations_and_returned_path_changes():
    obstacles = [{"x": 40, "y": 0, "w": 20, "h": 50}]
    planner = TravelPlanner(obstacles, bed_bounds=(100, 100))
    expected = planner.route((10, 25), (90, 25))
    obstacles[0]["h"] = 100
    route = planner.route((10, 25), (90, 25))
    route.clear()
    assert planner.route((10, 25), (90, 25)) == expected


def test_narrow_clear_corridor_is_not_erased_by_corner_extra():
    obstacles = [{"x": 40, "y": 0, "w": 20, "h": 46.99},
                 {"x": 40, "y": 53.01, "w": 20, "h": 46.99}]
    start, end = (10, 40), (90, 60)
    route = route_travel(start, end, obstacles, bed_bounds=(100, 100))
    assert_clear(start, route, obstacles, (100, 100))
    assert any(49.99 < y < 50.01 for _, y in route)


def test_direct_and_stationary_routes_include_end():
    planner = TravelPlanner([], bed_bounds=(100, 100))
    assert planner.route((0, 0), (100, 100)) == [(100, 100)]
    assert planner.distance((0, 0), (100, 100)) == pytest.approx(math.sqrt(20000))
    assert planner.route((0, 0), (0, 0)) == [(0, 0)]
    assert planner.distance((0, 0), (0, 0)) == 0
