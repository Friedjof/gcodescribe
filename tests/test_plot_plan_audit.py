"""The corpus auditor must expose omissions and regressions, not just render files."""

from __future__ import annotations

import json
from dataclasses import dataclass

import pytest

from scripts.audit_plot_plans import (
    compare_plans,
    digest,
    gcode_facts,
    load_source,
    main,
    plotted_variants,
    summarize,
    unchanged,
)


def store(root, index, pages, profiles):
    (root / "state").mkdir()
    (root / "profiles").mkdir()
    (root / "state" / "paint_index.json").write_text(json.dumps(index))
    for name, page in pages.items():
        (root / "state" / f"paint_page_{name}.json").write_text(json.dumps(page))
    for name, profile in profiles.items():
        (root / "profiles" / f"{name}.json").write_text(json.dumps(profile))


def test_inventory_includes_archived_missing_and_orphan_slides_without_migration(tmp_path):
    index = {"order": [{"id": "p1"}, {"id": "missing"}], "projects": [
        {"id": "project", "profileId": "current", "archived": True},
    ]}
    pages = {
        "p1": {"id": "p1", "projectId": "project", "profileId": "old", "objects": []},
        "orphan": {"id": "orphan", "profileId": "old", "objects": []},
        "deleted": {},
        "before_projects_p1": {"id": "p1", "objects": []},
    }
    profiles = {
        "old": {"id": "old", "calibration": {"origin_x": 1}},
        "current": {"id": "current", "calibration": {"origin_x": 17}, "archived": True},
        "active": {"active_id": "old"},
    }
    store(tmp_path, index, pages, profiles)
    cases, inventory, hashes = load_source("sample", tmp_path)
    assert len(cases) == 3
    assert cases[0]["profile"]["calibration"]["origin_x"] == 17
    assert cases[0]["project_archived"] and cases[0]["profile_archived"]
    assert cases[1]["page"] is None
    assert not cases[2]["indexed"]
    assert inventory["tombstones"] == inventory["migration_backups"] == 1
    assert inventory["missing_page_files"] == inventory["unindexed_live_slides"] == 1
    assert unchanged(hashes)
    assert not (tmp_path / "state" / "paint_index_before_projects.json").exists()
    (tmp_path / "state" / "paint_page_orphan.json").write_text("{}")
    assert not unchanged(hashes)


def test_legacy_slide_never_silently_uses_active_profile(tmp_path):
    store(tmp_path, {"order": [{"id": "p1"}]}, {"p1": {"id": "p1"}}, {
        "active": {"active_id": "active-profile"},
        "active-profile": {"id": "active-profile", "calibration": {}},
    })
    cases, _, _ = load_source("legacy", tmp_path)
    assert cases[0]["profile"] is None


def test_mismatched_page_filename_is_not_counted_as_valid(tmp_path):
    store(tmp_path, {"order": []}, {"wrong": {"id": "different"}}, {})
    with pytest.raises(ValueError, match="does not match"):
        load_source("invalid", tmp_path)


def test_complete_variants_preserve_original_plotted_flags():
    case = {"key": "sample/001", "page": {"objects": [
        {"plotted": True, "cachedPolylines": [[[1, 2], [3, 4]]]},
        {"plotted": False, "cachedPolylines": [[[5, 6], [7, 8]]]},
    ]}, "profile": {"calibration": {}}}
    before = digest(case)
    variants = plotted_variants([case, {**case, "page": {"objects": []}}])
    assert len(variants) == 1
    assert variants[0]["key"] == "sample/001/all-objects"
    assert not any(obj["plotted"] for obj in variants[0]["page"]["objects"])
    assert digest(case) == before


@dataclass(frozen=True)
class Stroke:
    points: tuple = ((1, 1), (2, 1))
    feeds: tuple | None = None
    pressures: tuple | None = None
    order_locked: bool = False
    source_group: str = "normal"


@dataclass(frozen=True)
class Plan:
    strokes: tuple = (Stroke(),)


def test_reversed_normal_geometry_is_equal_but_longer_rounded_travel_is_reported():
    before = "G0 Z5 F100\nG0 X1 Y0\nG1 Z0\nG1 X2 Y0 F200\nG0 Z5\n"
    after = "G0 Z5 F100\nG0 X2 Y0\nG1 Z0\nG1 X1 Y0 F200\nG0 Z5\n"
    result = compare_plans(Plan(), Plan(), before, after)
    assert result["draw_segments_preserved"]
    assert result["failures"] == ["rounded_gcode_travel_regressed"]
    assert result["travel_saved_mm"] == -1


