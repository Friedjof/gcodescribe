from __future__ import annotations

from ..calibration import Calibration
from ..position import PositionTracker, get_tracker
from ..printer import PrinterBackend, get_printer_client
from .errors import NotHomedError, ServiceError


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

    def status(self) -> dict:
        return self.client.status()

    def position(self) -> dict:
        return self.tracker.snapshot()

    # -- motion ------------------------------------------------------------

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

    def home(self, axes: list[str] | None = None) -> dict:
        cal = Calibration.load()
        self.tracker.z_max = cal.z_max
        home_axes = axes if cal.trust_axis_home else None
        # Lift the pen a little before homing so the X/Y homing travel can
        # never drag it across the paper.
        self.client.gcode(["G91", f"G0 Z5 F{cal.z_feed:.0f}", "G90"])
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
    ) -> dict:
        cal = Calibration.load()
        self.tracker.z_max = cal.z_max
        pos = self.tracker.snapshot()
        if pos["homed"]:
            # Known position: clamp the target to the allowed box and send an
            # absolute move, so the limit is enforced on the real machine.
            x0, y0, x1, y1, z_floor = self._bounds(cal, limit)
            tx = min(max(pos["x"] + dx, x0), x1)
            ty = min(max(pos["y"] + dy, y0), y1)
            tz = min(max(pos["z"] + dz, z_floor), self.tracker.z_max)
            commands = ["G90"]
            if dz:
                commands.append(f"G0 Z{tz:.3f} F{cal.z_feed:.0f}")
            if dx or dy:
                commands.append(f"G0 X{tx:.3f} Y{ty:.3f} F{cal.travel_feed:.0f}")
            if len(commands) > 1:
                self.client.gcode(commands)
            self.tracker.set_axes(x=tx, y=ty, z=tz)
        else:
            if limit != "bed":
                raise NotHomedError()
            self.client.jog(dx, dy, dz, speed)
            self.tracker.jog(dx, dy, dz, cal.bed_width, cal.bed_height)
        return self.position()

    def move_to(
        self,
        x: float,
        y: float,
        *,
        pen_up_first: bool = True,
        limit: str = "bed",
    ) -> dict:
        """Absolute XY move, clamped to the allowed box. Requires a known position."""
        if not self.tracker.homed:
            raise NotHomedError()
        cal = Calibration.load()
        x0, y0, x1, y1, _ = self._bounds(cal, limit)
        x = min(max(x, x0), x1)
        y = min(max(y, y0), y1)
        commands = ["G90"]
        if pen_up_first:
            commands.append(f"G0 Z{cal.pen_up_z:.3f} F{cal.z_feed:.0f}")
        commands.append(f"G0 X{x:.3f} Y{y:.3f} F{cal.travel_feed:.0f}")
        self.client.gcode(commands)
        self.tracker.set_axes(x=x, y=y, z=cal.pen_up_z if pen_up_first else None)
        return self.position()

    CORNERS = ("bl", "br", "tr", "tl")

    @staticmethod
    def _rect_corner(
        rect: tuple[float, float, float, float], corner: str
    ) -> tuple[float, float]:
        x, y, w, h = rect
        return {
            "bl": (x, y),
            "br": (x + w, y),
            "tr": (x + w, y + h),
            "tl": (x, y + h),
        }[corner]

    def move_to_corner(self, corner: str, target: str = "paper") -> dict:
        """Drive to a paper or plot-area corner.

        The pen is always lifted to ``pen_up_z`` before any XY motion —
        this is not optional.
        """
        if corner not in self.CORNERS:
            raise ServiceError(f"unknown corner: {corner}")
        cal = Calibration.load()
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
        return self.move_to(float(point[0]), float(point[1]), pen_up_first=True)

    def pen(self, down: bool) -> dict:
        cal = Calibration.load()
        z = cal.pen_down_z if down else cal.pen_up_z
        self.client.gcode(["G90", f"G1 Z{z:.3f} F{cal.z_feed:.0f}"])
        self.tracker.set_axes(z=z)
        return {"z": z, "position": self.position()}

    def raw_gcode(self, commands: list[str]) -> None:
        self.client.gcode(commands)
        # Raw G-code may move the head in ways we can't track.
        for cmd in commands:
            head = cmd.strip().upper()
            if head.startswith("G28"):
                self.tracker.home(["x", "y", "z"])
            elif head.startswith(("G0", "G1", "G92")) and ("X" in head or "Y" in head):
                self.tracker.invalidate()

    # -- pen height calibration ---------------------------------------------

    def pen_height_from_position(self, which: str) -> Calibration:
        """Store the current Z as pen-down or pen-up height."""
        if which not in ("up", "down"):
            raise ServiceError(f"unknown pen height: {which}")
        pos = self.tracker.snapshot()
        if "z" not in pos["homed_axes"]:
            raise NotHomedError("Z-Position unbekannt — bitte zuerst homen.")
        cal = Calibration.load()
        updates = {("pen_up_z" if which == "up" else "pen_down_z"): pos["z"]}
        if which == "down":
            # The pen-down height is the critical paper-contact reference;
            # capturing it marks the pen as calibrated.
            updates["pen_calibrated"] = True
            if cal.pen_up_z <= pos["z"]:
                # Keep pen-up above pen-down so travels never drag the pen.
                updates["pen_up_z"] = round(pos["z"] + 5.0, 3)
        cal = cal.merged(updates)
        cal.save()
        return cal
