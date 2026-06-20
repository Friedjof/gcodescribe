from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import plotter.printer.factory as factory
from plotter.position import get_tracker
from plotter.printer.base import PrinterBackend
from plotter.printer.manager import (
    OCTOPRINT,
    SERIAL,
    BackendBusyError,
    BackendUnavailableError,
    PrinterManager,
    load_active,
)


class FakeBackend:
    def __init__(self, *, configured=True, online=True, job_state=None):
        self._configured = configured
        self._online = online
        self._job_state = job_state
        self.calls: list = []

    @property
    def configured(self) -> bool:
        return self._configured

    def status(self) -> dict:
        job = {"state": self._job_state} if self._job_state else None
        return {"configured": self._configured, "online": self._online, "job": job}

    def upload(self, path, *, start=False):
        self.calls.append(("upload", start))
        return {"done": True}

    def job_command(self, command):
        self.calls.append(("job", command))

    def home(self, axes=None):
        self.calls.append(("home", axes))

    def jog(self, x=0.0, y=0.0, z=0.0, speed=None):
        self.calls.append(("jog", x, y, z))

    def gcode(self, commands):
        self.calls.append(("gcode", commands))


def _manager(active=OCTOPRINT, **kw) -> tuple[PrinterManager, FakeBackend, FakeBackend]:
    octo = FakeBackend(**kw.get("octo", {}))
    ser = FakeBackend(**kw.get("ser", {}))
    return PrinterManager({OCTOPRINT: octo, SERIAL: ser}, active), octo, ser


# -- protocol + delegation -------------------------------------------------


def test_manager_is_printer_backend():
    mgr, _, _ = _manager()
    assert isinstance(mgr, PrinterBackend)


def test_delegates_to_active(workspace):
    mgr, octo, ser = _manager(active=OCTOPRINT)
    mgr.home(["x"])
    mgr.jog(1, 2, 0)
    assert octo.calls and not ser.calls
    assert mgr.status()["backend"] == OCTOPRINT


def test_backends_listing(workspace):
    mgr, _, _ = _manager(active=SERIAL, ser={"online": False})
    listing = {b["id"]: b for b in mgr.backends()}
    assert listing[SERIAL]["active"] is True
    assert listing[SERIAL]["online"] is False
    assert listing[OCTOPRINT]["active"] is False
    assert listing[OCTOPRINT]["online"] is True


# -- switching -------------------------------------------------------------


def test_set_active_switches_and_persists(workspace):
    mgr, octo, ser = _manager(active=OCTOPRINT)
    mgr.set_active(SERIAL)
    assert mgr.active_id == SERIAL
    assert load_active() == SERIAL
    mgr.gcode(["G28"])
    assert ser.calls and not octo.calls


def test_set_active_unknown_backend(workspace):
    mgr, _, _ = _manager()
    with pytest.raises(BackendUnavailableError):
        mgr.set_active("ghost")


def test_set_active_blocked_while_printing(workspace):
    mgr, _, _ = _manager(active=OCTOPRINT, octo={"job_state": "Printing"})
    with pytest.raises(BackendBusyError):
        mgr.set_active(SERIAL)
    assert mgr.active_id == OCTOPRINT


def test_switch_invalidates_position(workspace):
    tracker = get_tracker()
    tracker.home(["x", "y", "z"])
    assert tracker.homed
    mgr, _, _ = _manager(active=OCTOPRINT)
    mgr.set_active(SERIAL)
    assert get_tracker().homed is False


def test_leaving_serial_releases_port(workspace):
    mgr, _, _ = _manager(active=SERIAL)
    with patch.object(PrinterManager, "_release_serial") as release:
        mgr.set_active(OCTOPRINT)
    release.assert_called_once()


def test_switch_to_same_backend_is_noop(workspace):
    mgr, _, _ = _manager(active=OCTOPRINT)
    with patch.object(PrinterManager, "_invalidate_position") as inv:
        mgr.set_active(OCTOPRINT)
    inv.assert_not_called()


# -- initial active resolution --------------------------------------------


def test_resolve_persisted_wins(workspace, monkeypatch):
    from plotter.printer.manager import save_active

    save_active(SERIAL)
    monkeypatch.setenv("PRINTER_DEFAULT_BACKEND", OCTOPRINT)
    assert factory._resolve_initial_active({OCTOPRINT: 1, SERIAL: 2}) == SERIAL


def test_resolve_env_default(workspace, monkeypatch):
    monkeypatch.setenv("PRINTER_DEFAULT_BACKEND", SERIAL)
    assert factory._resolve_initial_active({OCTOPRINT: 1, SERIAL: 2}) == SERIAL


def test_resolve_backcompat_use_serial(workspace, monkeypatch):
    monkeypatch.delenv("PRINTER_DEFAULT_BACKEND", raising=False)
    monkeypatch.setenv("PRINTER_USE_SERIAL", "true")
    assert factory._resolve_initial_active({OCTOPRINT: 1, SERIAL: 2}) == SERIAL


def test_serial_enabled_flag(monkeypatch):
    monkeypatch.delenv("PRINTER_USE_SERIAL", raising=False)
    monkeypatch.setenv("PRINTER_SERIAL_ENABLED", "true")
    assert factory.serial_enabled() is True


# -- routes ----------------------------------------------------------------


@pytest.fixture
def client(workspace, cal) -> TestClient:
    from plotter.web.app import app

    return TestClient(app)


def test_backends_endpoint_default(client):
    backends = client.get("/api/printer/backends").json()
    ids = {b["id"] for b in backends}
    assert OCTOPRINT in ids  # serial not enabled by default
    assert SERIAL not in ids


def test_set_backend_unconfigured_returns_400(client):
    r = client.post("/api/printer/backend", json={"id": SERIAL})
    assert r.status_code == 400


def test_set_backend_octoprint_ok(client):
    r = client.post("/api/printer/backend", json={"id": OCTOPRINT})
    assert r.status_code == 200
    assert r.json()["active"] == OCTOPRINT


def test_resume_job_command_does_not_home(client, monkeypatch):
    from plotter.web.routes import printer as printer_routes

    class FakeClient:
        def __init__(self):
            self.commands: list[str] = []

        def job_command(self, command):
            self.commands.append(command)

    class FakeController:
        def __init__(self):
            self.client = FakeClient()
            self.home_calls = 0

        def home(self):
            self.home_calls += 1

    fake = FakeController()
    monkeypatch.setattr(printer_routes, "controller", lambda: fake)

    r = client.post("/api/printer/job", json={"command": "resume"})

    assert r.status_code == 200
    assert fake.home_calls == 0
    assert fake.client.commands == ["resume"]
