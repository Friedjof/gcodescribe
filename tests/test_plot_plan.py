"""Plan boundaries: exact paths, protected attributes, immutable snapshots and encoding."""
from __future__ import annotations

import copy
import math
from collections import Counter
from dataclasses import FrozenInstanceError, asdict, replace

import pytest

from plotter.artwork.pipeline import PlotterError
from plotter.core.calibration import Calibration
from plotter.gcode.metrics import analyze_gcode
from plotter.gcode.scene import scene_gcode
from plotter.plotplan import PlotStroke, build_scene_plan, clear_plot_plan_cache, encode_plot_plan


def page(lines, **updates):
    return {"id": "test", "continuous": False,
            "objects": [{"id": "drawing", "cachedPolylines": lines}], **updates}


def segments(plan):
    return Counter(tuple(sorted((a, b))) for stroke in plan.strokes
                   for a, b in zip(stroke.points, stroke.points[1:], strict=False))


def test_improved_machine_route_preserves_segments_contacts_and_pen_up_distance():
    source = page([[(10, y), (30, y)] for y in range(10, 190, 10)])
    cal = Calibration(park_x=30, park_y=210)
    baseline = build_scene_plan(source, cal, optimize=False)
    improved = build_scene_plan(source, cal)
    assert segments(improved) == segments(baseline)
    assert len(improved.strokes) == len(baseline.strokes)
    assert improved.report.travel_mm < baseline.report.travel_mm
    assert analyze_gcode(encode_plot_plan(improved)).travel_mm == pytest.approx(
        improved.report.travel_mm, abs=0.051
    )
    assert analyze_gcode(encode_plot_plan(improved)).draw_mm == pytest.approx(
        improved.report.draw_mm, abs=0.051
    )
    assert scene_gcode(source, cal) == encode_plot_plan(improved)


def test_plan_is_snapshot_and_cache_invalidates_geometry_and_calibration():
    clear_plot_plan_cache()
    source = page([[[10, 10], [20, 20]]])
    cal = Calibration(obstacles=[])
    original, original_cal = copy.deepcopy(source), asdict(cal)
    first = build_scene_plan(source, cal)
    assert build_scene_plan(copy.deepcopy(source), copy.deepcopy(cal)) is first
    assert source == original and asdict(cal) == original_cal
    encoded = encode_plot_plan(first)
    source["objects"][0]["cachedPolylines"][0][0][0] = 12
    cal.draw_feed = 40
    first.calibration.draw_feed = 1000
    assert encode_plot_plan(first) == encoded
    assert build_scene_plan(source, Calibration()).plan_id != first.plan_id
    assert build_scene_plan(original, cal).plan_id != first.plan_id
    with pytest.raises(FrozenInstanceError):
        first.strokes = ()
    mutable = [[1, 2], [3, 4]]
    stroke = PlotStroke(mutable, feeds=[1, 1])
    mutable[0][0] = 900
    assert stroke.points == ((1, 2), (3, 4))
    assert stroke.feeds == (1, 1)


def test_public_plan_rejects_travel_that_would_draw_a_different_segment():
    plan = build_scene_plan(page([[(10, 10), (20, 20)]]), Calibration())
    with pytest.raises(ValueError, match="Anfahrt"):
        replace(plan, travels=(((100, 100),),))
    with pytest.raises(ValueError, match="Anfahrt"):
        replace(plan, travels=())
    with pytest.raises(ValueError, match="Parkfahrt"):
        replace(plan, park_path=((20, 20),))
    mutable = [[list(point) for point in path] for path in plan.travels]
    frozen = replace(plan, travels=mutable)
    mutable[0][-1][0] = 999
    assert frozen.travels == plan.travels


def test_cache_keeps_only_bounded_plans_and_does_not_retain_large_source_json(monkeypatch):
    from plotter.plotplan import scene

    clear_plot_plan_cache()
    source = page([[(10, 10), (20, 20)]], notes="x" * 2_100_000)
    first = build_scene_plan(source, Calibration())
    assert build_scene_plan(source, Calibration()) is first
    assert all(len(key) == 64 for key in scene._cache)
    clear_plot_plan_cache()
    monkeypatch.setattr(scene, "_CACHE_BYTE_BUDGET", 1)
    first = build_scene_plan(source, Calibration())
    second = build_scene_plan(source, Calibration())
    assert first == second and first is not second
    assert not scene._cache


