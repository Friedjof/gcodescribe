from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from plotter.artwork.export import calibration_from_xml, calibration_to_xml
from plotter.core.calibration import Calibration
from plotter.core.position import PositionTracker
from plotter.core.state import FileStateStore
from plotter.services import PaperService, ServiceError
from plotter.services.profiles import ProfileService


def _area(cal: Calibration) -> tuple[float, float, float, float]:
    return cal.origin_x, cal.origin_y, cal.plot_width, cal.plot_height


def test_legacy_basis_comes_from_effective_area_and_previous_margin():
    cal = Calibration(origin_x=30, origin_y=40, plot_width=150, plot_height=130, paper_margin=5)
    assert cal.base_plot_area() == (25, 35, 160, 140)
    assert _area(cal.merged({"paper_margin": 0})) == (25, 35, 160, 140)


def test_margin_roundtrip_and_repeated_apply_do_not_accumulate():
    cal = Calibration(origin_x=25, origin_y=35, plot_width=160, plot_height=140)
    first = cal.merged({"paper_margin": 5})
    assert _area(first) == (30, 40, 150, 130)
    zero = first.merged({"paper_margin": 0})
    assert _area(zero) == (25, 35, 160, 140)
    again = zero.merged({"paper_margin": 5})
    assert _area(again) == _area(first)
    assert _area(again.merged({"paper_margin": 5})) == _area(first)
    assert again.base_plot_area() == (25, 35, 160, 140)


def test_explicit_basis_updates_effective_area_and_direct_edits_recover_a_new_basis():
    cal = Calibration(paper_margin=5).merged({
        "plot_area_base": {"x": 25, "y": 35, "w": 160, "h": 140},
    })
    assert _area(cal) == (30, 40, 150, 130)
    edited = cal.merged({"origin_x": 40, "plot_width": 120})
    assert _area(edited) == (40, 40, 120, 130)
    assert edited.base_plot_area() == (35, 35, 130, 140)
    assert _area(edited.merged({"paper_margin": 0})) == (35, 35, 130, 140)
    assert _area(edited.merged({"paper_margin": 5})) == _area(edited)


def test_paper_corner_changes_never_replace_the_manual_basis(workspace):
    cal = Calibration(origin_x=25, origin_y=35, plot_width=160, plot_height=140)
    cal.save()
    tracker = PositionTracker(FileStateStore(workspace / "paper-position"))
    tracker.home(None)
    service = PaperService(tracker=tracker)
    service.set_corner_at("bl", 0, 0)
    tracker.set_axes(x=210, y=200)
    service.capture("tr")
    assert _area(Calibration.load()) == (25, 35, 160, 140)
    assert Calibration.load().base_plot_area() == (25, 35, 160, 140)
    service.apply(5)
    assert _area(Calibration.load()) == (30, 40, 150, 130)
    service.apply(0)
    assert _area(Calibration.load()) == (25, 35, 160, 140)
    service.apply(5)
    service.apply(5)
    assert _area(Calibration.load()) == (30, 40, 150, 130)
    service.clear("bl")
    service.reset()
    assert _area(Calibration.load()) == (30, 40, 150, 130)
    assert Calibration.load().base_plot_area() == (25, 35, 160, 140)


def test_only_explicit_paper_adoption_replaces_the_general_plot_area(workspace):
    Calibration(origin_x=25, origin_y=35, plot_width=160, plot_height=140,
                paper_corners={"bl": [0, 0], "tr": [210, 200]}).save()
    service = PaperService()
    service.apply(0)
    assert _area(Calibration.load()) == (25, 35, 160, 140)
    service.apply(5, from_paper=True)
    assert _area(Calibration.load()) == (5, 5, 200, 190)
    assert Calibration.load().base_plot_area() == (0, 0, 210, 200)
    service.apply(0)
    assert _area(Calibration.load()) == (0, 0, 210, 200)


def test_manual_margin_works_without_paper_corners(workspace):
    Calibration(origin_x=25, origin_y=35, plot_width=160, plot_height=140).save()
    service = PaperService()
    service.apply(5)
    assert _area(Calibration.load()) == (30, 40, 150, 130)
    with pytest.raises(ServiceError, match="gegenüberliegende Ecken"):
        service.apply(5, from_paper=True)


def test_project_margin_uses_its_manual_basis_without_switching_global_profile(workspace, cal):
    from plotter.web.app import app

    client = TestClient(app)
    index = client.post("/api/projects", json={"name": "Manual area"}).json()
    project = index["project"]
    profiles = ProfileService()
    profiles.update(project["profileId"], calibration={
        "origin_x": 25, "origin_y": 35, "plot_width": 160, "plot_height": 140,
        "paper_margin": 0, "paper_corners": {"bl": [0, 0], "tr": [210, 210]},
    })
    active_id = profiles.active_id()
    before = Calibration.load()
    params = {"project_id": project["id"]}
    for margin, expected in [(5, (30, 40, 150, 130)), (0, (25, 35, 160, 140)),
                             (5, (30, 40, 150, 130))]:
        result = client.post("/api/paper/apply", params=params, json={"margin": margin})
        assert result.status_code == 200
        assert _area(Calibration.from_dict(result.json()["calibration"])) == expected
    assert profiles.active_id() == active_id
    assert Calibration.load() == before


@pytest.mark.parametrize("updates", [
    {"plot_area_base": {"x": 0, "y": 0, "w": -1, "h": 20}},
    {"plot_area_base": {"x": 0, "y": 0, "w": 20}},
    {"plot_area_base": [0, 0, 20, 20]},
    {"paper_margin": -1},
    {"paper_margin": 500},
])
def test_invalid_basis_or_margin_is_rejected_without_saving(workspace, cal, updates):
    from plotter.web.app import app

    before = Calibration.load()
    response = TestClient(app).put("/api/calibration", json=updates)
    assert response.status_code == 422
    assert Calibration.load() == before


def test_explicit_basis_survives_xml_roundtrip():
    cal = Calibration().merged({
        "plot_area_base": {"x": 25, "y": 35, "w": 160, "h": 140}, "paper_margin": 5,
    })
    restored = calibration_from_xml(calibration_to_xml(cal))
    assert restored.plot_area_base == cal.plot_area_base
    assert restored.base_plot_area() == (25, 35, 160, 140)
    assert _area(restored) == _area(cal)
    assert _area(restored.merged({"paper_margin": 0})) == (25, 35, 160, 140)
