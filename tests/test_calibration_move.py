import math
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from plotter.artwork.export import calibration_from_xml, calibration_to_xml
from plotter.core.calibration import Calibration
from plotter.core.position import PositionTracker
from plotter.core.state import FileStateStore
from plotter.geometry.routing import OBSTACLE_MARGIN, seg_intersects_obs
from plotter.printer.base import PrinterBusyError
from plotter.printer.octoprint import OctoPrintClient
from plotter.services import NotHomedError, PrinterController, ServiceError
from plotter.services.profiles import ProfileService


@pytest.fixture
def controller(workspace, cal):
    client = MagicMock(spec=OctoPrintClient)
    client.status.return_value = {"online": True, "job": None}
    tracker = PositionTracker(FileStateStore(workspace / "state"))
    tracker.home(None)
    return PrinterController(client=client, tracker=tracker)


def test_uses_current_active_profile_for_entire_sequence(controller):
    profiles = ProfileService()
    other = profiles.create(
        "Calibration",
        calibration={
            "calibration_x": 42.0,
            "calibration_y": 63.0,
            "pen_up_z": 12.0,
            "pen_down_z": 3.0,
            "z_feed": 10.0,
            "travel_feed": 80.0,
        },
    )
    # The controller already exists when the active profile changes.
    profiles.activate(other["id"])
    position = controller.move_to_calibration()
    controller.client.gcode.assert_called_once_with(
        [
            "G90",
            "M203 Z60",
            "G0 Z12.000 F600",
            "G0 X42.000 Y63.000 F4800",
            "G1 Z3.000 F600",
        ]
    )
    assert (position["x"], position["y"], position["z"]) == (42.0, 63.0, 3.0)


def test_speed_test_homes_then_traces_large_house_spiral_and_circle_with_pen_up(controller):
    result = controller.speed_test()
    controller.client.home.assert_called_once_with(None)
    assert [call[0] for call in controller.client.method_calls if call[0] in {"gcode", "home"}] == [
        "gcode",
        "home",
        "gcode",
    ]
    commands = controller.client.gcode.call_args.args[0]
    assert commands[:5] == [
        "G90",
        "M203 Z60",
        "G0 Z7.400 F1602",
        "G0 X105.000 Y115.000 F6000",
        "G0 X61.000 Y49.000 F6000",
    ]
    assert commands[5:13] == [
        "G0 X61.000 Y137.000 F6000",
        "G0 X105.000 Y181.000 F6000",
        "G0 X149.000 Y137.000 F6000",
        "G0 X61.000 Y137.000 F6000",
        "G0 X149.000 Y49.000 F6000",
        "G0 X149.000 Y137.000 F6000",
        "G0 X61.000 Y49.000 F6000",
        "G0 X149.000 Y49.000 F6000",
    ]
    assert commands[13] == "G0 X105.000 Y115.000 F6000"
    radius = 67.2
    spiral_steps = max(4 * 64, math.ceil(math.tau * 4 * radius / 2.0))
    circle_steps = max(128, math.ceil(math.tau * radius / 1.5))
    assert len(commands[14:]) == spiral_steps + circle_steps

    def xy(command):
        return tuple(float(word[1:]) for word in command.split()[1:3])

    spiral = [(105.0, 115.0)] + [xy(cmd) for cmd in commands[14 : 14 + spiral_steps]]
    circle = [spiral[-1]] + [xy(cmd) for cmd in commands[14 + spiral_steps :]]
    assert max(math.dist(a, b) for a, b in zip(spiral, spiral[1:], strict=False)) <= 2.01
    assert max(math.dist(a, b) for a, b in zip(circle, circle[1:], strict=False)) <= 1.51
    assert all(abs(math.dist((105, 115), point) - radius) < 0.002 for point in circle)
    assert circle[0] == circle[-1]
    assert commands[-1] == "G0 X172.200 Y115.000 F6000"
    assert all(cmd.endswith("F6000") for cmd in commands if cmd.startswith("G0 X"))
    assert not any(cmd.startswith("G1") for cmd in commands)
    assert [cmd for cmd in commands if cmd.startswith(("G0 Z", "G1 Z"))] == ["G0 Z7.400 F1602"]
    assert result["size"] == 88
    assert result["travelFeed"] == 100
    assert result["position"] == {
        "x": 172.2,
        "y": 115,
        "z": 7.4,
        "homed": True,
        "homed_axes": ["x", "y", "z"],
    }


