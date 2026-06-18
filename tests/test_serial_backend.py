from __future__ import annotations

import os
import select
import threading
import time
from collections import deque

import pytest

from plotter.printer.base import PrinterBackend, PrinterError
from plotter.printer.octoprint import OctoPrintClient
from plotter.printer.serial import SerialClient, SerialWorker, reset_worker


class FakeTransport:
    """In-memory stand-in for ``serial.Serial`` that fakes Marlin's chatter."""

    def __init__(self, responder=None, banner=b"start\n"):
        self.is_open = True
        self.sent: list[str] = []
        self._out: deque[bytes] = deque()
        self._responder = responder or (lambda cmd: [b"ok\n"])
        self._lock = threading.Lock()
        if banner:
            self._out.append(banner)

    def write(self, data: bytes) -> int:
        cmd = data.decode().strip()
        with self._lock:
            self.sent.append(cmd)
            for resp in self._responder(cmd):
                self._out.append(resp)
        return len(data)

    def readline(self) -> bytes:
        with self._lock:
            if self._out:
                return self._out.popleft()
        time.sleep(0.001)  # mimic a short read timeout instead of busy-spinning
        return b""

    def reset_input_buffer(self) -> None:
        pass

    def close(self) -> None:
        self.is_open = False


class PtyMarlin:
    """Tiny Marlin-like peer behind a real pseudo-terminal serial device."""

    def __init__(self):
        self.master_fd, slave_fd = os.openpty()
        self.port = os.ttyname(slave_fd)
        os.close(slave_fd)
        self.sent: list[str] = []
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def close(self) -> None:
        self._stop.set()
        try:
            os.close(self.master_fd)
        except OSError:
            pass
        self._thread.join(timeout=2.0)

    def _run(self) -> None:
        # Let pyserial open/configure the slave before emitting the boot banner;
        # the worker clears its input buffer during connect.
        time.sleep(0.1)
        self._write(b"start\n")
        pending = b""
        while not self._stop.is_set():
            try:
                readable, _, _ = select.select([self.master_fd], [], [], 0.05)
                if not readable:
                    continue
                chunk = os.read(self.master_fd, 1024)
            except OSError:
                return
            if not chunk:
                continue
            pending += chunk
            while b"\n" in pending:
                raw, pending = pending.split(b"\n", 1)
                cmd = raw.decode(errors="replace").strip()
                if not cmd:
                    continue
                self.sent.append(cmd)
                if cmd == "G28":
                    self._write(b"echo:busy: processing\nok\n")
                else:
                    self._write(b"ok\n")

    def _write(self, data: bytes) -> None:
        try:
            os.write(self.master_fd, data)
        except OSError:
            pass


def _make_worker(responder=None, banner=b"start\n") -> tuple[SerialWorker, FakeTransport]:
    transport = FakeTransport(responder=responder, banner=banner)
    worker = SerialWorker("fake", 115200, transport_factory=lambda p, b: transport)
    return worker, transport


def _wait_until(predicate, timeout=2.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.005)
    return False


@pytest.fixture(autouse=True)
def _reset_singleton():
    reset_worker()
    yield
    reset_worker()


# -- interface conformity --------------------------------------------------


def test_both_backends_satisfy_protocol():
    assert isinstance(OctoPrintClient(), PrinterBackend)
    assert isinstance(SerialClient(transport_factory=lambda p, b: FakeTransport()), PrinterBackend)


# -- connection ------------------------------------------------------------


def test_connects_and_reports_online():
    worker, transport = _make_worker()
    try:
        assert _wait_until(lambda: worker.status().get("online") is True)
        # Init sequence sent after the banner.
        assert "G21" in transport.sent
        assert "G90" in transport.sent
    finally:
        worker.shutdown()


