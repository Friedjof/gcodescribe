from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from plotter.web.app import create_app


@pytest.fixture
def offline(workspace, monkeypatch):
    for key, value in {
        "OCTOPRINT_URL": "", "OCTOPRINT_API_KEY": "",
        "PRINTER_SERIAL_ENABLED": "false", "PRINTER_USE_SERIAL": "false",
        "PRINTER_DEFAULT_BACKEND": "",
    }.items():
        monkeypatch.setenv(key, value)
    upstream = Mock(side_effect=AssertionError("Setup must not contact an unconfigured OctoPrint"))
    monkeypatch.setattr("plotter.printer.octoprint.OctoPrintClient._request", upstream)
    with TestClient(create_app()) as client:
        yield client, upstream


def test_first_time_setup_reads_and_profile_edits_work_without_a_printer(offline):
    client, upstream = offline
    status = client.get("/api/printer/status")
    assert status.status_code == 200
    assert not status.json()["configured"]
    pages = client.get("/api/pages").json()
    profile_id = pages["project"]["profileId"]
    for path in [
        "/api/printer/backends", "/api/printer/connections", "/api/position", "/api/jobs",
        f"/api/profiles/{profile_id}/calibration-state",
        f"/api/paper?project_id={pages['project']['id']}",
    ]:
        response = client.get(path)
        assert response.status_code == 200, (path, response.text)
    response = client.put(f"/api/profiles/{profile_id}", json={"calibration": {"bed_width": 215}})
    assert response.status_code == 200, response.text
    upstream.assert_not_called()


@pytest.mark.parametrize("path, body", [
    ("home", {}), ("pen", {"down": False}),
    ("raise-pen", {}), ("jog", {"z": 1}),
])
def test_early_motion_explains_missing_printer_instead_of_octoprint_error(offline, path, body):
    client, upstream = offline
    response = client.post("/api/printer/" + path, json=body)
    assert response.status_code == 409, response.text
    assert "Noch kein Drucker eingerichtet" in response.json()["detail"]
    assert "OctoPrint" not in response.text
    upstream.assert_not_called()