@pytest.mark.parametrize("changed", [
    "G1 X2.001 Y0 F200",  # Shape changes after output rounding.
    "G1 X2 Y0 F201",      # Same geometry but a different physical feed.
    "G1 X2 Y0 Z0.2 F200", # Pressure/Z movement changes.
])
def test_auditor_catches_changed_geometry_feed_and_pressure(changed):
    prefix = "G0 Z5 F100\nG0 X1 Y0\nG1 Z0\n"
    result = compare_plans(Plan(), Plan(), prefix + "G1 X2 Y0 F200", prefix + changed)
    assert "drawn_segments_or_feeds_changed" in result["failures"]


def test_zero_length_marks_and_multiplicity_are_not_lost_in_signature():
    code = "G0 Z5\nG0 X1 Y0\nG1 Z0\nG1 X1 Y0 F200\n"
    assert gcode_facts(code)["draw_segment_count"] == 1
    assert (gcode_facts(code)["draw_segment_digest"]
            != gcode_facts(code + "G1 X1 Y0\n")["draw_segment_digest"])


def test_protected_sequence_cannot_change_even_when_segment_multiset_is_equal():
    first = Stroke(points=((1, 1), (2, 1)), order_locked=True, source_group="source-order")
    second = Stroke(points=((5, 1), (6, 1)), order_locked=True, source_group="source-order")
    result = compare_plans(Plan((first, second)), Plan((second, first)), "", "")
    assert result["failures"] == ["protected_stroke_sequence_changed"]


def test_modal_feed_omission_keeps_motion_signature():
    explicit = "G0 Z5 F100\nG0 X1 Y0 F100\nG1 Z0 F100\nG1 X2 Y0 F200\nG1 X3 Y0 F200"
    modal = "G0 Z5 F100\nG0 X1 Y0\nG1 Z0\nG1 X2 Y0 F200\nG1 X3 Y0"
    assert gcode_facts(explicit) == gcode_facts(modal)


def test_extra_encoded_contact_is_detected_even_with_identical_plan_and_xy_segments():
    before = "G0 Z5 F100\nG0 X1 Y0\nG1 Z0\nG1 X2 Y0 F200\nG0 Z5\n"
    after = before + "G1 Z0 F100\nG0 Z5\n"
    result = compare_plans(Plan(), Plan(), before, after)
    assert result["draw_segments_preserved"]
    assert result["failures"] == ["encoded_contact_count_changed"]
    assert result["baseline"]["pen_contacts"] == 1
    assert result["optimized"]["pen_contacts"] == 2


@pytest.mark.parametrize("missing_profile", [True, False])
def test_cli_fails_on_missing_context_or_invalid_geometry_without_baseline(
    tmp_path, monkeypatch, missing_profile,
):
    source = tmp_path / "source"
    source.mkdir()
    profile = {"id": "profile", "calibration": {}}
    page = {"id": "p1", "profileId": "profile", "objects": [{
        "id": "bad", "cachedPolylines": [[[0, 0], [1000, 1000]]],
    }]}
    store(source, {"order": [{"id": "p1"}]}, {"p1": page},
          {} if missing_profile else {"profile": profile})
    report = tmp_path / "report.json"
    monkeypatch.setattr("sys.argv", ["audit", "--source", f"test={source}",
                                     "--output", str(report)])
    assert main() == 1
    result = json.loads(report.read_text())
    assert result["complete"] and result["inputs_unchanged"]
    assert result["cases"][0]["status"] == ("missing_context" if missing_profile else "rejected")


def test_summary_weights_real_distance_and_does_not_double_count_complete_variants():
    def case(before, after, *, variant=None):
        return {
            "source": "sample", "variant": variant,
            "comparison": {
                "baseline": {"travel_mm_exact": before},
                "optimized": {"travel_mm_exact": after},
                "travel_saved_mm": before - after,
                "travel_saved_percent": 100 * (before - after) / before,
                "failures": [], "draw_segments_preserved": True,
                "protected_sequence_preserved": True,
            },
            "optimize_and_encode_s": 0.5,
            "report": {"protected_strokes": 1, "continuous_extra_draw_mm": 2.0},
        }
    result = summarize([
        case(100, 90), case(10, 5), case(100, 50, variant="all_objects_on_copy"),
        {"source": "sample", "status": "empty"},
    ])
    ordinary = result["ordinary_slides"]
    assert ordinary["cases"] == 3 and ordinary["compared"] == 2
    assert ordinary["saved_travel_mm"] == 15
    assert ordinary["weighted_saved_percent"] == pytest.approx(100 * 15 / 110)
    assert ordinary["median_slide_saved_percent"] == 30
    assert result["complete_copy_variants"]["saved_travel_mm"] == 50