def test_speed_test_routes_to_center_around_a_clamp(controller, cal):
    controller.tracker.set_axes(x=50, y=50, z=12)
    cal.merged({"obstacles": [{"x": 25, "y": 25, "w": 10, "h": 10}]}).save()
    controller.speed_test()
    commands = controller.client.gcode.call_args.args[0]
    assert commands[2] == "G0 Z7.400 F1602"
    center_move = commands.index("G0 X105.000 Y115.000 F6000")
    travels = commands[3 : center_move + 1]
    assert len(travels) > 1
    previous = (0, 0)
    for command in travels:
        parts = command.split()
        point = (float(parts[1][1:]), float(parts[2][1:]))
        assert not seg_intersects_obs(
            previous, point, {"x": 25, "y": 25, "w": 10, "h": 10}, OBSTACLE_MARGIN
        )
        previous = point
    assert previous == (105, 115)


def test_speed_test_rejects_a_clamp_in_the_drawing_before_any_motion(controller, cal):
    cal.merged({"obstacles": [{"x": 108, "y": 126, "w": 5, "h": 5}]}).save()
    with pytest.raises(ServiceError, match="Bewegungstest passt nicht frei"):
        controller.speed_test()
    controller.client.gcode.assert_not_called()
    controller.client.home.assert_not_called()


@pytest.mark.parametrize("unavailable", ["offline", "printing", "no_space"])
def test_speed_test_refuses_unsafe_motion(controller, cal, unavailable):
    if unavailable == "offline":
        controller.client.status.return_value = {"online": False, "job": None}
    elif unavailable == "printing":
        controller.client.status.return_value = {"online": True, "job": {"state": "Printing"}}
    else:
        cal.merged({"bed_width": 8, "bed_height": 8}).save()
        controller.tracker.set_axes(x=4, y=4)
    with pytest.raises((ServiceError, NotHomedError, PrinterBusyError)):
        controller.speed_test()
    controller.client.gcode.assert_not_called()
    controller.client.home.assert_not_called()


def test_speed_test_homes_even_when_position_is_unknown(controller):
    controller.tracker.invalidate()
    controller.speed_test()
    controller.client.home.assert_called_once()
    assert controller.position()["homed"] is True


def test_speed_test_api_requires_the_active_profile(controller, monkeypatch):
    from plotter.web.app import app
    from plotter.web.routes import printer

    monkeypatch.setattr(printer, "controller", lambda: controller)
    client = TestClient(app)
    active_id = ProfileService().active_id()
    assert client.post("/api/printer/speed-test", json={"profile_id": "other"}).status_code == 409
    controller.client.gcode.assert_not_called()
    result = client.post("/api/printer/speed-test", json={"profile_id": active_id})
    assert result.status_code == 200
    assert result.json()["size"] == 88
    assert controller.client.gcode.call_count == 2
    controller.client.home.assert_called_once()


def test_requires_homing_without_sending_any_motion(controller):
    controller.tracker.invalidate()
    with pytest.raises(NotHomedError):
        controller.move_to_calibration()
    controller.client.gcode.assert_not_called()


@pytest.mark.parametrize(
    "status",
    [
        {"job": {"state": state}}
        for state in ["Printing", "Starting", "Pausing", "Resuming", "Finishing", "Cancelling"]
    ]
    + [{"job": {"state": "Paused"}, "motion_locked": True}],
)
def test_blocks_busy_printer(controller, status):
    controller.client.status.return_value = status
    with pytest.raises(PrinterBusyError):
        controller.move_to_calibration()
    controller.client.gcode.assert_not_called()


