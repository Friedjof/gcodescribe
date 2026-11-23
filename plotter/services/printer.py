from __future__ import annotations

import logging
import math

from plotter.core.calibration import (
    POSITION_FIELDS,
    Calibration,
    PositionKind,
    feed_word,
    z_max_feedrate_line,
)
from plotter.core.position import PositionTracker, get_tracker
from plotter.geometry.routing import OBSTACLE_MARGIN, route_travel, seg_intersects_obs
from plotter.printer.types import PrinterStatus

from ..printer import PrinterBackend, get_printer_client
from ..printer.base import PrinterBusyError, require_manual_motion
from .errors import NotHomedError, PrinterSetupRequiredError, ServiceError
from .profiles import ProfileService

log = logging.getLogger(__name__)


class PrinterController:
    """High-level printer motion.

    Every movement command goes through this class so the persisted position
    estimate always mirrors what was sent to the machine.
    """

    def __init__(
        self,
        client: PrinterBackend | None = None,
        tracker: PositionTracker | None = None,
    ):
        self.client = client or get_printer_client()
        self.tracker = tracker or get_tracker()

    # -- queries -----------------------------------------------------------

    def status(self) -> PrinterStatus:
        return self.client.status()

    def position(self) -> dict:
        return self.tracker.snapshot()

    # -- motion ------------------------------------------------------------

    def _require_manual_motion(self, action: str) -> None:
        status = self.client.status()
        if status.get("configured") is False:
            raise PrinterSetupRequiredError()
        job = status.get("job") or {}
        try:
            require_manual_motion(job.get("state"))
            if status.get("motion_locked") is True:
                raise PrinterBusyError("Bitte warten, bis die Stiftposition wiederhergestellt ist.")
        except PrinterBusyError:
            log.warning("Blocked manual printer command: %s (job: %s)", action, job)
            raise
        log.info("Manual printer command: %s (job state: %s)", action, job.get("state"))

    @staticmethod
    def _bounds(cal: Calibration, limit: str) -> tuple[float, float, float, float, float]:
        """(x0, y0, x1, y1, z_floor) of the allowed motion box."""
        if limit == "plot":
            # Plot area, and Z never below the calibrated paper contact.
            return (
                cal.origin_x,
                cal.origin_y,
                cal.origin_x + cal.plot_width,
                cal.origin_y + cal.plot_height,
                cal.pen_down_z,
            )
        if limit == "bed":
            return (0.0, 0.0, cal.bed_width, cal.bed_height, 0.0)
        raise ServiceError(f"unknown motion limit: {limit}")

    def home(self, axes: list[str] | None = None, *, cal: Calibration | None = None) -> dict:
        self._require_manual_motion("home")
        cal = cal or Calibration.load()
        self.tracker.z_max = cal.z_max
        home_axes = axes if cal.trust_axis_home else None
        # Lift the pen a little before homing so the X/Y homing travel can
        # never drag it across the paper.
        self.client.gcode(
            [z_max_feedrate_line(cal), "G91", f"G0 Z5 {feed_word(cal.z_feed)}", "G90"]
        )
        self.tracker.jog(0, 0, 5.0, cal.bed_width, cal.bed_height)
        self.client.home(home_axes)
        self.tracker.home(home_axes)
        return self.position()

    def jog(
        self,
        dx: float,
        dy: float,
        dz: float,
        speed: int | None = None,
        limit: str = "bed",
        *,
        cal: Calibration | None = None,
        pen_up_first: bool = False,
    ) -> dict:
        self._require_manual_motion(f"jog X{dx} Y{dy} Z{dz}")
        cal = cal or Calibration.load()
        self.tracker.z_max = cal.z_max
        pos = self.tracker.snapshot()
        if pos["homed"]:
            # Known position: clamp the target to the allowed box and send an
            # absolute move, so the limit is enforced on the real machine.
            x0, y0, x1, y1, z_floor = self._bounds(cal, limit)
            tx = min(max(pos["x"] + dx, x0), x1)
            ty = min(max(pos["y"] + dy, y0), y1)
            tz = min(max(pos["z"] + dz, z_floor), self.tracker.z_max)
            if pen_up_first and (dx or dy):
                tz = max(tz, self._raised_height(cal, pos["z"]))
            commands = ["G90"]
            if dz or (pen_up_first and (dx or dy)):
                commands.append(z_max_feedrate_line(cal))
                commands.append(f"G0 Z{tz:.3f} {feed_word(cal.z_feed)}")
            if dx or dy:
                commands.append(f"G0 X{tx:.3f} Y{ty:.3f} {feed_word(cal.travel_feed)}")
            if len(commands) > 1:
                self.client.gcode(commands)
            self.tracker.set_axes(x=tx, y=ty, z=tz)
        else:
            if pen_up_first:
                raise NotHomedError()
            if limit != "bed":
                raise NotHomedError()
            self.client.jog(dx, dy, dz, speed)
            self.tracker.jog(dx, dy, dz, cal.bed_width, cal.bed_height)
        return self.position()

    @staticmethod
    def _raised_height(cal: Calibration, current_z: float) -> float:
        if not (math.isfinite(cal.pen_up_z) and 0 < cal.pen_up_z <= cal.z_max):
            raise ServiceError("Die Abhebehöhe ist ungültig. Zuerst eine gültige Höhe einstellen.")
        height = max(cal.pen_up_z, current_z)
        if not math.isfinite(height) or height > cal.z_max:
            raise ServiceError("Die aktuelle Stifthöhe liegt außerhalb des Verfahrbereichs.")
        return height

    def raise_pen(self, *, cal: Calibration | None = None) -> dict:
        """Paper-view baseline: lift to clearance, never descend from a higher Z."""
        self._require_position_action("calibration")
        cal = cal or Calibration.load()
        height = self._raised_height(cal, self.tracker.snapshot()["z"])
        self.client.gcode(
            [
                "G90",
                z_max_feedrate_line(cal),
                f"G0 Z{height:.3f} {feed_word(cal.z_feed)}",
                "M400",
            ]
        )
        self.tracker.set_axes(z=height)
        return self.position()

    def move_to(
        self,
        x: float,
        y: float,
        *,
        pen_up_first: bool = True,
        limit: str = "bed",
        cal: Calibration | None = None,
    ) -> dict:
        """Absolute XY move, clamped to the allowed box. Requires a known position."""
        self._require_manual_motion(f"move X{x} Y{y}")
        if not self.tracker.homed:
            raise NotHomedError()
        cal = cal or Calibration.load()
        x0, y0, x1, y1, _ = self._bounds(cal, limit)
        x = min(max(x, x0), x1)
        y = min(max(y, y0), y1)
        commands = ["G90"]
        if pen_up_first:
            commands.append(z_max_feedrate_line(cal))
            commands.append(f"G0 Z{cal.pen_up_z:.3f} {feed_word(cal.z_feed)}")
        if pen_up_first and cal.obstacles:
            cur = self.tracker.snapshot()
            for wx, wy in route_travel((cur["x"], cur["y"]), (x, y), cal.obstacles):
                commands.append(f"G0 X{wx:.3f} Y{wy:.3f} {feed_word(cal.travel_feed)}")
        else:
            commands.append(f"G0 X{x:.3f} Y{y:.3f} {feed_word(cal.travel_feed)}")
        self.client.gcode(commands)
        self.tracker.set_axes(x=x, y=y, z=cal.pen_up_z if pen_up_first else None)
        return self.position()

    def move_to_calibration(self, *, cal: Calibration | None = None) -> dict:
        """Compatibility entry point for the editor shortcut."""
        return self.move_to_position("calibration", cal=cal)

    def home_and_move_to_position(
        self,
        kind: PositionKind,
        *,
        cal: Calibration | None = None,
        lift_only: bool = False,
        insert_pen: bool = False,
    ) -> dict:
        """Explicitly home all axes, then visit the chosen saved position."""
        if kind not in POSITION_FIELDS:
            raise ServiceError(f"unknown position type: {kind}")
        if self.client.status().get("online") is False:
            raise ServiceError("Drucker ist nicht verbunden.")
        if insert_pen:
            cal = cal or Calibration.load()
            if kind != "calibration" or lift_only:
                raise ServiceError("Stift-Einsetzen benötigt die Kalibrierungsposition.")
            offset = cal.calibration_pressure_offset
            if not math.isfinite(offset) or not -3 <= offset <= 3:
                raise ServiceError("Der gespeicherte Anpressdruck-Versatz ist ungültig.")
            if not 0 <= cal.pen_down_z < cal.pen_up_z <= cal.z_max:
                raise ServiceError("Die Stifthöhen im Projektprofil sind ungültig.")
            self._validate_position(cal, *cal.resolved_calibration_position())
            self.home(cal=cal)
            self.move_to_position(kind, cal=cal, lift_only=True)
            return self.calibration_height(offset, cal=cal)
        self.home(cal=cal)
        return self.move_to_position(kind, cal=cal, lift_only=lift_only)

    def calibration_height(self, offset: float, *, cal: Calibration | None = None) -> dict:
        """Manually adjust insertion Z at C. Never alter the plotting pen heights."""
        self._require_position_action("calibration")
        cal = cal or Calibration.load()
        if not math.isfinite(offset) or not -3 <= offset <= 3:
            raise ServiceError("Der Anpressdruck-Versatz muss zwischen −3 und +3 mm liegen.")
        if not (
            math.isfinite(cal.pen_down_z)
            and math.isfinite(cal.z_max)
            and 0 <= cal.pen_down_z <= cal.z_max
        ):
            raise ServiceError("Die Stifthöhen im aktiven Profil sind ungültig.")
        x, y = cal.resolved_calibration_position()
        self._validate_position(cal, x, y)
        pos = self.tracker.snapshot()
        if abs(pos["x"] - x) > 0.1 or abs(pos["y"] - y) > 0.1:
            raise ServiceError("Zuerst die gespeicherte Position C anfahren.")
        # Raising the empty holder before inserting the pen creates more
        # pressure later at pen_down_z. Clamp the actual command, not just UI.
        z = min(cal.z_max, max(0.0, cal.pen_down_z + offset))
        self.client.gcode(
            [
                "G90",
                z_max_feedrate_line(cal),
                f"G1 Z{z:.3f} {feed_word(cal.z_feed)}",
            ]
        )
        self.tracker.set_axes(z=z)
        return self.position()

    def _require_position_action(self, kind: PositionKind) -> None:
        if kind not in POSITION_FIELDS:
            raise ServiceError(f"unknown position type: {kind}")
        self._require_manual_motion(f"special position: {kind}")
        if self.client.status().get("online") is False:
            raise ServiceError("Drucker ist nicht verbunden.")
        if not self.tracker.homed:
            raise NotHomedError()

    @staticmethod
    def _validate_position(cal: Calibration, x: float, y: float) -> None:
        if not (
            math.isfinite(x)
            and math.isfinite(y)
            and 0 <= x <= cal.bed_width
            and 0 <= y <= cal.bed_height
        ):
            raise ServiceError("Die Position muss innerhalb des Druckbetts liegen.")
        if any(seg_intersects_obs((x, y), (x, y), obs, OBSTACLE_MARGIN) for obs in cal.obstacles):
            raise ServiceError("Die Position liegt in einem Sperrbereich.")

    def move_to_position(
        self,
        kind: PositionKind,
        x: float | None = None,
        y: float | None = None,
        *,
        cal: Calibration | None = None,
        lift_only: bool = False,
    ) -> dict:
        """Try an XY target or visit a saved position, without saving calibration."""
        self._require_position_action(kind)
        cal = cal or Calibration.load()
        if (x is None) != (y is None):
            raise ServiceError("X und Y müssen gemeinsam angegeben werden.")
        if x is None:
            values = cal.as_dict()
            x_field, y_field = POSITION_FIELDS[kind]
            x, y = values[x_field], values[y_field]
        self._validate_position(cal, x, y)
        if not (
            math.isfinite(cal.pen_down_z)
            and math.isfinite(cal.pen_up_z)
            and (lift_only or 0 <= cal.pen_down_z < cal.pen_up_z)
            and 0 < cal.pen_up_z <= cal.z_max
        ):
            raise ServiceError("Die Stifthöhen im aktiven Profil sind ungültig.")

        lift_z = cal.resolved_park()[2] if kind == "park" else cal.pen_up_z
        if lift_only:
            lift_z = max(lift_z, self.tracker.snapshot()["z"])
        floor = 0 if lift_only else cal.pen_down_z
        if not math.isfinite(lift_z) or not floor < lift_z <= cal.z_max:
            raise ServiceError("Die Park-Abhebehöhe im aktiven Profil ist ungültig.")

        cur = self.tracker.snapshot()
        start = (cur["x"], cur["y"])
        waypoints = route_travel(start, (x, y), cal.obstacles)
        previous = start
        for waypoint in waypoints:
            wx, wy = waypoint
            if not (0 <= wx <= cal.bed_width and 0 <= wy <= cal.bed_height) or any(
                seg_intersects_obs(previous, waypoint, obs, OBSTACLE_MARGIN)
                for obs in cal.obstacles
            ):
                raise ServiceError("Kein freier Fahrweg zur Sonderposition.")
            previous = waypoint

        commands = [
            "G90",
            z_max_feedrate_line(cal),
            f"G0 Z{lift_z if lift_only else cal.pen_up_z:.3f} {feed_word(cal.z_feed)}",
        ]
        if not lift_only and lift_z != cal.pen_up_z:
            commands.append(f"G0 Z{lift_z:.3f} {feed_word(cal.z_feed)}")
        commands.extend(
            f"G0 X{wx:.3f} Y{wy:.3f} {feed_word(cal.travel_feed)}" for wx, wy in waypoints
        )
        if kind == "calibration" and not lift_only:
            commands.append(f"G1 Z{cal.pen_down_z:.3f} {feed_word(cal.z_feed)}")
        self.client.gcode(commands)
        self.tracker.set_axes(
            x=x, y=y, z=cal.pen_down_z if kind == "calibration" and not lift_only else lift_z
        )
        return self.position()

    def test_dot(self, *, cal: Calibration | None = None) -> dict:
        """Mark the current XY point with one indivisible command batch."""
        self._require_position_action("calibration")
        cal = cal or Calibration.load()
        pos = self.tracker.snapshot()
        self._validate_position(cal, pos["x"], pos["y"])
        if not cal.pen_calibrated or not (
            math.isfinite(cal.pen_down_z)
            and math.isfinite(cal.pen_up_z)
            and 0 <= cal.pen_down_z < cal.pen_up_z <= cal.z_max
        ):
            raise ServiceError("Zuerst Papierkontakt und Abhebehöhe kalibrieren.")
        self.client.gcode(
            [
                "G90",
                z_max_feedrate_line(cal),
                f"G1 Z{cal.pen_down_z:.3f} {feed_word(cal.z_feed)}",
                "G4 P100",
                f"G0 Z{cal.pen_up_z:.3f} {feed_word(cal.z_feed)}",
                "M400",
            ]
        )
        self.tracker.set_axes(z=cal.pen_up_z)
        return self.position()

    def position_from_head(
        self,
        kind: PositionKind,
        *,
        cal: Calibration | None = None,
        profile_id: str | None = None,
    ) -> Calibration:
        """Capture only XY; the active profile's pen/park heights stay unchanged."""
        self._require_position_action(kind)
        if cal is None:
            cal = (
                Calibration.from_dict(ProfileService().get(profile_id)["calibration"])
                if profile_id is not None
                else Calibration.load()
            )
        pos = self.tracker.snapshot()
        self._validate_position(cal, pos["x"], pos["y"])
        x_field, y_field = POSITION_FIELDS[kind]
        cal = cal.merged({x_field: pos["x"], y_field: pos["y"]})
        self._save_calibration(cal, profile_id)
        return cal

    CORNERS = ("bl", "br", "tr", "tl")

    @staticmethod
    def _rect_corner(rect: tuple[float, float, float, float], corner: str) -> tuple[float, float]:
        x, y, w, h = rect
        return {
            "bl": (x, y),
            "br": (x + w, y),
            "tr": (x + w, y + h),
            "tl": (x, y + h),
        }[corner]

    def move_to_corner(
        self, corner: str, target: str = "paper", *, cal: Calibration | None = None
    ) -> dict:
        """Drive to a paper or plot-area corner.

        The pen is always lifted to ``pen_up_z`` before any XY motion —
        this is not optional.
        """
        if corner not in self.CORNERS:
            raise ServiceError(f"unknown corner: {corner}")
        cal = cal or Calibration.load()
        if target == "paper":
            point = cal.paper_corners.get(corner)
            if point is None:
                rect = cal.paper_rect()
                if rect is None:
                    raise ServiceError(
                        "Ecke nicht gesetzt und kein Papier erfasst — erst Ecken setzen."
                    )
                point = self._rect_corner(rect, corner)
        elif target == "plot":
            point = self._rect_corner(
                (cal.origin_x, cal.origin_y, cal.plot_width, cal.plot_height), corner
            )
        else:
            raise ServiceError(f"unknown corner target: {target}")
        # move_to raises NotHomedError if the position is unknown and always
        # sends the Z lift before the XY travel.
        return self.move_to(float(point[0]), float(point[1]), pen_up_first=True, cal=cal)

    def pen(self, down: bool, *, cal: Calibration | None = None) -> dict:
        self._require_manual_motion("pen down" if down else "pen up")
        cal = cal or Calibration.load()
        z = cal.pen_down_z if down else cal.pen_up_z
        self.client.gcode([z_max_feedrate_line(cal), "G90", f"G1 Z{z:.3f} {feed_word(cal.z_feed)}"])
        self.tracker.set_axes(z=z)
        return {"z": z, "position": self.position()}

    def speed_test(self, *, cal: Calibration | None = None) -> dict:
        """Home, then trace a large house, spiral and circle with the pen lifted."""
        self._require_manual_motion("speed test")
        if self.client.status().get("online") is not True:
            raise ServiceError("Drucker ist nicht verbunden.")
        cal = cal or Calibration.load()
        values = (
            cal.bed_width,
            cal.bed_height,
            cal.origin_x,
            cal.origin_y,
            cal.plot_width,
            cal.plot_height,
            cal.z_max,
            cal.pen_up_z,
            cal.pen_down_z,
            cal.travel_feed,
            cal.z_feed,
            cal.z_max_feedrate,
        )
        if not all(math.isfinite(value) for value in values):
            raise ServiceError("Position oder Kalibrierung enthält ungültige Werte.")
        if not (
            cal.bed_width > 0
            and cal.bed_height > 0
            and cal.z_max > 0
            and 0 <= cal.pen_down_z < cal.pen_up_z <= cal.z_max
            and cal.travel_feed > 0
            and cal.z_feed > 0
            and cal.z_max_feedrate > 0
        ):
            raise ServiceError("Stifthöhen, Bettgrenzen oder Geschwindigkeiten sind ungültig.")
        x0, y0 = cal.origin_x, cal.origin_y
        x1, y1 = x0 + cal.plot_width, y0 + cal.plot_height
        if not (0 <= x0 < x1 <= cal.bed_width and 0 <= y0 < y1 <= cal.bed_height):
            raise ServiceError("Der Plotbereich liegt außerhalb des Druckbetts.")

        side = min(cal.plot_width * 0.55, cal.plot_height * 0.55)
        if side < 10:
            raise ServiceError(
                "Der Plotbereich ist für den Bewegungstest zu klein (mindestens 20 × 20 mm)."
            )
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        center = (cx, cy)
        left, bottom = cx - side / 2, cy - side * 0.75
        house = [
            (left, bottom),
            (left, bottom + side),
            (cx, bottom + side * 1.5),
            (left + side, bottom + side),
            (left, bottom + side),
            (left + side, bottom),
            (left + side, bottom + side),
            (left, bottom),
            (left + side, bottom),
        ]
        radius = min(cal.plot_width, cal.plot_height) * 0.42
        turns = 4
        # Bound the longest chord at the outer turn, and use a finer spacing
        # for the closing circle. The point density scales with the plot area.
        spiral_steps = max(turns * 64, math.ceil(math.tau * turns * radius / 2.0))
        circle_steps = max(128, math.ceil(math.tau * radius / 1.5))
        spiral = [center]
        for i in range(1, spiral_steps + 1):
            angle = math.tau * turns * i / spiral_steps
            r = radius * i / spiral_steps
            spiral.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
        for i in range(1, circle_steps + 1):
            angle = math.tau * turns + math.tau * i / circle_steps
            spiral.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))

        # Validate the complete rounded path before sending any command.
        def point(p):
            return (round(p[0], 3), round(p[1], 3))

        center = point(center)
        house, spiral = [point(p) for p in house], [point(p) for p in spiral]
        to_center = [point(p) for p in route_travel((0.0, 0.0), center, cal.obstacles)]
        to_house = [point(p) for p in route_travel(center, house[0], cal.obstacles)]
        to_spiral = [point(p) for p in route_travel(house[-1], center, cal.obstacles)]

        def clear_segment(a: tuple[float, float], b: tuple[float, float], motif: bool) -> bool:
            bounds = (x0, y0, x1, y1) if motif else (0.0, 0.0, cal.bed_width, cal.bed_height)
            ax0, ay0, ax1, ay1 = bounds
            return (
                ax0 <= a[0] <= ax1
                and ay0 <= a[1] <= ay1
                and ax0 <= b[0] <= ax1
                and ay0 <= b[1] <= ay1
                and not any(seg_intersects_obs(a, b, obs, OBSTACLE_MARGIN) for obs in cal.obstacles)
            )

        for route_start, route in (
            ((0.0, 0.0), to_center),
            (center, to_house),
            (house[-1], to_spiral),
        ):
            previous = route_start
            for target in route:
                if not clear_segment(previous, target, False):
                    raise ServiceError("Kein freier Fahrweg zum Bewegungstest.")
                previous = target
        for path in (house, spiral):
            for a, b in zip(path, path[1:], strict=False):
                if not clear_segment(a, b, True):
                    raise ServiceError("Der Bewegungstest passt nicht frei in den Plotbereich.")

        def travel(p):
            return f"G0 X{p[0]:.3f} Y{p[1]:.3f} {feed_word(cal.travel_feed)}"

        commands = [
            "G90",
            z_max_feedrate_line(cal),
            f"G0 Z{cal.pen_up_z:.3f} {feed_word(cal.z_feed)}",
        ]
        commands.extend(travel(p) for p in to_center)
        commands.extend(travel(p) for p in to_house)
        commands.extend(travel(p) for p in house[1:])
        commands.extend(travel(p) for p in to_spiral)
        commands.extend(travel(p) for p in spiral[1:])
        self.home(cal=cal)
        self.client.gcode(commands)
        self.tracker.set_axes(x=spiral[-1][0], y=spiral[-1][1], z=cal.pen_up_z)
        return {"size": side, "travelFeed": cal.travel_feed, "position": self.position()}

    def raw_gcode(self, commands: list[str]) -> None:
        self._require_manual_motion("raw G-code")
        self.client.gcode(commands)
        # Raw G-code may move the head in ways we can't track.
        for cmd in commands:
            head = cmd.strip().upper()
            if head.startswith("G28"):
                self.tracker.home(["x", "y", "z"])
            elif head.startswith(("G0", "G1", "G92")) and ("X" in head or "Y" in head):
                self.tracker.invalidate()

    # -- pen height calibration ---------------------------------------------

    @staticmethod
    def _save_calibration(cal: Calibration, profile_id: str | None) -> None:
        if profile_id is not None:
            ProfileService().save_calibration(profile_id, cal)
        else:
            cal.save()

    def pen_height_from_position(
        self, which: str, *, cal: Calibration | None = None, profile_id: str | None = None
    ) -> Calibration:
        """Store the current Z as pen-down or pen-up height."""
        self._require_manual_motion("capture pen height")
        if which not in ("up", "down"):
            raise ServiceError(f"unknown pen height: {which}")
        pos = self.tracker.snapshot()
        if "z" not in pos["homed_axes"]:
            raise NotHomedError("Z-Position unbekannt — bitte zuerst homen.")
        if cal is None:
            cal = (
                Calibration.from_dict(ProfileService().get(profile_id)["calibration"])
                if profile_id is not None
                else Calibration.load()
            )
        updates = {("pen_up_z" if which == "up" else "pen_down_z"): pos["z"]}
        if which == "down":
            # The pen-down height is the critical paper-contact reference;
            # capturing it marks the pen as calibrated.
            updates["pen_calibrated"] = True
            if cal.pen_up_z <= pos["z"]:
                # Keep pen-up above pen-down so travels never drag the pen.
                updates["pen_up_z"] = round(pos["z"] + 5.0, 3)
        cal = cal.merged(updates)
        self._save_calibration(cal, profile_id)
        return cal