def test_cache_evicts_least_recent_plan_without_exceeding_entry_bound(monkeypatch):
    from plotter.plotplan import scene

    clear_plot_plan_cache()
    monkeypatch.setattr(scene, "_CACHE_MAX_PLANS", 2)
    one = page([[(10, 10), (20, 20)]], id="one")
    two = page([[(10, 10), (20, 20)]], id="two")
    three = page([[(10, 10), (20, 20)]], id="three")
    first = build_scene_plan(one, Calibration())
    second = build_scene_plan(two, Calibration())
    assert build_scene_plan(one, Calibration()) is first
    build_scene_plan(three, Calibration())
    assert len(scene._cache) == 2
    assert first.plan_id in scene._cache and second.plan_id not in scene._cache


def test_fixed_pressure_feed_order_and_direction_survive_free_route_optimization():
    source = page([[(10, y), (30, y)] for y in range(10, 100, 10)])
    source["objects"] += [
        {"id": "feed", "cachedPolylines": [[[90, 80], [20, 80], [10, 80]]],
         "cachedFeeds": [[1, 1.4, 0.5]]},
        {"id": "pressure", "cachedPolylines": [[[20, 70], [30, 70], [40, 70]]],
         "data": {"strokeOrder": "source", "pressureEnabled": True,
                  "cachedSegmentPressures": [[0, 1]]}},
    ]
    cal = Calibration(pen_down_z=3, pen_up_z=5, pen_pressure_max_depth=0.5)
    before = build_scene_plan(source, cal, optimize=False)
    after = build_scene_plan(source, cal)
    locked_before = [s for s in before.strokes if s.order_locked]
    locked_after = [s for s in after.strokes if s.order_locked]
    assert locked_before == locked_after
    assert [s.source_group for s in locked_after] == ["feed", "source-order"]
    assert after.report.protected_strokes == 2
    assert segments(after) == segments(before)
    assert after.report.travel_mm <= before.report.travel_mm + 1e-7
    commands = encode_plot_plan(after)
    assert "G1 X25.000 Y125.000 F4200" in commands
    assert "G1 X15.000 Y125.000 F1500" in commands
    assert "G1 X35.000 Y135.000 Z2.750" in commands


def test_zero_length_source_dot_retains_contact_and_pressure():
    source = {"objects": [{"cachedPolylines": [[[30, 30], [30, 30]]],
                           "data": {"strokeOrder": "source"}}]}
    plan = build_scene_plan(source, Calibration())
    assert plan.report.pen_contacts == 1
    assert plan.report.draw_mm == 0
    assert plan.strokes[0].points == ((35, 175), (35, 175))
    assert "G1 X35.000 Y175.000" in encode_plot_plan(plan)


def test_continuous_decision_is_retained_and_reported_not_silently_selected():
    source = page([[(20, 30), (30, 30)], [(30, 30), (40, 30)],
                   [(30, 20), (30, 30)], [(30, 30), (30, 40)]])
    plain = build_scene_plan(source, Calibration())
    continuous = build_scene_plan({**source, "continuous": True}, Calibration())
    assert continuous.report.pen_contacts == 1
    assert plain.report.pen_contacts >= 2
    assert continuous.report.continuous_extra_draw_mm > 0
    assert "continuous_retraces_existing_ink" in continuous.report.diagnostics


def test_bed_edge_obstacle_uses_valid_alternative_in_final_gcode():
    cal = Calibration(origin_x=0, origin_y=0, flip_y=False, park_after_plot=False,
                      obstacles=[{"x": 90, "y": 0, "w": 20, "h": 140}])
    source = page([[(50, 50), (60, 50)], [(150, 50), (160, 50)]])
    plan = build_scene_plan(source, cal)
    assert all(0 <= x <= 210 and 0 <= y <= 210 for path in plan.travels for x, y in path)
    assert any(y > 140 for path in plan.travels for _, y in path)
    encode_plot_plan(plan)  # Final safety check must pass.


@pytest.mark.parametrize("source", [page([]), {"objects": []},
    {"objects": [{"cachedPolylines": [[[10, 10], [20, 20]]], "plotted": True}]}])
def test_empty_or_fully_plotted_pages_are_explicitly_rejected(source):
    with pytest.raises(PlotterError, match="keine ungeplotteten Linien"):
        build_scene_plan(source, Calibration())


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf])
def test_nonfinite_geometry_is_not_silently_removed(value):
    with pytest.raises(PlotterError, match="ungültige"):
        build_scene_plan(page([[(10, 10), (value, 20)]]), Calibration())


def test_obstacle_routes_never_fall_back_to_unsafe_direct_line():
    cal = Calibration(obstacles=[{"x": 90, "y": 0, "w": 20, "h": 210}], flip_y=False)
    with pytest.raises(PlotterError, match="Kein sicherer Leerweg"):
        build_scene_plan(page([[(10, 10), (20, 10)], [(130, 10), (140, 10)]]), cal)
