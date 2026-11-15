from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from plotter.core.calibration import Calibration
from plotter.core.document import get_document_store
from plotter.core.jobmeta import read_job_meta
from plotter.core.position import PositionTracker
from plotter.core.state import FileStateStore
from plotter.core.storage import jobs_dir
from plotter.printer.octoprint import OctoPrintClient
from plotter.services import PaperService, PrinterController
from plotter.services.profiles import ProfileService


@pytest.fixture
def project_context(workspace, cal, monkeypatch):
    from plotter.web.app import app
    from plotter.web.routes import calibration, paper, printer

    profiles = ProfileService()
    project = get_document_store().create_project("Paper project")["project"]
    profiles.update(project["profileId"], calibration={
        "origin_x": 80, "origin_y": 90, "plot_width": 100, "plot_height": 80,
        "paper_corners": {"bl": [80, 90], "tr": [180, 170]}, "paper_margin": 0,
        "pen_down_z": 2, "pen_up_z": 10, "z_feed": 6,
        "calibration_x": 120, "calibration_y": 130,
    })
    global_profile = profiles.create("Unrelated global profile", calibration={
        "origin_x": 10, "origin_y": 20, "plot_width": 40, "plot_height": 50,
        "pen_down_z": 1, "pen_up_z": 4, "z_feed": 12,
    })
    profiles.activate(global_profile["id"])
    tracker = PositionTracker(FileStateStore(workspace / "test-position"))
    tracker.home(None)
    backend = MagicMock(spec=OctoPrintClient)
    backend.status.return_value = {"online": True, "job": None}
    controller = PrinterController(client=backend, tracker=tracker)
    monkeypatch.setattr(printer, "controller", lambda: controller)
    monkeypatch.setattr(calibration, "printer_controller", lambda: controller)
    monkeypatch.setattr(paper, "paper_service", lambda profile_id=None: PaperService(
        tracker=tracker, profile_id=profile_id,
    ))
    yield TestClient(app), project, profiles, controller
    assert profiles.active_id() == global_profile["id"]
    assert profiles.get(global_profile["id"])["calibration"] == global_profile["calibration"]
    assert Calibration.load().origin_x == 10


@pytest.mark.parametrize("margin", [0, 5])
def test_project_paper_and_calibration_read_the_same_profile(project_context, margin):
    client, project, profiles, _ = project_context
    profiles.update(project["profileId"], calibration={"paper_margin": margin})
    params = {"project_id": project["id"]}
    calibration = client.get("/api/calibration", params=params).json()
    paper = client.get("/api/paper", params=params).json()["calibration"]
    profile = client.get(f"/api/profiles/{project['profileId']}").json()
    assert profile["calibration"] == paper
    assert calibration == paper
    assert (calibration["origin_x"], calibration["origin_y"]) == (80 + margin, 90 + margin)
    assert client.get("/api/calibration").json()["origin_x"] == 10
    assert client.get("/api/paper").json()["calibration"]["origin_x"] == 10


@pytest.mark.parametrize("park_x", [None, 42])
def test_project_paper_edits_preserve_automatic_and_partial_position_defaults(
    project_context, park_x
):
    client, project, profiles, _ = project_context
    profiles.update(project["profileId"], calibration={"park_x": park_x})
    params = {"project_id": project["id"]}
    assert client.put(
        "/api/paper/corner/bl", params=params, json={"x": 82, "y": 91}
    ).status_code == 200
    saved = profiles.get(project["profileId"])["calibration"]
    assert saved["defined_positions"] == ["calibration"]
    assert client.put(
        "/api/calibration", params=params,
        json={"bed_width": 300, "bed_height": 310, "pen_up_z": 12},
    ).status_code == 200
    saved = profiles.get(project["profileId"])["calibration"]
    assert saved["defined_positions"] == ["calibration"]
    assert saved["park_x"] == (150 if park_x is None else park_x)
    assert saved["park_y"] == 310
    assert saved["park_lift_z"] == 12


def test_project_paper_edits_only_persist_its_profile(project_context):
    client, project, profiles, controller = project_context
    params = {"project_id": project["id"]}
    profile_id = project["profileId"]
    assert client.put("/api/calibration", params=params, json={"origin_x": 82}).status_code == 200
    assert profiles.get(profile_id)["calibration"]["origin_x"] == 82
    assert client.put(
        "/api/paper/corner/bl", params=params, json={"x": 84, "y": 92}
    ).status_code == 200
    controller.tracker.set_axes(x=182, y=174)
    assert client.post("/api/paper/corner", params=params, json={"corner": "tr"}).status_code == 200
    result = client.post("/api/paper/apply", params=params, json={"margin": 2, "from_paper": True})
    assert result.status_code == 200
    saved = profiles.get(profile_id)["calibration"]
    assert (saved["origin_x"], saved["origin_y"], saved["plot_width"], saved["plot_height"]) == (
        86, 94, 94, 78,
    )
    obstacle = {"x": 140, "y": 140, "w": 4, "h": 4}
    assert client.put(
        "/api/paper/obstacles", params=params, json={"obstacles": [obstacle]}
    ).status_code == 200
    assert profiles.get(profile_id)["calibration"]["obstacles"] == [obstacle]
    assert client.delete("/api/paper/corner/bl", params=params).status_code == 200
    assert "bl" not in profiles.get(profile_id)["calibration"]["paper_corners"]
    assert client.delete("/api/paper", params=params).status_code == 200
    assert profiles.get(profile_id)["calibration"]["paper_corners"] == {}
    controller.client.gcode.assert_not_called()