def test_offline_when_open_fails():
    def boom(port, baud):
        raise OSError("no such device")

    worker = SerialWorker("fake", 115200, transport_factory=boom)
    try:
        assert _wait_until(lambda: worker.status().get("online") is False)
        assert worker.status()["error"]
    finally:
        worker.shutdown()


def test_real_pyserial_transport_against_pty_marlin():
    marlin = PtyMarlin()
    worker = SerialWorker(marlin.port, 115200)
    try:
        assert _wait_until(lambda: worker.status().get("online") is True, timeout=4.0)
        worker.gcode(["G28", "G1 X10"])
        assert _wait_until(lambda: "G1 X10" in marlin.sent)
        assert marlin.sent[:2] == ["G21", "G90"]
        assert "G28" in marlin.sent
    finally:
        worker.shutdown()
        marlin.close()


# -- ack protocol ----------------------------------------------------------


def test_busy_extends_timeout_then_ok():
    def responder(cmd):
        if cmd == "G28":
            return [b"echo:busy: processing\n", b"echo:busy: processing\n", b"ok\n"]
        return [b"ok\n"]

    worker, _ = _make_worker(responder=responder)
    try:
        worker.home()  # should not raise despite the busy lines
    finally:
        worker.shutdown()


def test_error_response_raises():
    def responder(cmd):
        if cmd == "G28":
            return [b"Error:printer halted\n"]
        return [b"ok\n"]

    worker, _ = _make_worker(responder=responder)
    try:
        with pytest.raises(PrinterError):
            worker.home()
    finally:
        worker.shutdown()


def test_temperature_lines_are_ignored():
    def responder(cmd):
        if cmd.startswith("G1"):
            return [b"T:200 /200 B:60 /60\n", b"ok\n"]
        return [b"ok\n"]

    worker, _ = _make_worker(responder=responder)
    try:
        worker.gcode(["G1 X10"])  # ok arrives after a temp report
    finally:
        worker.shutdown()


# -- immediate commands ----------------------------------------------------


def test_jog_sends_relative_move():
    worker, transport = _make_worker()
    try:
        worker.jog(5, -3, 0, speed=1500)
        assert "G91" in transport.sent
        assert "G90" in transport.sent
        assert any(s.startswith("G1") and "X5.000" in s and "Y-3.000" in s for s in transport.sent)
    finally:
        worker.shutdown()


# -- streaming job ---------------------------------------------------------


def test_upload_streams_filtered_lines_and_completes():
    worker, transport = _make_worker()
    try:
        assert _wait_until(lambda: worker.status().get("online") is True)
        gcode = "; comment\nG0 X1\n\nG1 Y2 ; inline\nG0 X0\n"
        path = _tmp_gcode(gcode)
        worker.upload(path, start=True)
        assert _wait_until(lambda: worker.status()["job"] is None, timeout=3.0)
        # Only the three real moves were streamed (comments/blanks dropped).
        moves = [s for s in transport.sent if s.startswith("G")]
        assert "G0 X1" in moves and "G1 Y2" in moves and "G0 X0" in moves
        assert "; comment" not in transport.sent
    finally:
        worker.shutdown()


def test_progress_advances():
    # Hold each move until released so we can observe partial progress.
    gate = threading.Event()

    def responder(cmd):
        if cmd.startswith("G0") or cmd.startswith("G1"):
            gate.wait(2.0)
            return [b"ok\n"]
        return [b"ok\n"]

    worker, _ = _make_worker(responder=responder)
    try:
        assert _wait_until(lambda: worker.status().get("online") is True)
        path = _tmp_gcode("G0 X1\nG0 X2\nG0 X3\nG0 X4\n")
        worker.upload(path, start=True)
        assert _wait_until(
            lambda: (worker.status().get("job") or {}).get("state") == "Printing"
        )
        gate.set()
        assert _wait_until(lambda: worker.status()["job"] is None, timeout=3.0)
    finally:
        gate.set()
        worker.shutdown()


# -- pause / cancel --------------------------------------------------------


