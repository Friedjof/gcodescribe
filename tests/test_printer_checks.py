from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest

from plotter.services import printer_checks as checks


def setup_entry(monkeypatch, entry):
    monkeypatch.setattr(checks, "printer_settings", lambda: None)
    monkeypatch.setattr(checks, "connection_snapshot", lambda _: [dict(id="saved", **entry)])


@pytest.mark.parametrize("state,ok", [("Operational", True), ("Closed", False)])
def test_octoprint_server_is_distinct_from_physical_printer(monkeypatch, state, ok):
    from plotter.printer.octoprint import OctoPrintClient

    setup_entry(
        monkeypatch,
        {
            "transport": "octoprint",
            "octoprint_url": "http://test",
            "octoprint_api_key": "secret",
            "octoprint_verify_ssl": True,
        },
    )
    transport = httpx.MockTransport(
        lambda req: httpx.Response(
            200, json={"current": {"state": state}} if req.url.path.endswith("connection") else {}
        )
    )
    with httpx.Client(transport=transport, base_url="http://test") as client:
        monkeypatch.setattr(OctoPrintClient, "_client", lambda self: client)
        result = checks.check_connection("saved")
    assert result["ok"] is ok
    assert [s["state"] for s in result["steps"][:2]] == ["ok", "ok"]
    assert result["steps"][2]["state"] == ("ok" if ok else "failed")
    assert "secret" not in str(result)


def test_octoprint_rejected_key_is_not_reported_as_device_error(monkeypatch):
    from plotter.printer.octoprint import OctoPrintClient

    setup_entry(
        monkeypatch,
        {
            "transport": "octoprint",
            "octoprint_url": "http://test",
            "octoprint_api_key": "secret",
            "octoprint_verify_ssl": True,
        },
    )
    urls = []

    def respond(req):
        urls.append(req.url.path)
        return httpx.Response(403)

    with httpx.Client(transport=httpx.MockTransport(respond), base_url="http://test") as client:
        monkeypatch.setattr(OctoPrintClient, "_client", lambda self: client)
        result = checks.check_connection("saved")
    assert result["steps"][-1]["key"] == "access"
    assert urls == ["/api/version"]


@pytest.mark.parametrize(
    "probe,busy,owned,expected",
    [
        (False, False, False, "skipped"),
        (True, False, False, "ok"),
        (True, True, False, "busy"),
        (True, False, True, "busy"),
    ],
)
def test_usb_probe_is_explicit_and_never_opens_an_owned_or_busy_port(
    tmp_path, monkeypatch, probe, busy, owned, expected
):
    from plotter.printer import discovery, serial

    port = tmp_path / "usb"
    port.touch()
    setup_entry(
        monkeypatch, {"transport": "serial", "serial_port": str(port), "serial_baud": 250000}
    )
    driver = SimpleNamespace(status=lambda: {"online": False})
    manager = SimpleNamespace(
        _transition=nullcontext,
        backend=lambda _: driver,
        active=lambda: driver,
        _backend_busy=lambda _: busy,
    )
    monkeypatch.setattr(checks, "get_printer_client", lambda: manager)
    monkeypatch.setattr(serial, "peek_worker", lambda: object() if owned else None)
    identify = Mock(return_value={"marlin": True, "firmware": "Marlin test"})
    monkeypatch.setattr(discovery, "probe", identify)
    result = checks.check_connection("saved", probe=probe)
    assert result["steps"][-1]["state"] == expected
    assert identify.call_count == int(expected == "ok")
    if expected == "ok":
        identify.assert_called_once_with(str(port), baud=250000)


def test_unknown_printer_does_not_touch_runtime(monkeypatch):
    setup_entry(
        monkeypatch, {"transport": "serial", "serial_port": "/missing", "serial_baud": 115200}
    )
    runtime = Mock()
    monkeypatch.setattr(checks, "get_printer_client", runtime)
    with pytest.raises(KeyError):
        checks.check_connection("deleted")
    runtime.assert_not_called()