def test_project_pen_and_special_position_captures_only_update_its_profile(project_context):
    client, project, profiles, controller = project_context
    controller.tracker.set_axes(x=123, y=134, z=3)
    captured = client.post("/api/calibration/position-from-head", json={
        "kind": "calibration", "projectId": project["id"],
    })
    assert captured.status_code == 200
    assert captured.json()["calibration_x"] == 123
    assert captured.json()["calibration_y"] == 134
    captured = client.post("/api/calibration/pen-from-position", json={
        "which": "down", "projectId": project["id"],
    })
    assert captured.status_code == 200
    saved = profiles.get(project["profileId"])["calibration"]
    assert saved["pen_down_z"] == 3
    assert saved["pen_up_z"] == 10
    assert saved["pen_calibrated"] is True
    controller.client.gcode.assert_not_called()


@pytest.mark.parametrize(("endpoint", "body", "expected_xy", "expected_z"), [
    ("move", {"x": 0, "y": 0, "limit": "plot"}, (80, 90), 10),
    ("jog", {"x": 1000, "y": 1000, "z": 1, "limit": "plot"}, (180, 170), 2),
    ("move-to-corner", {"corner": "tr", "target": "paper"}, (180, 170), 10),
    ("move-to-position", {"kind": "calibration"}, (120, 130), 2),
    ("pen", {"down": False}, (0, 0), 10),
    ("pen", {"down": True}, (0, 0), 2),
])
def test_manual_motion_uses_the_project_shown_in_paper(
    project_context, endpoint, body, expected_xy, expected_z,
):
    client, project, _, controller = project_context
    response = client.post(f"/api/printer/{endpoint}", json={**body, "projectId": project["id"]})
    assert response.status_code == 200
    position = response.json()["position"]
    assert (position["x"], position["y"]) == expected_xy
    assert position["z"] == expected_z
    commands = controller.client.gcode.call_args.args[0]
    assert any(command.endswith("F360") for command in commands if " Z" in command)


def test_project_home_and_visit_use_its_homing_settings(project_context):
    client, project, profiles, controller = project_context
    profiles.update(project["profileId"], calibration={"trust_axis_home": True})
    response = client.post("/api/printer/home", json={"axes": ["x"], "projectId": project["id"]})
    assert response.status_code == 200
    controller.client.home.assert_called_once_with(["x"])
    assert "G0 Z5 F360" in controller.client.gcode.call_args.args[0]
    controller.client.reset_mock()
    response = client.post("/api/printer/home-and-move-to-position", json={
        "kind": "calibration", "projectId": project["id"],
    })
    assert response.status_code == 200
    commands = [
        command for call in controller.client.gcode.call_args_list for command in call.args[0]
    ]
    assert "G0 Z5 F360" in commands
    assert response.json()["position"]["x"] == 120


@pytest.mark.parametrize(("method", "endpoint", "body", "query_context"), [
    ("GET", "paper", None, True),
    ("PUT", "calibration", {"origin_x": 5}, True),
    ("PUT", "paper/corner/bl", {"x": 5, "y": 5}, True),
    ("POST", "calibration/pen-from-position", {"which": "down"}, False),
    ("POST", "printer/move", {"x": 5, "y": 5}, False),
    ("POST", "printer/home", {}, False),
    ("POST", "printer/pen", {"down": True}, False),
    ("POST", "testpattern/frame", {}, True),
])
def test_stale_project_context_rejects_edits_and_motion(
    project_context, method, endpoint, body, query_context,
):
    client, _, _, controller = project_context
    params = {"project_id": "proj-stale"} if query_context else None
    if not query_context:
        body = {**body, "projectId": "proj-stale"}
    response = client.request(method, f"/api/{endpoint}", params=params, json=body)
    assert response.status_code == 409
    controller.client.gcode.assert_not_called()
    controller.client.home.assert_not_called()


def test_project_test_pattern_contains_its_current_profile_and_snapshot(project_context):
    client, project, profiles, controller = project_context
    response = client.post("/api/testpattern/frame", params={"project_id": project["id"]})
    assert response.status_code == 200
    path = jobs_dir() / response.json()["filename"]
    meta = read_job_meta(path)
    profile = profiles.get(project["profileId"])
    assert meta["source"]["project_id"] == project["id"]
    assert meta["profile"]["id"] == profile["id"]
    assert meta["calibrationSnapshot"]["calibration"] == profile["calibration"]
    assert meta["calibrationSnapshot"]["fingerprint"] == profile["fingerprint"]
    assert "X80.000 Y90.000" in path.read_text()
    controller.client.gcode.assert_not_called()
