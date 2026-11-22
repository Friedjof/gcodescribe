from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from plotter.core.position import get_tracker
from plotter.printer.factory import get_printer_client, reset_manager
from plotter.services.settings_store import load_saved, patch_saved
from plotter.web.app import create_app


class Driver:
    def __init__(self, port="", baud=115200, *, key="", verify_ssl=True):
        self.port, self.baud, self.key, self.verify_ssl = port, baud, key, verify_ssl
        self.started = self.closed = 0
        self.state = "Operational"
        self.commands = []

    @property
    def configured(self):
        return bool(self.port)

    def ensure_started(self):
        self.started += 1

    def close(self):
        self.closed += 1

    def status(self):
        return {
            "configured": self.configured,
            "online": self.configured,
            "job": {"state": self.state},
        }

    def gcode(self, commands):
        self.commands.append(commands)


@pytest.fixture
def client(workspace, monkeypatch):
    for key in (
        "OCTOPRINT_URL",
        "OCTOPRINT_API_KEY",
        "PRINTER_SERIAL_ENABLED",
        "PRINTER_USE_SERIAL",
        "PRINTER_DEFAULT_BACKEND",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr("plotter.printer.serial.SerialClient", Driver)
    monkeypatch.setattr(
        "plotter.printer.octoprint.OctoPrintClient",
        lambda url, key, verify_ssl=True: Driver(url, key=key, verify_ssl=verify_ssl),
    )
    return TestClient(create_app())


def add(client, name="Plotter links", port="/dev/left", **kw):
    response = client.post(
        "/api/printer/connections",
        json={"name": name, "transport": "serial", "serial_port": port, **kw},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_two_identical_serial_printers_route_and_persist_selection(client):
    left = add(client)
    right = add(client, "Plotter rechts", "/dev/right")
    manager = get_printer_client()
    assert manager.active_id == left["id"]
    first = manager.active()
    assert first.started == 1
    assert manager.backend(right["id"]).started == 0
    get_tracker().home(None)
    assert client.post("/api/printer/backend", json={"id": right["id"]}).status_code == 200
    assert not get_tracker().homed
    status = client.get("/api/printer/status").json()
    assert (status["backend"], status["printer_id"]) == ("serial", right["id"])
    manager.gcode(["M114"])
    assert manager.active().commands == [["M114"]]
    assert first.commands == [] and first.closed == 1
    reset_manager()
    assert get_printer_client().active_id == right["id"]
    assert get_printer_client().active().port == "/dev/right"


@pytest.mark.parametrize("state", ["Printing", "Paused", "Pausing", "Resuming"])
def test_active_plot_blocks_switch_edit_and_delete(client, state):
    left, right = add(client), add(client, "Rechts", "/dev/right")
    manager = get_printer_client()
    manager.active().state = state
    before = load_saved()
    assert client.post("/api/printer/backend", json={"id": right["id"]}).status_code == 409
    assert (
        client.put(
            "/api/printer/connections/" + left["id"],
            json={"name": "Neu", "transport": "serial", "serial_port": "/dev/changed"},
        ).status_code
        == 409
    )
    assert client.delete("/api/printer/connections/" + left["id"]).status_code == 409
    assert load_saved() == before
    assert manager.active_id == left["id"] and manager.active().closed == 0


def test_inactive_edit_and_add_do_not_interrupt_active_plot(client):
    add(client)
    right = add(client, "Rechts", "/dev/right")
    manager = get_printer_client()
    original = manager.active()
    original.state = "Printing"
    assert (
        client.put(
            "/api/printer/connections/" + right["id"],
            json={
                "name": "Neuer rechter Plotter",
                "transport": "serial",
                "serial_port": "/dev/new",
            },
        ).status_code
        == 200
    )
    add(client, "Dritter", "/dev/third")
    assert get_printer_client().active() is original
    assert original.started == 1 and original.closed == 0
    assert manager.backend(right["id"]).port == "/dev/new"


def test_octoprint_keys_are_separate_redacted_and_preserved_on_edit(client):
    first = add(
        client,
        transport="octoprint",
        octoprint_url="http://left.local",
        octoprint_api_key="first-secret",
    )
    second = add(
        client,
        "Rechts",
        transport="octoprint",
        octoprint_url="http://right.local",
        octoprint_api_key="second-secret",
        octoprint_verify_ssl=False,
    )
    response = client.put(
        "/api/printer/connections/" + second["id"],
        json={
            "name": "Rechts umbenannt",
            "transport": "octoprint",
            "octoprint_url": "http://right.local",
            "octoprint_api_key": "",
            "octoprint_verify_ssl": False,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["octoprint_api_key_configured"] is True
    for path in ("/api/printer/connections", "/api/printer/backends", "/api/settings/effective"):
        text = client.get(path).text
        assert "first-secret" not in text and "second-secret" not in text
    manager = get_printer_client()
    manager.set_active(second["id"])
    assert manager.active().key == "second-secret" and not manager.active().verify_ssl
    manager.set_active(first["id"])
    assert manager.active().key == "first-secret"
    assert manager.status()["backend"] == "octoprint"


def test_original_connection_is_preserved_and_can_be_named(client):
    patch_saved({"printer.serial_enabled": True, "printer.serial_port": "/dev/original"})
    original = get_printer_client().active()
    assert client.get("/api/printer/connections").json()[0]["id"] == "serial"
    response = client.put(
        "/api/printer/connections/serial",
        json={"name": "Mein alter Plotter", "transport": "serial", "serial_port": "/dev/original"},
    )
    assert response.status_code == 200
    assert get_printer_client().active() is original
    listing = client.get("/api/printer/backends").json()
    assert next(item for item in listing if item["id"] == "serial")["name"] == "Mein alter Plotter"
    assert original.closed == 0


def test_delete_selected_falls_back_and_invalidates_position(client):
    first, second = add(client), add(client, "Rechts", "/dev/right")
    manager = get_printer_client()
    manager.set_active(second["id"])
    get_tracker().home(None)
    assert client.delete("/api/printer/connections/" + second["id"]).status_code == 200
    assert get_printer_client().active_id == first["id"]
    assert not get_tracker().homed
    assert client.delete("/api/printer/connections/" + first["id"]).status_code == 200
    assert get_printer_client().status()["configured"] is False


def test_rename_retains_connection_and_dropdown_order(client):
    first, second = add(client), add(client, "Rechts", "/dev/right")
    driver = get_printer_client().active()
    assert (
        client.put(
            "/api/printer/connections/" + first["id"],
            json={"name": "Links neu", "transport": "serial", "serial_port": first["serial_port"]},
        ).status_code
        == 200
    )
    assert [item["id"] for item in client.get("/api/printer/connections").json()] == [
        first["id"],
        second["id"],
    ]
    assert get_printer_client().active() is driver and driver.closed == 0


def test_duplicate_device_alias_is_rejected(client, tmp_path):
    port = tmp_path / "ttyUSB1"
    port.touch()
    alias = tmp_path / "by-id"
    alias.symlink_to(port)
    add(client, port=str(port))
    response = client.post(
        "/api/printer/connections",
        json={"name": "Alias", "transport": "serial", "serial_port": str(alias)},
    )
    assert response.status_code == 400


@pytest.mark.parametrize(
    "data",
    [
        {"name": " ", "transport": "serial", "serial_port": "/dev/x"},
        {"name": "X", "transport": "serial", "serial_port": ""},
        {"name": "X", "transport": "octoprint", "octoprint_url": "file:///tmp/test"},
        {"name": "X", "transport": "octoprint", "octoprint_url": "http://user:pass@host"},
    ],
)
def test_invalid_connections_rejected(client, data):
    assert client.post("/api/printer/connections", json=data).status_code == 422
    assert client.get("/api/printer/connections").json() == []


def test_inactive_usb_reports_presence_without_starting_it(client, tmp_path):
    add(client)
    port = tmp_path / "second-device"
    port.touch()
    second = add(client, "Rechts", str(port))
    listing = client.get("/api/printer/backends").json()
    item = next(item for item in listing if item["id"] == second["id"])
    assert item["available"] is True
    assert get_printer_client().backend(second["id"]).started == 0


def test_reachable_octoprint_with_disconnected_printer_is_not_shown_connected():
    from plotter.printer.manager import PrinterManager

    driver = Driver("http://octopi.local")
    driver.status = lambda: {"configured": True, "online": True, "connection": {"state": "Closed"}}
    manager = PrinterManager(
        {"physical": driver},
        "physical",
        metadata={"physical": {"name": "Plotter", "transport": "octoprint"}},
    )
    try:
        entry = manager.backends()[0]
        assert entry["available"] is True and entry["online"] is False
    finally:
        manager.close()


def test_serial_facades_do_not_report_or_close_another_printers_worker(workspace, monkeypatch):
    from plotter.printer.base import PrinterError
    from plotter.printer.serial import SerialClient, worker

    class Worker:
        def __init__(self, port, baud, transport):
            self.port, self.baud = port, baud
            self.closed = False

        def status(self):
            return {"configured": True, "online": True}

        def shutdown(self):
            self.closed = True

    monkeypatch.setattr(worker, "SerialWorker", Worker)
    worker.reset_worker()
    left, right = SerialClient("/dev/left"), SerialClient("/dev/right")
    try:
        left.ensure_started()
        first = worker.peek_worker()
        assert left.status()["online"]
        assert not right.status()["online"]
        same_port_inactive = SerialClient("/dev/left")
        assert not same_port_inactive.status()["online"]
        same_port_inactive.close()
        assert not first.closed
        right.close()
        assert not first.closed
        with pytest.raises(PrinterError):
            right.ensure_started()
        left.close()
        right.ensure_started()
        assert first.closed and right.status()["online"]
        left.close()
        assert not worker.peek_worker().closed
    finally:
        worker.reset_worker()
