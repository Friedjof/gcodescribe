from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from dataclasses import replace
from unittest.mock import Mock, patch

import pytest
from fastapi.testclient import TestClient

import plotter.printer.factory as factory
from plotter.core.config import load_settings
from plotter.core.position import get_tracker
from plotter.printer.base import PrinterBackend, PrinterError
from plotter.printer.manager import (
    OCTOPRINT,
    SERIAL,
    BackendBusyError,
    BackendUnavailableError,
    PrinterManager,
)
from plotter.services.settings_store import load_active_backend, save_active_backend


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

    def close(self):
        self.calls.append(("close",))


def _manager(active=OCTOPRINT, **kw) -> tuple[PrinterManager, FakeBackend, FakeBackend]:
    octo = FakeBackend(**kw.get("octo", {}))
    ser = FakeBackend(**kw.get("ser", {}))
    return PrinterManager(
        {OCTOPRINT: octo, SERIAL: ser}, active,
        on_selection=save_active_backend,
        on_connection_changed=kw.get("on_connection_changed", get_tracker().invalidate),
    ), octo, ser


# -- protocol + delegation -------------------------------------------------


def test_manager_is_printer_backend():
    mgr, _, _ = _manager()
    assert isinstance(mgr, PrinterBackend)


@pytest.mark.parametrize("named", [False, True])
@pytest.mark.parametrize("state, expected", [
    ("Closed", False), ("Offline", False), ("Error", False),
    ("Connecting", False), ("Operational", True),
])
def test_octoprint_server_reachability_does_not_enable_disconnected_printer(named, state, expected):
    backend = FakeBackend()
    backend.status = lambda: {
        "configured": True, "online": True, "connection": {"state": state},
    }
    bid = "named-printer" if named else OCTOPRINT
    manager = PrinterManager(
        {bid: backend}, bid,
        metadata={bid: {"transport": OCTOPRINT}} if named else None,
    )
    assert manager.status()["online"] is expected
    assert manager.backends()[0]["online"] is expected


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
    assert load_active_backend() == SERIAL
    mgr.gcode(["G28"])
    assert ser.calls == [("gcode", ["G28"])]
    assert octo.calls == [("close",)]


def test_set_active_unknown_backend(workspace):
    mgr, _, _ = _manager()
    with pytest.raises(BackendUnavailableError):
        mgr.set_active("ghost")


def test_set_active_blocked_while_printing(workspace):
    mgr, _, _ = _manager(active=OCTOPRINT, octo={"job_state": "Printing"})
    with pytest.raises(BackendBusyError):
        mgr.set_active(SERIAL)
    assert mgr.active_id == OCTOPRINT


@pytest.mark.parametrize("path, body", [
    ("/api/printer/home", {}),
    ("/api/printer/pen", {"down": False}),
    ("/api/printer/jog", {"z": 5}),
    ("/api/printer/move", {"x": 1, "y": 2}),
    ("/api/printer/gcode", {"commands": ["G1 Z30"]}),
    ("/api/printer/job", {"command": "start"}),
])
def test_motion_routes_refuse_running_print_before_sending_commands(workspace, path, body):
    from plotter.services.printer import PrinterController
    from plotter.web.app import app

    backend = FakeBackend(job_state="Printing")
    ctrl = PrinterController(client=backend)
    with patch("plotter.web.routes.printer.controller", return_value=ctrl):
        response = TestClient(app).post(path, json=body)
    assert response.status_code == 409
    assert backend.calls == []


def test_switch_invalidates_position(workspace):
    tracker = get_tracker()
    tracker.home(["x", "y", "z"])
    assert tracker.homed
    mgr, _, _ = _manager(active=OCTOPRINT)
    mgr.set_active(SERIAL)
    assert get_tracker().homed is False


def test_leaving_serial_releases_port(workspace):
    mgr, _, serial = _manager(active=SERIAL)
    mgr.set_active(OCTOPRINT)
    assert serial.calls == [("close",)]


def test_switch_to_same_backend_is_noop(workspace):
    inv = Mock()
    mgr, _, _ = _manager(active=OCTOPRINT, on_connection_changed=inv)
    mgr.set_active(OCTOPRINT)
    inv.assert_not_called()


def test_failed_activation_keeps_previous_selection(workspace):
    mgr, octo, serial = _manager()
    serial.ensure_started = Mock(side_effect=RuntimeError("cannot activate"))
    with pytest.raises(RuntimeError, match="cannot activate"):
        mgr.set_active(SERIAL)
    assert mgr.active() is octo
    assert load_active_backend() is None
    assert serial.calls == [("close",)]