@pytest.mark.parametrize(
    "updates",
    [
        {"calibration_x": -1},
        {"calibration_y": 500},
        {"calibration_x": float("nan")},
        {"pen_down_z": -1},
        {"pen_down_z": 8, "pen_up_z": 5},
        {"pen_up_z": 500},
        {"obstacles": [{"id": "clamp", "x": 95, "y": 95, "w": 20, "h": 20}]},
    ],
)
def test_invalid_destination_or_heights_never_move(controller, cal, updates):
    cal.merged(updates).save()
    with pytest.raises(ServiceError):
        controller.move_to_calibration()
    controller.client.gcode.assert_not_called()


def test_routes_around_clamps_before_lowering(controller, cal):
    obstacle = {"id": "clamp", "x": 40, "y": 40, "w": 20, "h": 20}
    cal.merged({"obstacles": [obstacle]}).save()
    controller.move_to_calibration()
    commands = controller.client.gcode.call_args.args[0]
    assert commands[2].startswith("G0 Z7.400 ")
    assert commands[-1].startswith("G1 Z1.400 ")
    travels = commands[3:-1]
    assert len(travels) > 1
    previous = (0, 0)
    for command in travels:
        parts = command.split()
        point = (float(parts[1][1:]), float(parts[2][1:]))
        assert not seg_intersects_obs(previous, point, obstacle, OBSTACLE_MARGIN)
        previous = point
    assert previous == (105, 105)


def test_failed_send_does_not_update_position(controller):
    previous = controller.position()
    controller.client.gcode.side_effect = RuntimeError("disconnected")
    with pytest.raises(RuntimeError):
        controller.move_to_calibration()
    assert controller.position() == previous


def test_legacy_defaults_and_custom_position_persist(workspace):
    cal = Calibration.from_dict({"bed_width": 300, "bed_height": 400})
    assert cal.as_dict()["defined_positions"] == []
    assert cal.merged({"park_x": 10}).as_dict()["defined_positions"] == []
    assert cal.merged({"park_x": 0, "park_y": 0}).as_dict()["defined_positions"] == ["park"]
    assert cal.resolved_calibration_position() == (150, 200)
    cal.save()
    cal = Calibration.load().merged({"bed_width": 320})
    assert cal.resolved_calibration_position() == (160, 200)
    cal = cal.merged({"calibration_x": 40, "calibration_y": 60})
    cal.save()
    assert Calibration.load().resolved_calibration_position() == (40, 60)
    assert Calibration.load().as_dict()["defined_positions"] == ["calibration"]
    assert cal.merged({"park_x": 10, "park_y": 20}).as_dict()["defined_positions"] == [
        "park",
        "calibration",
    ]
    # XML exports concrete coordinates, so importing defines both positions.
    assert calibration_from_xml(calibration_to_xml(cal)).as_dict() == {
        **cal.as_dict(),
        "defined_positions": ["park", "calibration"],
    }
    assert calibration_from_xml("<plotterCalibration/>", base=cal).as_dict() == cal.as_dict()


def test_calibration_position_is_saved_per_profile_and_invalidates_expected_profile(workspace):
    profiles = ProfileService()
    original = profiles.active()
    updated = profiles.update(
        original["id"],
        calibration={
            "calibration_x": 40,
            "calibration_y": 60,
            "calibration_pressure_offset": 1.5,
        },
    )
    assert updated["fingerprint"] != original["fingerprint"]
    pressure_only = profiles.update(original["id"], calibration={"calibration_pressure_offset": 2})
    assert pressure_only["fingerprint"] == updated["fingerprint"]
    profiles.update(original["id"], calibration={"calibration_pressure_offset": 1.5})
    other = profiles.create("Other", calibration={"calibration_x": 80, "calibration_y": 90})
    profiles.activate(other["id"])
    assert Calibration.load().resolved_calibration_position() == (80, 90)
    profiles.activate(original["id"])
    assert Calibration.load().resolved_calibration_position() == (40, 60)
    assert Calibration.load().calibration_pressure_offset == 1.5
    assert (
        calibration_from_xml(calibration_to_xml(Calibration.load())).calibration_pressure_offset
        == 1.5
    )


