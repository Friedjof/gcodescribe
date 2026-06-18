from __future__ import annotations

from types import SimpleNamespace

from fastapi.testclient import TestClient

from plotter.printer import discovery


def _port(device, *, vid=None, pid=0x7523, description="", manufacturer="", product=""):
    return SimpleNamespace(
        device=device,
        description=description,
        manufacturer=manufacturer,
        product=product,
        serial_number="ABC123" if vid is not None else None,
        vid=vid,
        pid=pid if vid is not None else None,
    )


def test_list_candidates_filters_non_usb_ports(monkeypatch):
    monkeypatch.setattr(
        discovery.list_ports,
        "comports",
        lambda: [
            _port("/dev/ttyS0"),
            _port("/dev/ttyUSB0", vid=0x1A86, description="USB Serial"),
        ],
    )
    monkeypatch.setattr(discovery, "_by_id_map", lambda: {})

    candidates = discovery.list_candidates()

    assert [c.device for c in candidates] == ["/dev/ttyUSB0"]
    assert candidates[0].likely_printer is True
    assert candidates[0].score == 3


def test_scoring_prefers_printer_descriptions(monkeypatch):
    monkeypatch.setattr(
        discovery.list_ports,
        "comports",
        lambda: [
            _port("/dev/ttyUSB0", vid=0x0403, description="USB Serial"),
            _port("/dev/ttyACM0", vid=0x2341, description="Marlin 3D Printer"),
        ],
    )
    monkeypatch.setattr(discovery, "_by_id_map", lambda: {})

    candidates = discovery.list_candidates()

    assert [c.device for c in candidates] == ["/dev/ttyACM0", "/dev/ttyUSB0"]
    assert candidates[0].score > candidates[1].score


def test_by_id_path_is_exposed_and_preferred_for_auto(monkeypatch):
    monkeypatch.setattr(
        discovery.list_ports,
        "comports",
        lambda: [_port("/dev/ttyUSB0", vid=0x1A86, description="USB Serial")],
    )
    monkeypatch.setattr(
        discovery,
        "_by_id_map",
        lambda: {discovery._realpath("/dev/ttyUSB0"): "/dev/serial/by-id/printer"},
    )

    candidate = discovery.list_candidates()[0]

    assert candidate.by_id == "/dev/serial/by-id/printer"
    assert candidate.as_dict()["byId"] == "/dev/serial/by-id/printer"
    assert discovery.resolve_auto_port() == "/dev/serial/by-id/printer"


def test_auto_port_requires_exactly_one_likely_candidate(monkeypatch):
    monkeypatch.setattr(
        discovery.list_ports,
        "comports",
        lambda: [
            _port("/dev/ttyUSB0", vid=0x1A86),
            _port("/dev/ttyACM0", vid=0x2341),
        ],
    )
    monkeypatch.setattr(discovery, "_by_id_map", lambda: {})

    assert discovery.resolve_auto_port() is None


class _FakeProbePort:
    """Minimal serial-like port for probe() tests."""

    def __init__(self, lines: list[bytes]):
        self._lines = list(lines)
        self.written: list[bytes] = []

    def reset_input_buffer(self):
        pass

    def write(self, data):
        self.written.append(data)
        return len(data)

    def readline(self):
        return self._lines.pop(0) if self._lines else b""

    def close(self):
        pass


def test_probe_identifies_marlin():
    port = _FakeProbePort(
        [b"", b"FIRMWARE_NAME:Marlin 2.1.2 SOURCE_CODE_URL:github\n", b"ok\n"]
    )
    result = discovery.probe("/dev/ttyUSB0", opener=lambda d, b: port)
    assert result["marlin"] is True
    assert result["firmware"] == "Marlin 2.1.2"
    assert b"M115\n" in port.written


def test_probe_non_marlin_no_firmware():
    port = _FakeProbePort([b"", b"ok\n"])
    result = discovery.probe("/dev/ttyUSB0", opener=lambda d, b: port)
    assert result["marlin"] is False
    assert result["firmware"] is None


def test_probe_open_failure_returns_error():
    def boom(device, baud):
        raise OSError("permission denied")

    result = discovery.probe("/dev/ttyUSB0", opener=boom)
    assert result["marlin"] is False
    assert "permission denied" in result["error"]


def test_probe_route_blocked_when_serial_active(monkeypatch, workspace):
    import plotter.printer.serial as serial_mod

    class _OnlineWorker:
        def status(self):
            return {"online": True}

    monkeypatch.setattr(serial_mod, "peek_worker", lambda: _OnlineWorker())

    from plotter.web.app import app

    r = TestClient(app).post("/api/printer/serial/probe", json={"device": "/dev/ttyUSB0"})
    assert r.status_code == 409


def test_worker_resolves_auto_port(monkeypatch):
    import time
    from collections import deque

    import plotter.printer.serial as serial_mod

    monkeypatch.setattr(discovery, "resolve_auto_port", lambda: "/dev/ttyUSB7")

    seen: dict = {}

    class _T:
        is_open = True

        def __init__(self):
            self.out = deque([b"start\n", b"ok\n", b"ok\n"])

        def write(self, data):
            return len(data)

        def readline(self):
            return self.out.popleft() if self.out else b""

        def reset_input_buffer(self):
            pass

        def close(self):
            pass

    def factory(port, baud):
        seen["port"] = port
        return _T()

    worker = serial_mod.SerialWorker("auto", 115200, transport_factory=factory)
    try:
        deadline = time.monotonic() + 2.0
        while time.monotonic() < deadline and "port" not in seen:
            time.sleep(0.01)
        assert seen.get("port") == "/dev/ttyUSB7"
    finally:
        worker.shutdown()


def test_serial_ports_route_returns_passive_candidates(monkeypatch, workspace):
    monkeypatch.setattr(
        discovery,
        "list_candidates",
        lambda: [
            discovery.SerialCandidate(
                device="/dev/ttyUSB0",
                by_id="/dev/serial/by-id/printer",
                description="USB Serial",
                manufacturer="QinHeng",
                serial_number="ABC123",
                vid=0x1A86,
                pid=0x7523,
                likely_printer=True,
                score=3,
            )
        ],
    )

    from plotter.web.app import app

    response = TestClient(app).get("/api/printer/serial/ports")

    assert response.status_code == 200
    assert response.json() == [
        {
            "device": "/dev/ttyUSB0",
            "byId": "/dev/serial/by-id/printer",
            "description": "USB Serial",
            "manufacturer": "QinHeng",
            "serialNumber": "ABC123",
            "vid": "0x1a86",
            "pid": "0x7523",
            "likelyPrinter": True,
            "score": 3,
        }
    ]
