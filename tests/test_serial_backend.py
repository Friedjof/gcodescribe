from __future__ import annotations

import os
import select
import threading
import time
from collections import deque
from dataclasses import asdict

import pytest

from plotter.core.calibration import Calibration
from plotter.core.jobmeta import write_job_meta
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


def test_project_job_uses_its_own_pen_lift_for_cancel(workspace):
    machine = Calibration(pen_up_z=5.5, pen_down_z=3.8)
    machine.save()
    project = Calibration(pen_up_z=9, pen_down_z=2, park_x=30, park_y=180, park_lift_z=12)
    path = workspace / "project.gcode"
    path.write_text("G21\nG90\nG1 X10 Y10\nM2\n")
    write_job_meta(path, source={"kind": "paint_page"}, calibration_snapshot={
        "profileId": "project", "calibration": asdict(project),
    })
    worker, transport = _make_worker()
    try:
        assert _wait_until(lambda: worker.status().get("online") is True)
        worker.upload(path)
        assert "G1 Z9.000" in " ".join(worker._pen_up_lines(worker._job_calibration))
        assert any(line.startswith("G0 X30.000 Y180.000 ")
                   for line in worker._park_lines(worker._job_calibration))
        worker.job_command("cancel")
        assert _wait_until(lambda: "G1 Z9.000 F1602" in transport.sent)
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


def test_pause_lifts_pen_and_parks_at_finish_position(cal):
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
        # A pen-up move and the normal finish/park position were queued.
        assert _wait_until(
            lambda: any(f"Z{cal.pen_up_z:.3f}" in s for s in transport.sent)
        )
        park_x, park_y, _ = cal.resolved_park()
        assert _wait_until(
            lambda: any(
                f"X{park_x:.3f}" in s and f"Y{park_y:.3f}" in s
                for s in transport.sent
            )
        )
    finally:
        release.set()
        worker.shutdown()


def test_pause_parks_at_custom_position_with_custom_lift(cal):
    cal = cal.merged({"park_x": 17.0, "park_y": 23.0, "park_lift_z": cal.pen_up_z + 15.0})
    cal.save()
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
        assert _wait_until(
            lambda: any(f"Z{cal.park_lift_z:.3f}" in s for s in transport.sent)
        )
        assert _wait_until(
            lambda: any(
                f"X{cal.park_x:.3f}" in s and f"Y{cal.park_y:.3f}" in s
                for s in transport.sent
            )
        )
    finally:
        release.set()
        worker.shutdown()


def test_resume_after_pause_returns_to_saved_position_without_resending_line():
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
        worker.job_command("resume")
        assert _wait_until(lambda: worker.status()["job"] is None)
        assert transport.sent.count("G0 X1") == 1
        assert transport.sent.count("G0 X2") == 1
        # Resume returns from the finish/park position to the last confirmed XY.
        assert any("X1.000" in s and "Y0.000" in s for s in transport.sent)
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


@pytest.mark.parametrize("absolute", [True, False])
@pytest.mark.parametrize("pen_down", [True, False])
def test_resume_restores_z_feed_and_mode_before_streaming(cal, absolute, pen_down):
    from plotter.printer.base import PrinterBusyError

    release_first = threading.Event()
    first_seen = threading.Event()
    restore_seen = threading.Event()
    release_restore = threading.Event()
    z = cal.pen_down_z if pen_down else cal.pen_up_z
    returning = False

    def responder(cmd):
        nonlocal returning
        if cmd == "G1 X1 F3800":
            first_seen.set()
            release_first.wait(2)
        if cmd.startswith("G0 X1.000 Y0.000"):
            returning = True
        if returning and cmd.startswith(f"G1 Z{z:.3f}"):
            restore_seen.set()
            release_restore.wait(2)
        return [b"ok\n"]

    worker, transport = _make_worker(responder=responder)
    try:
        assert _wait_until(lambda: worker.status().get("online") is True)
        mode = "G90" if absolute else "G91"
        worker.upload(_tmp_gcode(f"{mode}\nG1 Z{z:.3f} F1500\nG1 X1 F3800\nG1 X2\n"),
                      start=True)
        assert first_seen.wait(2)
        worker.job_command("pause")
        # Resume before the in-flight line / parking has completed.
        worker.job_command("resume")
        release_first.set()
        assert restore_seen.wait(2)
        assert worker.status()["job"]["state"] == "Paused"
        assert worker.status()["motion_locked"] is True
        assert "G1 X2" not in transport.sent
        with pytest.raises(PrinterBusyError):
            worker.gcode(["G1 Z30"])
        release_restore.set()
        assert _wait_until(lambda: worker.status()["job"] is None)
        next_move = transport.sent.index("G1 X2")
        assert transport.sent[next_move - 1] == ("G1 F3800" if absolute else "G91")
        assert worker._z == pytest.approx(z)
        assert worker._x == pytest.approx(2 if absolute else 3)
        assert worker._feed == 3800
        assert worker._absolute is absolute
    finally:
        release_first.set()
        release_restore.set()
        worker.shutdown()


def test_failed_resume_stays_paused_and_can_retry(cal):
    first_seen = threading.Event()
    release = threading.Event()
    returning = False
    failed = False

    def responder(cmd):
        nonlocal returning, failed
        if cmd == "G1 X1":
            first_seen.set()
            release.wait(2)
        if cmd.startswith("G0 X1.000 Y0.000"):
            returning = True
        if returning and cmd.startswith(f"G1 Z{cal.pen_down_z:.3f}") and not failed:
            failed = True
            return [b"Error: Z movement failed\n"]
        return [b"ok\n"]

    worker, transport = _make_worker(responder=responder)
    try:
        assert _wait_until(lambda: worker.status().get("online") is True)
        worker.upload(_tmp_gcode(f"G1 Z{cal.pen_down_z:.3f}\nG1 X1\nG1 X2\n"), start=True)
        assert first_seen.wait(2)
        worker.job_command("pause")
        worker.job_command("resume")
        release.set()
        assert _wait_until(lambda: worker.status().get("error") is not None)
        assert worker.status()["job"]["state"] == "Paused"
        assert "G1 X2" not in transport.sent
        worker.job_command("resume")
        assert _wait_until(lambda: worker.status()["job"] is None)
        assert worker._z == pytest.approx(cal.pen_down_z)
        assert transport.sent.count("G1 X2") == 1
    finally:
        release.set()
        worker.shutdown()


def test_manual_commands_and_replacement_jobs_are_blocked_while_printing():
    from plotter.printer.base import PrinterBusyError

    seen = threading.Event()
    release = threading.Event()

    def responder(cmd):
        if cmd == "G1 X1":
            seen.set()
            release.wait(2)
        return [b"ok\n"]

    worker, transport = _make_worker(responder=responder)
    try:
        assert _wait_until(lambda: worker.status().get("online") is True)
        path = _tmp_gcode("G1 X1\nG1 X2\n")
        worker.upload(path, start=True)
        assert seen.wait(2)
        for action in [lambda: worker.gcode(["G1 Z30"]), lambda: worker.jog(z=5),
                       worker.home, lambda: worker.upload(path),
                       lambda: worker.job_command("restart")]:
            with pytest.raises(PrinterBusyError):
                action()
        assert "G1 Z30" not in transport.sent
        worker.job_command("cancel")
        release.set()
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
