from __future__ import annotations

from unittest.mock import Mock

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
    calls = []

    def request(client, method, path, **kwargs):
        calls.append((client.base_url, client.api_key, client.verify_ssl, path))
        if getattr(client, "test_offline", False):
            raise octo.OctoPrintError("Printer unreachable")
        payload = {
            "/api/version": {"server": "1.11.0", "api": "0.1"},
            "/api/connection": {"current": {"state": "Operational"}},
            "/api/printer": {"state": {"text": "Operational"}},
            "/api/job": {"state": getattr(client, "test_job_state", "Operational")},
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
    assert factory.get_printer_client() is manager
    # The old connection is checked freshly before it is replaced.
    assert octoprint_settings[-1] == ("http://first.invalid", "first-key", True, "/api/job")
    octoprint_settings.clear()
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
    assert factory.get_printer_client() is manager
    assert manager.status()["configured"] is False
    clear_field("printer", "octoprint_api_key")
    assert factory.get_printer_client() is manager
    assert manager.status()["online"] is True


def test_explicit_empty_connection_does_not_fall_back_to_env(octoprint_settings, monkeypatch):
    monkeypatch.setenv("OCTOPRINT_URL", "http://env.invalid")
    monkeypatch.setenv("OCTOPRINT_API_KEY", "env-key")
    assert octo.OctoPrintClient(base_url="", api_key="").configured is False


@pytest.mark.parametrize("state", ["Printing", "Starting", "Paused", "Pausing", "Resuming",
                                   "Finishing", "Cancelling"])
def test_connection_edits_wait_for_octoprint_job_using_fresh_state(octoprint_settings, state):
    patch_saved({"printer.octoprint_url": "http://original.invalid",
                 "printer.octoprint_api_key": "original-key"})
    manager = factory.get_printer_client()
    original = manager.active()
    assert manager.status()["job"]["state"] == "Operational"  # seed the UI cache
    original.test_job_state = state
    patch_saved({"printer.octoprint_url": "http://replacement.invalid",
                 "printer.octoprint_api_key": "replacement-key"})
    assert factory.get_printer_client() is manager
    assert manager.active() is original
    assert manager.active().api_key == "original-key"
    # The explicit diagnostic may test the new saved credentials while the
    # live controller remains on the original printer until its job ends.
    response = TestClient(create_app()).get("/api/printer/octoprint/check")
    assert response.json()["ok"] is True
    assert octoprint_settings[-1][:2] == ("http://replacement.invalid", "replacement-key")
    manager.job_command("cancel")
    assert octoprint_settings[-1][:2] == ("http://original.invalid", "original-key")
    original.test_job_state = "Operational"
    assert factory.get_printer_client() is manager
    assert manager.active() is not original
    assert manager.status()["url"] == "http://replacement.invalid"


def test_disconnection_does_not_unlock_a_known_octoprint_job(octoprint_settings):
    patch_saved({"printer.octoprint_url": "http://original.invalid",
                 "printer.octoprint_api_key": "original-key"})
    manager = factory.get_printer_client()
    original = manager.active()
    original.test_job_state = "Printing"
    assert manager.status()["job"]["state"] == "Printing"
    original.test_offline = True
    patch_saved({"printer.octoprint_url": "http://replacement.invalid"})
    assert factory.get_printer_client().active() is original
    assert manager.status()["online"] is False
    original.test_offline = False
    original.test_job_state = "Operational"
    assert factory.get_printer_client().active() is not original


def test_unreachable_idle_connection_can_be_corrected(octoprint_settings):
    patch_saved({"printer.octoprint_url": "http://bad.invalid",
                 "printer.octoprint_api_key": "original-key"})
    manager = factory.get_printer_client()
    manager.active().test_offline = True
    patch_saved({"printer.octoprint_url": "http://corrected.invalid"})
    assert factory.get_printer_client().status()["url"] == "http://corrected.invalid"


def test_drivers_do_not_read_settings_or_environment(workspace, monkeypatch):
    from plotter.printer.serial import SerialClient
    from plotter.services import settings_store

    def unexpected_read():
        pytest.fail("A driver must not read persisted settings")

    monkeypatch.setattr(settings_store, "load_saved", unexpected_read)
    monkeypatch.setenv("OCTOPRINT_URL", "http://environment.invalid")
    monkeypatch.setenv("OCTOPRINT_API_KEY", "environment-key")
    client = octo.OctoPrintClient("http://explicit.invalid/", "explicit-key", verify_ssl=False)
    serial = SerialClient(port="/dev/explicit", baud=250000)
    assert client.configured and serial.configured
    assert (client.base_url, client.api_key, client.verify_ssl) == (
        "http://explicit.invalid", "explicit-key", False,
    )
    assert (serial.port, serial.baud) == ("/dev/explicit", 250000)
    assert octo.OctoPrintClient().configured is False


def test_octoprint_connection_pool_is_reused_and_released(monkeypatch):
    constructor = Mock(side_effect=[Mock(), Mock()])
    monkeypatch.setattr(httpx, "Client", constructor)
    client = octo.OctoPrintClient("https://printer.invalid", "test-key", verify_ssl=False)
    first = client._client()
    assert client._client() is first
    constructor.assert_called_once()
    assert constructor.call_args.kwargs["verify"] is False
    client.close()
    first.close.assert_called_once()
    client.close()
    first.close.assert_called_once()
    assert client._client() is not first
    client.close()
