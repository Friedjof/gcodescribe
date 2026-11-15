from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from plotter.printer import factory
from plotter.printer import octoprint as octo
from plotter.services.settings_store import clear_field, patch_saved
from plotter.web.app import create_app


@pytest.fixture
def octoprint_settings(workspace, monkeypatch):
    for key in (
        "OCTOPRINT_URL",
        "OCTOPRINT_API_KEY",
        "OCTOPRINT_VERIFY_SSL",
        "PRINTER_SERIAL_ENABLED",
        "PRINTER_USE_SERIAL",
        "PRINTER_DEFAULT_BACKEND",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(octo, "_status_cache", {})
    calls = []

    def request(client, method, path, **kwargs):
        calls.append((client.base_url, client.api_key, client.verify_ssl, path))
        payload = {
            "/api/version": {"server": "1.11.0", "api": "0.1"},
            "/api/connection": {"current": {"state": "Operational"}},
            "/api/printer": {"state": {"text": "Operational"}},
            "/api/job": {"state": "Operational"},
        }[path]
        return httpx.Response(200, json=payload)

    monkeypatch.setattr(octo.OctoPrintClient, "_request", request)
    return calls


def test_saved_connection_test_and_cached_printer_status_agree(octoprint_settings):
    client = TestClient(create_app())
    assert client.get("/api/printer/status").json()["configured"] is False
    manager = factory.get_printer_client()
    response = client.patch(
        "/api/settings",
        json={
            "settings": {
                "printer.octoprint_url": "https://saved.invalid/",
                "printer.octoprint_api_key": "saved-key",
                "printer.octoprint_verify_ssl": False,
            }
        },
    )
    assert response.status_code == 200
    assert "saved-key" not in response.text
    assert client.get("/api/printer/octoprint/check").json()["ok"] is True
    status = client.get("/api/printer/status").json()
    assert status["configured"] is True
    assert status["online"] is True
    assert status["connection"]["state"] == "Operational"
    assert factory.get_printer_client() is manager
    assert all(
        call[:3] == ("https://saved.invalid", "saved-key", False) for call in octoprint_settings
    )


def test_live_setting_changes_bypass_previous_status_cache(octoprint_settings):
    patch_saved(
        {"printer.octoprint_url": "http://first.invalid", "printer.octoprint_api_key": "first-key"}
    )
    manager = factory.get_printer_client()
    assert manager.status()["online"] is True
    octoprint_settings.clear()
    patch_saved(
        {
            "printer.octoprint_url": "https://second.invalid/",
            "printer.octoprint_api_key": "second-key",
            "printer.octoprint_verify_ssl": False,
        }
    )
    assert manager.status()["url"] == "https://second.invalid"
    assert octoprint_settings
    assert all(
        call[:3] == ("https://second.invalid", "second-key", False) for call in octoprint_settings
    )


def test_cleared_key_disables_cached_printer_and_reset_restores_env(
    octoprint_settings, monkeypatch
):
    monkeypatch.setenv("OCTOPRINT_URL", "http://env.invalid")
    monkeypatch.setenv("OCTOPRINT_API_KEY", "env-key")
    manager = factory.get_printer_client()
    assert manager.status()["online"] is True
    patch_saved({"printer.octoprint_api_key": ""})
    assert manager.status()["configured"] is False
    clear_field("printer", "octoprint_api_key")
    assert manager.status()["online"] is True


def test_explicit_empty_connection_does_not_fall_back_to_env(octoprint_settings, monkeypatch):
    monkeypatch.setenv("OCTOPRINT_URL", "http://env.invalid")
    monkeypatch.setenv("OCTOPRINT_API_KEY", "env-key")
    assert octo.OctoPrintClient(base_url="", api_key="").configured is False