def test_api_sends_sequence_and_returns_position(controller, monkeypatch):
    from plotter.web.app import app
    from plotter.web.routes import printer

    monkeypatch.setattr(printer, "controller", lambda: controller)
    response = TestClient(app).post("/api/printer/move-to-calibration")
    assert response.status_code == 200
    assert response.json()["position"]["z"] == 1.4
    controller.client.gcode.assert_called_once()


def test_designer_project_position_uses_project_profile_without_global_switch(
    controller, monkeypatch
):
    from plotter.web.app import app
    from plotter.web.routes import printer

    monkeypatch.setattr(printer, "controller", lambda: controller)
    client = TestClient(app)
    project = client.get("/api/pages").json()["project"]
    profiles = ProfileService()
    profiles.update(
        project["profileId"],
        calibration={
            "calibration_x": 42,
            "calibration_y": 63,
            "pen_up_z": 12,
            "pen_down_z": 3,
        },
    )
    other = profiles.create("Other")
    profiles.activate(other["id"])

    moved = client.post(
        "/api/printer/home-and-move-to-position",
        json={
            "kind": "calibration",
            "projectId": project["id"],
        },
    )
    assert moved.status_code == 200
    assert moved.json()["position"]["x"] == 42
    assert moved.json()["position"]["y"] == 63
    assert moved.json()["position"]["z"] == 3
    assert (
        client.post(
            "/api/printer/calibration-height",
            json={
                "profile_id": project["profileId"],
                "project_id": project["id"],
                "offset": 1,
            },
        ).status_code
        == 200
    )


def test_park_uses_lift_height_without_saving_trial_target(controller, cal):
    cal.merged({"park_lift_z": 15}).save()
    before = Calibration.load().as_dict()
    position = controller.move_to_position("park", 40, 60)
    controller.client.gcode.assert_called_once_with(
        [
            "G90",
            "M203 Z60",
            "G0 Z7.400 F1602",
            "G0 Z15.000 F1602",
            "G0 X40.000 Y60.000 F6000",
        ]
    )
    assert (position["x"], position["y"], position["z"]) == (40, 60, 15)
    assert Calibration.load().as_dict() == before


def test_every_calibration_trial_lifts_before_travelling_and_lowers_after(controller):
    before = Calibration.load().as_dict()
    controller.move_to_position("calibration", 40, 60)
    controller.move_to_position("calibration", 41, 60)
    assert controller.client.gcode.call_count == 2
    for call in controller.client.gcode.call_args_list:
        commands = call.args[0]
        assert commands[2] == "G0 Z7.400 F1602"
        assert commands[3].startswith("G0 X")
        assert commands[4] == "G1 Z1.400 F1602"
    assert Calibration.load().as_dict() == before


@pytest.mark.parametrize("kind", ["park", "calibration"])
def test_capture_saves_only_selected_xy_without_motion(controller, cal, kind):
    before = cal.as_dict()
    controller.tracker.set_axes(x=40, y=60, z=20)
    updated = controller.position_from_head(kind).as_dict()
    fields = ("park_x", "park_y") if kind == "park" else ("calibration_x", "calibration_y")
    expected = {**before, fields[0]: 40, fields[1]: 60, "defined_positions": [kind]}
    assert updated == expected
    assert Calibration.load().as_dict() == expected
    controller.client.gcode.assert_not_called()


@pytest.mark.parametrize("kind", ["park", "calibration"])
@pytest.mark.parametrize("unavailable", ["offline", "unhomed", "printing", "locked"])
def test_special_position_actions_require_available_homed_printer(controller, kind, unavailable):
    if unavailable == "offline":
        controller.client.status.return_value = {"online": False}
    elif unavailable == "unhomed":
        controller.tracker.invalidate()
    elif unavailable == "printing":
        controller.client.status.return_value = {"job": {"state": "Printing"}}
    else:
        controller.client.status.return_value = {"motion_locked": True}
    before = Calibration.load().as_dict()
    for action in [
        lambda: controller.move_to_position(kind, 40, 60),
        lambda: controller.position_from_head(kind),
    ]:
        with pytest.raises((ServiceError, PrinterBusyError)):
            action()
    controller.client.gcode.assert_not_called()
    assert Calibration.load().as_dict() == before


