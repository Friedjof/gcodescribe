from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from plotter.artwork.export import calibration_from_xml, calibration_to_xml
from plotter.core.calibration import Calibration
from plotter.core.position import PositionTracker
from plotter.core.state import FileStateStore
from plotter.printer.base import PrinterBusyError
from plotter.printer.octoprint import OctoPrintClient
from plotter.services import NotHomedError, PrinterController, ServiceError
from plotter.services.paper import PaperService
from plotter.services.profiles import ProfileService


@pytest.fixture
def machine(workspace, cal):
    client = MagicMock(spec=OctoPrintClient)
    client.status.return_value = {"online": True, "job": None}
    tracker = PositionTracker(FileStateStore(workspace / "state"))
    tracker.home(None)
    tracker.set_axes(x=30, y=40, z=20)
    return PrinterController(client=client, tracker=tracker)


@pytest.mark.parametrize("diagonal,points", [
    ("bl-tr", [("bl", 20, 30), ("tr", 180, 190)]),
    ("tl-br", [("tl", 20, 190), ("br", 180, 30)]),
])
def test_capture_diagonal_completes_rectangle_and_preserves_provenance(machine, diagonal, points):
    paper = PaperService(machine.tracker)
    for corner, x, y in points:
        machine.tracker.set_axes(x=x, y=y)
        result = paper.capture(corner, mode="diagonal", diagonal=diagonal)
    assert result["calibration"]["paper_corners"] == {
        "bl": [20, 30], "br": [180, 30], "tr": [180, 190], "tl": [20, 190],
    }
    assert Calibration.load().paper_diagonal == diagonal
    restored = calibration_from_xml(calibration_to_xml(Calibration.load()))
    assert restored.paper_diagonal == diagonal
    assert paper.apply(5, from_paper=True)["calibration"]["plot_width"] == 150
    machine.client.gcode.assert_not_called()


def test_editing_anchor_updates_derived_corners_and_deleting_it_removes_them(machine):
    paper = PaperService(machine.tracker)
    paper.set_corner_at("bl", 20, 30)
    machine.tracker.set_axes(x=180, y=190)
    paper.capture("tr", mode="diagonal")
    result = paper.set_corner_at("bl", 25, 35)
    assert result["calibration"]["paper_corners"]["tl"] == [25, 190]
    assert result["calibration"]["paper_corners"]["br"] == [180, 35]
    with pytest.raises(ServiceError, match="berechnet"):
        paper.set_corner_at("tl", 26, 190)
    assert paper.clear("bl")["calibration"]["paper_corners"] == {"tr": [180, 190]}


def test_invalid_diagonal_does_not_save_partial_or_wrong_rectangle(machine):
    paper = PaperService(machine.tracker)
    machine.tracker.set_axes(x=100, y=100)
    paper.capture("bl", mode="diagonal")
    before = Calibration.load().paper_corners
    machine.tracker.set_axes(x=50, y=50)
    with pytest.raises(ServiceError, match="gegenüberliegen"):
        paper.capture("tr", mode="diagonal")
    assert Calibration.load().paper_corners == before


def test_switching_diagonal_does_not_promote_generated_points_to_measured(machine):
    paper = PaperService(machine.tracker)
    machine.tracker.set_axes(x=20, y=30)
    paper.capture("bl", mode="diagonal")
    machine.tracker.set_axes(x=180, y=190)
    paper.capture("tr", mode="diagonal")
    machine.tracker.set_axes(x=25, y=185)
    result = paper.capture("tl", mode="diagonal", diagonal="tl-br")
    assert result["calibration"]["paper_corners"] == {"tl": [25, 185]}
    assert result["rect"] is None


def test_manual_mode_retains_four_independent_corners(machine):
    paper = PaperService(machine.tracker)
    for corner, x, y in [("bl", 20, 30), ("tr", 180, 190)]:
        machine.tracker.set_axes(x=x, y=y)
        paper.capture(corner, mode="diagonal")
    machine.tracker.set_axes(x=22, y=185)
    result = paper.capture("tl", mode="manual")
    assert result["calibration"]["paper_diagonal"] is None
    assert result["calibration"]["paper_generated_corners"] == ["br"]
    assert result["calibration"]["paper_corners"]["tr"] == [180, 190]
    assert result["calibration"]["paper_corners"]["tl"] == [22, 185]


