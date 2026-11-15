from __future__ import annotations

from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from plotter.printer import factory
from plotter.printer.manager import PrinterManager
from plotter.printer.serial import SerialClient
from plotter.services.settings_store import patch_saved
from plotter.web.app import create_app


@pytest.fixture
def serial_settings(workspace, monkeypatch):
    for key in (
        "OCTOPRINT_URL",
        "OCTOPRINT_API_KEY",
        "PRINTER_SERIAL_ENABLED",
        "PRINTER_USE_SERIAL",
        "PRINTER_DEFAULT_BACKEND",
        "PRINTER_SERIAL_PORT",
        "PRINTER_SERIAL_BAUD",
    ):
        monkeypatch.delenv(key, raising=False)

    class FakeSerial:
        def __init__(self, port=None, baud=None):
            self.port, self.baud = port, baud
            self.state = "Operational"
            self.started = 0

        @property
        def configured(self):
            return bool(self.port)

        def ensure_started(self):
            self.started += 1

        def status(self):
            return {
                "configured": self.configured,
                "online": True,
                "port": self.port,
                "baud": self.baud,
                "job": {"state": self.state},
            }

    monkeypatch.setattr("plotter.printer.serial.SerialClient", FakeSerial)
    release = Mock()
    monkeypatch.setattr(PrinterManager, "_release_serial", release)
    return release


def test_saved_serial_settings_activate_existing_unconfigured_controller(serial_settings):
    client = TestClient(create_app())
    assert client.get("/api/printer/status").json()["configured"] is False
    response = client.patch(
        "/api/settings",
        json={
            "settings": {
                "printer.serial_enabled": True,
                "printer.serial_port": "/dev/serial/by-id/plotter",
                "printer.serial_baud": 250000,
            }
        },
    )
    assert response.status_code == 200
    status = client.get("/api/printer/status").json()
    assert status["backend"] == "serial"
    assert status["configured"] is True
    assert status["online"] is True
    assert status["port"] == "/dev/serial/by-id/plotter"
    assert status["baud"] == 250000
    assert factory.get_printer_client().active().started == 1


def test_saved_serial_defaults_are_used_after_restart(serial_settings):
    patch_saved(
        {
            "printer.serial_enabled": True,
            "printer.default_backend": "serial",
            "printer.serial_port": "/dev/ttyACM3",
            "printer.serial_baud": 250000,
        }
    )
    assert factory.serial_enabled() is True
    assert factory.use_serial() is True
    assert factory.get_printer_client().active_id == "serial"
    assert factory.get_printer_client().status()["port"] == "/dev/ttyACM3"


@pytest.mark.parametrize("state", ["Printing", "Paused", "Pausing", "Resuming"])
def test_live_serial_edits_wait_for_active_job_to_end(serial_settings, state):
    patch_saved({"printer.serial_enabled": True, "printer.serial_port": "/dev/ttyACM1"})
    manager = factory.get_printer_client()
    manager.active().state = state
    serial_settings.reset_mock()
    patch_saved({"printer.serial_port": "/dev/ttyACM2", "printer.serial_baud": 250000})
    assert factory.get_printer_client() is manager
    assert manager.status()["port"] == "/dev/ttyACM1"
    serial_settings.assert_not_called()
    manager.active().state = "Operational"
    replacement = factory.get_printer_client()
    assert replacement.status()["port"] == "/dev/ttyACM2"
    assert replacement.status()["baud"] == 250000
    serial_settings.assert_called_once()


def test_disabling_serial_does_not_disconnect_a_paused_job(serial_settings):
    patch_saved({"printer.serial_enabled": True})
    manager = factory.get_printer_client()
    manager.active().state = "Paused"
    serial_settings.reset_mock()
    patch_saved({"printer.serial_enabled": False})
    assert factory.get_printer_client() is manager
    serial_settings.assert_not_called()
    manager.active().state = "Operational"
    assert factory.get_printer_client().active_id == "octoprint"
    serial_settings.assert_called_once()


def test_octoprint_edits_do_not_reset_serial_worker(serial_settings):
    patch_saved({"printer.serial_enabled": True})
    manager = factory.get_printer_client()
    serial_settings.reset_mock()
    patch_saved(
        {"printer.octoprint_url": "http://other.invalid", "printer.octoprint_api_key": "other-key"}
    )
    assert factory.get_printer_client() is manager
    assert manager.active().started == 1
    serial_settings.assert_not_called()


def test_saved_serial_disable_overrides_environment(serial_settings, monkeypatch):
    monkeypatch.setenv("PRINTER_SERIAL_ENABLED", "true")
    patch_saved({"printer.serial_enabled": False})
    assert factory.serial_enabled() is False
    assert [b["id"] for b in factory.get_printer_client().backends()] == ["octoprint"]


def test_serial_client_uses_saved_port_and_baud_without_opening_port(serial_settings):
    patch_saved({"printer.serial_port": "/dev/ttyACM7", "printer.serial_baud": 250000})
    client = SerialClient()
    assert (client.port, client.baud) == ("/dev/ttyACM7", 250000)
    explicit = SerialClient(port="", baud=57600)
    assert explicit.configured is False
    assert explicit.baud == 57600


def test_worker_defaults_use_saved_connection(serial_settings, monkeypatch):
    from plotter.printer.serial import worker

    patch_saved({"printer.serial_port": "/dev/ttyACM8", "printer.serial_baud": 250000})
    constructor = Mock()
    monkeypatch.setattr(worker, "SerialWorker", constructor)
    monkeypatch.setattr(worker, "_worker", None)
    assert worker.get_worker() is constructor.return_value
    constructor.assert_called_once_with("/dev/ttyACM8", 250000, None)