@pytest.mark.parametrize(
    "updates", [{"park_lift_z": 0}, {"park_lift_z": 500}, {"park_lift_z": float("inf")}]
)
def test_invalid_park_height_does_not_move(controller, cal, updates):
    cal.merged(updates).save()
    with pytest.raises(ServiceError):
        controller.move_to_position("park", 40, 60)
    controller.client.gcode.assert_not_called()


def test_position_api_validates_target_and_capture_uses_current_head(controller, monkeypatch):
    from plotter.web.app import app
    from plotter.web.routes import calibration, printer

    monkeypatch.setattr(printer, "controller", lambda: controller)
    monkeypatch.setattr(calibration, "printer_controller", lambda: controller)
    client = TestClient(app)
    for body in [
        {"kind": "other"},
        {"kind": "park", "x": 40},
        {"kind": "park", "x": -1, "y": 60},
        {"kind": "park", "x": 40, "y": 600},
    ]:
        assert client.post("/api/printer/move-to-position", json=body).status_code == 422
    controller.client.gcode.assert_not_called()
    before = Calibration.load().as_dict()
    response = client.post(
        "/api/printer/move-to-position",
        json={
            "kind": "calibration",
            "x": 40,
            "y": 60,
        },
    )
    assert response.status_code == 200
    assert response.json()["position"]["z"] == 1.4
    assert Calibration.load().as_dict() == before
    controller.tracker.set_axes(x=41, y=62)
    response = client.post("/api/calibration/position-from-head", json={"kind": "calibration"})
    assert response.status_code == 200
    assert response.json()["calibration_x"] == 41
    assert response.json()["calibration_y"] == 62
    controller.client.gcode.assert_called_once()


def test_park_uses_saved_coordinates_when_target_is_omitted(controller, cal):
    cal.merged({"park_x": 50, "park_y": 70}).save()
    position = controller.move_to_position("park")
    assert (position["x"], position["y"], position["z"]) == (50, 70, cal.pen_up_z)


def test_capture_uses_current_active_profile(controller):
    profiles = ProfileService()
    original = profiles.active()
    other = profiles.create("Other", calibration={"calibration_x": 90, "calibration_y": 90})
    profiles.activate(other["id"])
    controller.tracker.set_axes(x=40, y=60)
    controller.position_from_head("calibration")
    assert profiles.active()["calibration"]["calibration_x"] == 40
    assert profiles.get(original["id"])["calibration"] == original["calibration"]


@pytest.mark.parametrize(
    ("offset", "expected_z"), [(-3, 0), (-1, 0.4), (0, 1.4), (1, 2.4), (3, 4.4)]
)
def test_manual_insertion_height_uses_signed_offset_and_clamps_at_zero(
    controller, cal, offset, expected_z
):
    controller.tracker.set_axes(x=105, y=105)
    before = cal.as_dict()
    pos = controller.calibration_height(offset)
    controller.client.gcode.assert_called_once_with(
        [
            "G90",
            "M203 Z60",
            f"G1 Z{expected_z:.3f} F1602",
        ]
    )
    assert pos["z"] == pytest.approx(expected_z)
    assert (pos["x"], pos["y"]) == (105, 105)
    assert Calibration.load().as_dict() == before


def test_manual_insertion_height_clamps_at_z_max(controller, cal):
    cal.merged({"z_max": 3}).save()
    controller.tracker.set_axes(x=105, y=105)
    assert controller.calibration_height(3)["z"] == 3
    assert controller.client.gcode.call_args.args[0][-1] == "G1 Z3.000 F1602"


@pytest.mark.parametrize("offset", [-3.1, 3.1, float("nan"), float("inf")])
def test_invalid_insertion_offset_sends_nothing(controller, offset):
    controller.tracker.set_axes(x=105, y=105)
    with pytest.raises(ServiceError):
        controller.calibration_height(offset)
    controller.client.gcode.assert_not_called()


