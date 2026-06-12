from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from plotter.octoprint import OctoPrintClient
from plotter.position import PositionTracker
from plotter.services import NotHomedError, PrinterController
from plotter.state import FileStateStore


@pytest.fixture
def controller(workspace, cal):
    client = MagicMock(spec=OctoPrintClient)
    tracker = PositionTracker(FileStateStore(workspace / "state"))
    return PrinterController(client=client, tracker=tracker)


class TestJogLimits:
    def test_plot_limit_clamps_xy(self, controller, cal):
        controller.home()
        pos = controller.jog(10_000, 10_000, 0, limit="plot")
        assert pos["x"] == cal.origin_x + cal.plot_width
        assert pos["y"] == cal.origin_y + cal.plot_height

    def test_plot_limit_keeps_z_above_pen_down(self, controller, cal):
        controller.home()
        controller.jog(0, 0, 10, limit="plot")
        pos = controller.jog(0, 0, -100, limit="plot")
        assert pos["z"] == cal.pen_down_z

    def test_bed_limit_clamps_to_bed(self, controller, cal):
        controller.home()
        pos = controller.jog(10_000, -10_000, 0, limit="bed")
        assert pos["x"] == cal.bed_width
        assert pos["y"] == 0.0

    def test_plot_limit_requires_homing(self, controller):
        with pytest.raises(NotHomedError):
            controller.jog(1, 0, 0, limit="plot")

    def test_homed_jog_sends_absolute_move(self, controller, cal):
        controller.home()
        # From (0,0) a plot-limited jog is pulled to the plot-area edge first.
        pos = controller.jog(10, 5, 0, limit="plot")
        assert (pos["x"], pos["y"]) == (cal.origin_x, cal.origin_y)
        # From inside the area the delta is applied exactly, as absolute move.
        pos = controller.jog(10, 5, 0, limit="plot")
        assert (pos["x"], pos["y"]) == (cal.origin_x + 10, cal.origin_y + 5)
        commands = controller.client.gcode.call_args[0][0]
        assert commands[0] == "G90"
        assert f"X{cal.origin_x + 10:.3f}" in commands[-1]

    def test_move_to_plot_limit(self, controller, cal):
        controller.home()
        pos = controller.move_to(0, 0, limit="plot")
        assert pos["x"] == cal.origin_x
        assert pos["y"] == cal.origin_y


class TestHomeSafety:
    def test_home_lifts_pen_before_homing(self, controller, cal):
        controller.home()
        commands = controller.client.gcode.call_args[0][0]
        assert commands == ["G91", f"G0 Z5 F{cal.z_feed:.0f}", "G90"]
        controller.client.home.assert_called_once()

    def test_home_resets_position(self, controller):
        controller.home()
        pos = controller.position()
        assert (pos["x"], pos["y"], pos["z"]) == (0.0, 0.0, 0.0)
        assert pos["homed"]


class TestPenHeights:
    def test_pen_down_from_position(self, controller, cal):
        controller.home()
        controller.jog(0, 0, 2.2)
        updated = controller.pen_height_from_position("down")
        assert updated.pen_down_z == 2.2
        assert updated.pen_up_z == cal.pen_up_z  # already above -> unchanged

    def test_pen_up_auto_raised_above_pen_down(self, controller, cal):
        controller.home()
        controller.jog(0, 0, cal.pen_up_z + 1)
        updated = controller.pen_height_from_position("down")
        assert updated.pen_up_z == pytest.approx(updated.pen_down_z + 5.0)

    def test_capturing_pen_down_marks_calibrated_and_persists(self, controller, workspace):
        from plotter.calibration import Calibration

        assert not Calibration.load().pen_calibrated
        controller.home()
        controller.jog(0, 0, 2.2)
        updated = controller.pen_height_from_position("down")
        assert updated.pen_calibrated is True
        # Persisted, so a fresh load (≈ tab switch / restart) still sees it.
        assert Calibration.load().pen_calibrated is True

    def test_capturing_pen_up_does_not_mark_calibrated(self, controller):
        controller.home()
        controller.jog(0, 0, 6.0)
        updated = controller.pen_height_from_position("up")
        assert updated.pen_calibrated is False