def test_pause_lifts_pen(cal):
    release = threading.Event()

    def responder(cmd):
        if cmd.startswith("G0 X"):
            release.wait(2.0)
        return [b"ok\n"]

    worker, transport = _make_worker(responder=responder)
    try:
        assert _wait_until(lambda: worker.status().get("online") is True)
        path = _tmp_gcode("G0 X1\nG0 X2\nG0 X3\n")
        worker.upload(path, start=True)
        assert _wait_until(
            lambda: (worker.status().get("job") or {}).get("state") == "Printing"
        )
        worker.job_command("pause")
        release.set()
        assert _wait_until(
            lambda: (worker.status().get("job") or {}).get("state") == "Paused"
        )
        # A pen-up move at the calibrated height was queued.
        assert _wait_until(
            lambda: any(f"Z{cal.pen_up_z:.3f}" in s for s in transport.sent)
        )
    finally:
        release.set()
        worker.shutdown()


def test_resume_after_pause_does_not_resend_completed_line():
    release_first = threading.Event()
    first_seen = threading.Event()

    def responder(cmd):
        if cmd == "G0 X1":
            first_seen.set()
            release_first.wait(2.0)
        return [b"ok\n"]

    worker, transport = _make_worker(responder=responder)
    try:
        assert _wait_until(lambda: worker.status().get("online") is True)
        path = _tmp_gcode("G0 X1\nG0 X2\n")
        worker.upload(path, start=True)
        assert first_seen.wait(2.0)
        worker.job_command("pause")
        release_first.set()
        assert _wait_until(
            lambda: (worker.status().get("job") or {}).get("state") == "Paused"
        )
        worker.job_command("start")
        assert _wait_until(lambda: worker.status()["job"] is None)
        assert transport.sent.count("G0 X1") == 1
        assert transport.sent.count("G0 X2") == 1
    finally:
        release_first.set()
        worker.shutdown()


def test_cancel_quickstops_and_clears_job(cal):
    release = threading.Event()

    def responder(cmd):
        if cmd.startswith("G0 X"):
            release.wait(2.0)
        return [b"ok\n"]

    worker, transport = _make_worker(responder=responder)
    try:
        assert _wait_until(lambda: worker.status().get("online") is True)
        path = _tmp_gcode("G0 X1\nG0 X2\nG0 X3\n")
        worker.upload(path, start=True)
        assert _wait_until(
            lambda: (worker.status().get("job") or {}).get("state") == "Printing"
        )
        worker.job_command("cancel")
        release.set()
        assert _wait_until(lambda: worker.status()["job"] is None)
        assert _wait_until(lambda: "M410" in transport.sent)
    finally:
        release.set()
        worker.shutdown()


# -- status contract -------------------------------------------------------


def test_status_shape_for_loaded_job():
    worker, _ = _make_worker()
    try:
        assert _wait_until(lambda: worker.status().get("online") is True)
        path = _tmp_gcode("G0 X1\nG0 X2\n")
        worker.upload(path, start=False)
        st = worker.status()
        assert st["configured"] is True
        assert st["online"] is True
        assert st["job"]["job"]["file"]["name"] == path.name
        assert "completion" in st["job"]["progress"]
    finally:
        worker.shutdown()


def test_client_not_configured_without_port(monkeypatch):
    monkeypatch.setenv("PRINTER_SERIAL_PORT", "")
    client = SerialClient(port="")
    assert client.configured is False
    assert client.status() == {"configured": False, "backend": "serial"}


# -- helpers ---------------------------------------------------------------

_tmp_dir = None


def _tmp_gcode(text: str):
    import tempfile
    from pathlib import Path

    global _tmp_dir
    if _tmp_dir is None:
        _tmp_dir = tempfile.mkdtemp(prefix="serial-test-")
    path = Path(_tmp_dir) / f"job-{time.monotonic_ns()}.gcode"
    path.write_text(text)
    return path
