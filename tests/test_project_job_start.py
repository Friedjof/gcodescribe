from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from plotter.core.calibration import Calibration
from plotter.core.jobmeta import write_job_meta
from plotter.core.storage import jobs_dir
from plotter.printer.octoprint import OctoPrintClient
from plotter.services import PrinterController
from plotter.services.profiles import ProfileService


@pytest.fixture
def selected_project_job(workspace, cal, monkeypatch):
    from plotter.web.app import app
    from plotter.web.routes import printer

    client = TestClient(app)
    index = client.post("/api/projects", json={"name": "Selected project"}).json()
    project = index["project"]
    profiles = ProfileService()
    profiles.update(project["profileId"], calibration={
        "pen_down_z": 2, "pen_up_z": 11, "z_feed": 6,
    })
    page_id = index["activeId"]
    client.put(f"/api/pages/{page_id}", json={"objects": [{
        "id": "line", "type": "line", "cachedPolylines": [[[10, 10], [40, 40]]],
        "transform": {"x": 0, "y": 0, "scale": 1, "rotation": 0},
    }]})
    generated = client.post(f"/api/pages/{page_id}/gcode", json={})
    assert generated.status_code == 200
    filename = generated.json()["filename"]
    global_profile = profiles.create("Global paper", calibration={
        "pen_down_z": 1, "pen_up_z": 4, "z_feed": 12,
    })
    profiles.activate(global_profile["id"])
    controller = MagicMock(spec=PrinterController)
    controller.client = MagicMock(spec=OctoPrintClient)
    controller.status.return_value = {
        "online": True, "job": {"state": "Operational", "job": {"file": {"name": filename}}},
    }
    monkeypatch.setattr(printer, "controller", lambda: controller)
    return client, project, profiles, controller, jobs_dir() / filename


@pytest.mark.parametrize("command", ["start", "restart"])
@pytest.mark.parametrize("file_field", ["name", "path"])
def test_selected_project_job_homes_with_its_calibration(
    selected_project_job, command, file_field,
):
    client, project, profiles, controller, path = selected_project_job
    filename = path.name if file_field == "name" else f"remote-folder/{path.name}"
    controller.status.return_value["job"]["job"]["file"] = {file_field: filename}
    response = client.post("/api/printer/job", json={"command": command})
    assert response.status_code == 200
    controller.home.assert_called_once()
    cal = controller.home.call_args.kwargs["cal"]
    expected = Calibration.from_dict(profiles.get(project["profileId"])["calibration"])
    assert cal == expected
    assert (cal.pen_up_z, cal.pen_down_z, cal.z_feed) == (11, 2, 6)
    controller.client.job_command.assert_called_once_with(command)
    assert [call[0] for call in controller.method_calls] == ["status", "home", "client.job_command"]


@pytest.mark.parametrize("command", ["start", "restart"])
def test_changed_project_calibration_blocks_loaded_job_before_homing(selected_project_job, command):
    client, project, profiles, controller, _ = selected_project_job
    profiles.update(project["profileId"], calibration={"origin_x": 30})
    response = client.post("/api/printer/job", json={"command": command})
    assert response.status_code == 409
    assert "älteren Projektkalibrierung" in response.json()["detail"]
    controller.home.assert_not_called()
    controller.client.job_command.assert_not_called()


@pytest.mark.parametrize("unknown", ["no-job", "no-file", "file-missing"])
def test_unknown_selected_job_requires_sending_it_again(selected_project_job, unknown):
    client, _, _, controller, path = selected_project_job
    if unknown == "no-job":
        controller.status.return_value = {"online": True, "job": None}
    elif unknown == "no-file":
        controller.status.return_value["job"]["job"]["file"] = {"name": None, "path": None}
    else:
        path.unlink()
    response = client.post("/api/printer/job", json={"command": "start"})
    assert response.status_code == 409
    assert "Designer" in response.json()["detail"]
    assert "neu senden" in response.json()["detail"]
    controller.home.assert_not_called()
    controller.client.job_command.assert_not_called()


def test_selected_job_is_checked_for_unsafe_gcode(selected_project_job):
    client, _, _, controller, path = selected_project_job
    path.write_text("G21\nG90\nG28\n")
    response = client.post("/api/printer/job", json={"command": "start"})
    assert response.status_code == 422
    assert "Homing im Job" in response.json()["detail"]
    controller.home.assert_not_called()
    controller.client.job_command.assert_not_called()


def test_selected_standard_job_uses_the_same_profile_guard_as_send(selected_project_job):
    client, _, profiles, controller, path = selected_project_job
    path.write_text("G21\nG90\nG0 Z4.000 F600\n")
    write_job_meta(path)
    current = Calibration.from_dict(profiles.active()["calibration"])
    response = client.post("/api/printer/job", json={"command": "start"})
    assert response.status_code == 200
    assert controller.home.call_args.kwargs["cal"] == current
    controller.reset_mock()
    profiles.update(profiles.active_id(), calibration={"pen_down_z": 1.2})
    response = client.post("/api/printer/job", json={"command": "restart"})
    assert response.status_code == 409
    controller.home.assert_not_called()
    controller.client.job_command.assert_not_called()


@pytest.mark.parametrize("command", ["pause", "resume", "cancel"])
def test_running_job_commands_do_not_revalidate_or_home(selected_project_job, command):
    client, project, profiles, controller, path = selected_project_job
    profiles.update(project["profileId"], calibration={"pen_down_z": 3})
    path.unlink()
    response = client.post("/api/printer/job", json={"command": command})
    assert response.status_code == 200
    controller.status.assert_not_called()
    controller.home.assert_not_called()
    controller.client.job_command.assert_called_once_with(command)