class TestSendRevalidation:
    """Old or stale jobs are re-checked against the current calibration."""

    def test_send_rejects_job_with_g28(self, workspace, cal, monkeypatch):
        from unittest.mock import patch

        from fastapi.testclient import TestClient

        import plotter.octoprint as op

        from plotter.jobmeta import write_job_meta

        jobs = workspace / "jobs"
        jobs.mkdir()
        (jobs / "old.gcode").write_text("G21\nG90\nG28\nG0 Z7.4 F1000\n")
        # With a matching profile sidecar the job passes the profile guard,
        # so this exercises the geometric safety re-validation.
        write_job_meta(jobs / "old.gcode")
        with patch.object(op.OctoPrintClient, "upload", return_value={}), \
             patch.object(op.OctoPrintClient, "gcode", return_value=None), \
             patch.object(op.OctoPrintClient, "home", return_value=None):
            from plotter.web.app import app
            c = TestClient(app)
            c.post("/api/octoprint/home", json={})
            r = c.post("/api/octoprint/send", json={"filename": "old.gcode", "start": True})
            assert r.status_code == 422
            assert "Homing im Job" in r.json()["detail"]

    def test_send_rejects_job_with_stale_pen_height(self, workspace, cal):
        from unittest.mock import patch

        from fastapi.testclient import TestClient

        import plotter.octoprint as op

        from plotter.jobmeta import write_job_meta

        jobs = workspace / "jobs"
        jobs.mkdir(exist_ok=True)
        # Job generated with a different (older) pen-down height.
        (jobs / "stale.gcode").write_text(
            f"G21\nG90\nG0 Z{cal.pen_up_z} F1000\n"
            f"G0 X{cal.origin_x} Y{cal.origin_y} F6000\nG1 Z0.2 F1000\n"
        )
        write_job_meta(jobs / "stale.gcode")
        with patch.object(op.OctoPrintClient, "upload", return_value={}):
            from plotter.web.app import app
            c = TestClient(app)
            r = c.post("/api/octoprint/send", json={"filename": "stale.gcode", "start": False})
            assert r.status_code == 422
            assert "keine kalibrierte Stift-Höhe" in r.json()["detail"]


class TestMoveToCorner:
    def test_pen_lift_is_sent_before_xy_travel(self, controller, cal):
        controller.home()
        controller.move_to_corner("bl")
        commands = controller.client.gcode.call_args[0][0]
        assert commands == [
            "G90",
            f"G0 Z{cal.pen_up_z:.3f} F{cal.z_feed:.0f}",
            "G0 X20.000 Y30.000 F6000",
        ]

    def test_uses_captured_paper_corner(self, controller, cal):
        controller.home()
        pos = controller.move_to_corner("tr")
        assert (pos["x"], pos["y"]) == (190.0, 200.0)
        assert pos["z"] == cal.pen_up_z

    def test_derives_missing_corner_from_rect(self, controller, cal):
        # "br" was never captured; derived from bl + tr -> (190, 30).
        controller.home()
        pos = controller.move_to_corner("br")
        assert (pos["x"], pos["y"]) == (190.0, 30.0)

    def test_plot_target_uses_plot_area(self, controller, cal):
        controller.home()
        pos = controller.move_to_corner("tl", target="plot")
        assert (pos["x"], pos["y"]) == (cal.origin_x, cal.origin_y + cal.plot_height)

    def test_requires_homing(self, controller):
        with pytest.raises(NotHomedError):
            controller.move_to_corner("bl")

    def test_unknown_corner_rejected(self, controller):
        from plotter.services import ServiceError

        controller.home()
        with pytest.raises(ServiceError):
            controller.move_to_corner("center")