def test_precalibration_positioning_never_lowers_the_head(machine, cal):
    cal.pen_down_z = 10  # Not calibrated yet; it may exceed the old lift height.
    cal.pen_up_z = 5
    result = machine.move_to_position("calibration", cal=cal, lift_only=True)
    commands = machine.client.gcode.call_args.args[0]
    assert commands[2] == "G0 Z20.000 F1602"
    assert not any(command.startswith("G1") for command in commands)
    assert result["z"] == 20


def test_dot_is_a_single_batch_without_xy_motion_and_finishes_raised(machine, cal):
    cal.pen_calibrated = True
    result = machine.test_dot(cal=cal)
    machine.client.gcode.assert_called_once_with([
        "G90", "M203 Z60", "G1 Z1.400 F1602", "G4 P100", "G0 Z7.400 F1602", "M400",
    ])
    assert (result["x"], result["y"], result["z"]) == (30, 40, 7.4)


@pytest.mark.parametrize("reason", ["not_homed", "offline", "printing", "uncalibrated", "obstacle"])
def test_dot_refuses_unsafe_state_without_any_commands(machine, cal, reason):
    cal.pen_calibrated = True
    if reason == "not_homed":
        machine.tracker.invalidate()
    elif reason == "offline":
        machine.client.status.return_value = {"online": False}
    elif reason == "printing":
        machine.client.status.return_value = {"online": True, "job": {"state": "Printing"}}
    elif reason == "uncalibrated":
        cal.pen_calibrated = False
    else:
        cal.obstacles = [{"x": 25, "y": 35, "w": 10, "h": 10}]
    with pytest.raises((NotHomedError, ServiceError, PrinterBusyError)):
        machine.test_dot(cal=cal)
    machine.client.gcode.assert_not_called()


def test_new_motion_requests_keep_archived_profile_guards(machine, monkeypatch):
    from plotter.web.app import app
    from plotter.web.routes import printer

    monkeypatch.setattr(printer, "controller", lambda: machine)
    profiles = ProfileService()
    inactive = profiles.create("Other")
    profiles.archive(inactive["id"])
    client = TestClient(app)
    for path, payload in [
        ("test-dot", {}), ("move-to-position", {"kind": "calibration", "lift_only": True}),
    ]:
        response = client.post(f"/api/printer/{path}", json={
            **payload, "profileId": inactive["id"],
        })
        assert response.status_code == 409
    machine.client.gcode.assert_not_called()


def test_corner_pattern_marks_front_left_back_left_back_right_front_right(cal):
    from plotter.gcode.profile import test_pattern as pattern

    cal.park_after_plot = False
    lines = [line for line in pattern("corners", cal).splitlines() if not line.startswith(";")]
    assert [line for line in lines if line.startswith("G0 X")] == [
        "G0 X25.000 Y35.000 F6000", "G0 X25.000 Y195.000 F6000",
        "G0 X185.000 Y195.000 F6000", "G0 X185.000 Y35.000 F6000",
    ]
    assert not any(line.startswith("G1 X") for line in lines)
    assert lines.count("G1 Z1.400 F1602") == 4
    assert lines.count("G4 P100") == 4
    for index, line in enumerate(lines):
        if line == "G4 P100":
            assert lines[index + 1] == "G0 Z7.400 F1602"


def test_corner_pattern_refuses_a_contact_point_inside_a_clamp(cal):
    from plotter.gcode.profile import test_pattern as pattern

    cal.obstacles = [{"x": 23, "y": 33, "w": 5, "h": 5}]
    with pytest.raises(ValueError):
        pattern("corners", cal)


def test_paper_default_raises_without_ever_lowering_a_higher_head(machine, cal):
    machine.raise_pen(cal=cal)
    assert machine.client.gcode.call_args.args[0] == [
        "G90", "M203 Z60", "G0 Z20.000 F1602", "M400",
    ]
    machine.tracker.set_axes(z=cal.pen_down_z)
    assert machine.raise_pen(cal=cal)["z"] == cal.pen_up_z


def test_paper_xy_jog_lifts_before_travelling(machine, cal):
    machine.tracker.set_axes(z=cal.pen_down_z)
    result = machine.jog(10, 0, 0, cal=cal, pen_up_first=True)
    commands = machine.client.gcode.call_args.args[0]
    assert commands == ["G90", "M203 Z60", "G0 Z7.400 F1602", "G0 X40.000 Y40.000 F6000"]
    assert result["z"] == cal.pen_up_z
    machine.tracker.invalidate()
    machine.client.gcode.reset_mock()
    with pytest.raises(NotHomedError):
        machine.jog(10, 0, 0, cal=cal, pen_up_first=True)
    machine.client.gcode.assert_not_called()