@pytest.mark.parametrize("unavailable", ["offline", "unhomed", "printing", "locked", "not-at-c"])
def test_manual_insertion_height_requires_available_printer_at_c(controller, unavailable):
    controller.tracker.set_axes(x=105, y=105)
    if unavailable == "offline":
        controller.client.status.return_value = {"online": False}
    elif unavailable == "unhomed":
        controller.tracker.invalidate()
    elif unavailable == "printing":
        controller.client.status.return_value = {"job": {"state": "Printing"}}
    elif unavailable == "locked":
        controller.client.status.return_value = {"motion_locked": True}
    else:
        controller.tracker.set_axes(x=10, y=10)
    with pytest.raises((ServiceError, PrinterBusyError)):
        controller.calibration_height(1)
    controller.client.gcode.assert_not_called()


def test_failed_manual_height_command_does_not_update_tracker(controller):
    controller.tracker.set_axes(x=105, y=105)
    before = controller.position()
    controller.client.gcode.side_effect = RuntimeError("disconnected")
    with pytest.raises(RuntimeError):
        controller.calibration_height(1)
    assert controller.position() == before


def test_normal_c_move_never_applies_saved_pressure_offset(controller, cal):
    cal.merged({"calibration_pressure_offset": 3}).save()
    assert controller.move_to_calibration()["z"] == cal.pen_down_z
    assert controller.client.gcode.call_args.args[0][-1] == "G1 Z1.400 F1602"


@pytest.mark.parametrize("kind", ["park", "calibration"])
@pytest.mark.parametrize("already_homed", [False, True])
def test_home_and_visit_homes_before_moving_to_saved_position(controller, cal, kind, already_homed):
    if not already_homed:
        controller.tracker.invalidate()
    controller.home_and_move_to_position(kind)
    controller.client.home.assert_called_once_with(None)
    calls = controller.client.method_calls
    home_index = next(i for i, item in enumerate(calls) if item[0] == "home")
    travel_index = next(
        i
        for i, item in enumerate(calls)
        if item[0] == "gcode" and any(" X" in cmd for cmd in item[1][0])
    )
    assert home_index < travel_index
    assert controller.position()["homed"]
    assert (controller.position()["x"], controller.position()["y"]) == (
        cal.resolved_park()[:2] if kind == "park" else cal.resolved_calibration_position()
    )


def test_failed_homing_never_drives_to_special_position(controller):
    controller.client.home.side_effect = RuntimeError("homing failed")
    with pytest.raises(RuntimeError):
        controller.home_and_move_to_position("calibration")
    assert not any(
        " X" in cmd for call in controller.client.gcode.call_args_list for cmd in call.args[0]
    )


@pytest.mark.parametrize(
    "status", [{"online": False}, {"job": {"state": "Printing"}}, {"motion_locked": True}]
)
def test_home_and_visit_is_blocked_while_unavailable(controller, status):
    controller.client.status.return_value = status
    with pytest.raises((ServiceError, PrinterBusyError)):
        controller.home_and_move_to_position("park")
    controller.client.home.assert_not_called()
    controller.client.gcode.assert_not_called()


def test_pressure_api_rejects_wrong_profile_and_range_then_clamps_z(controller, monkeypatch):
    from plotter.web.app import app
    from plotter.web.routes import printer

    monkeypatch.setattr(printer, "controller", lambda: controller)
    client = TestClient(app)
    profile_id = ProfileService().active()["id"]
    controller.tracker.set_axes(x=105, y=105)
    for offset in [-4, 4]:
        assert (
            client.post(
                "/api/printer/calibration-height",
                json={
                    "profile_id": profile_id,
                    "offset": offset,
                },
            ).status_code
            == 422
        )
    assert (
        client.post(
            "/api/printer/calibration-height",
            json={
                "profile_id": "other",
                "offset": 1,
            },
        ).status_code
        == 409
    )
    controller.client.gcode.assert_not_called()
    response = client.post(
        "/api/printer/calibration-height",
        json={
            "profile_id": profile_id,
            "offset": -3,
        },
    )
    assert response.status_code == 200
    assert response.json()["position"]["z"] == 0
    response = client.post("/api/printer/home-and-move-to-position", json={"kind": "park"})
    assert response.status_code == 200
    controller.client.home.assert_called_once()