def test_old_inactive_serial_is_closed_before_its_replacement_starts(workspace):
    mgr, octo, serial = _manager()
    events = []
    serial.close = lambda: events.append("close-old-serial")
    replacement = FakeBackend()
    replacement.ensure_started = lambda: events.append("start-new-serial")
    assert mgr.reconfigure({OCTOPRINT: octo, SERIAL: replacement}, SERIAL)
    assert events == ["close-old-serial", "start-new-serial"]


def test_configuration_refresh_preserves_a_newer_explicit_selection(workspace):
    mgr, _, serial = _manager()
    prepared = {OCTOPRINT: FakeBackend(), SERIAL: serial}
    mgr.set_active(SERIAL)
    serial.calls.clear()
    assert mgr.reconfigure(prepared, OCTOPRINT, preserve_selection=True)
    assert mgr.active() is serial
    assert serial.calls == []


def test_reconfiguration_waits_for_upload_and_keeps_the_started_job(workspace):
    entered, finish, attempted = threading.Event(), threading.Event(), threading.Event()
    mgr, octo, _ = _manager()

    def upload(path, *, start):
        entered.set()
        assert finish.wait(timeout=3)
        octo._job_state = "Printing"
        return {"done": True}

    octo.upload = upload

    def reconfigure():
        attempted.set()
        return mgr.reconfigure({OCTOPRINT: FakeBackend()}, OCTOPRINT)

    with ThreadPoolExecutor(max_workers=2) as pool:
        sending = pool.submit(mgr.upload, workspace / "plot.gcode", start=True)
        try:
            assert entered.wait(timeout=3)
            replacing = pool.submit(reconfigure)
            assert attempted.wait(timeout=3)
            with pytest.raises(TimeoutError):
                replacing.result(timeout=0.05)
        finally:
            finish.set()
        assert sending.result(timeout=3) == {"done": True}
        assert replacing.result(timeout=3) is False
    assert mgr.active() is octo
    assert octo.calls == []


def test_slow_status_poll_does_not_block_cancel(workspace):
    entered, finish = threading.Event(), threading.Event()
    mgr, octo, _ = _manager()

    def status():
        entered.set()
        assert finish.wait(timeout=3)
        return {"configured": True, "job": {"state": "Printing"}}

    octo.status = status
    with ThreadPoolExecutor(max_workers=2) as pool:
        polling = pool.submit(mgr.status)
        try:
            assert entered.wait(timeout=3)
            cancelling = pool.submit(mgr.job_command, "cancel")
            cancelling.result(timeout=1)
            assert octo.calls == [("job", "cancel")]
        finally:
            finish.set()
        assert polling.result(timeout=3)["job"]["state"] == "Printing"


def test_closed_manager_cannot_reopen_old_connections(workspace):
    mgr, octo, serial = _manager()
    mgr.close()
    mgr.close()
    assert octo.calls == serial.calls == [("close",)]
    with pytest.raises(PrinterError, match="closed"):
        mgr.job_command("cancel")
    with pytest.raises(PrinterError, match="closed"):
        mgr.set_active(SERIAL)


# -- initial active resolution --------------------------------------------


def test_resolve_persisted_wins(workspace, monkeypatch):
    save_active_backend(SERIAL)
    monkeypatch.setenv("PRINTER_DEFAULT_BACKEND", OCTOPRINT)
    assert factory.resolve_initial_active(
        {OCTOPRINT: FakeBackend(), SERIAL: FakeBackend()}, load_settings().printer,
        saved=load_active_backend(),
    ) == SERIAL


def test_resolve_env_default(workspace, monkeypatch):
    monkeypatch.setenv("PRINTER_DEFAULT_BACKEND", SERIAL)
    assert factory.resolve_initial_active(
        {OCTOPRINT: FakeBackend(), SERIAL: FakeBackend()}, load_settings().printer,
    ) == SERIAL


def test_resolve_backcompat_use_serial(workspace, monkeypatch):
    monkeypatch.delenv("PRINTER_DEFAULT_BACKEND", raising=False)
    monkeypatch.setenv("PRINTER_USE_SERIAL", "true")
    assert factory.resolve_initial_active(
        {OCTOPRINT: FakeBackend(), SERIAL: FakeBackend()},
        replace(load_settings().printer, default_backend=""), legacy_serial=True,
    ) == SERIAL


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
