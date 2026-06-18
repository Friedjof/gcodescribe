from __future__ import annotations

import re

from .calibration import Calibration
from .services.errors import ServiceError

_WORD = re.compile(r"([A-Z])(-?\d+(?:\.\d+)?)")


class SafetyViolation(ServiceError):
    """Generated G-code would leave the configured bounds. Job is rejected."""

    status_code = 422


class GcodeSafetyChecker:
    """Validates generated G-code against the calibration before it may be
    saved or sent to the printer.

    Rules:
    - No homing at all inside a job (any ``G28``): machine Z=0 is bed level,
      not pen level — with paper on the bed that crushes the pen into it.
      Homing happens once via the app instead, before the job starts.
    - Every Z target must be exactly one of the two calibrated pen heights
      (``pen_up_z`` / ``pen_down_z``) — no other height is ever allowed.
    - The very first motion must lift the pen to ``pen_up_z``.
    - While the pen is down, XY must stay inside the plot area.
    - While the pen is up, XY must stay inside the bed.
    - Only absolute positioning (``G91`` is rejected).
    """

    TOL = 0.05  # mm tolerance for float rounding

    def __init__(self, cal: Calibration):
        self.cal = cal

    def check(self, gcode: str, name: str = "G-code") -> None:
        cal = self.cal
        tol = self.TOL
        px0, py0 = cal.origin_x, cal.origin_y
        px1, py1 = px0 + cal.plot_width, py0 + cal.plot_height
        x = y = 0.0
        z: float | None = None  # unknown until the job lifts the pen

        def fail(line_no: int, line: str, why: str) -> None:
            raise SafetyViolation(f"{name}, Zeile {line_no}: {why} ({line.strip()!r})")

        for line_no, raw in enumerate(gcode.splitlines(), start=1):
            line = raw.split(";", 1)[0].strip().upper()
            if not line:
                continue
            tokens = line.split()
            head = tokens[0]

            if head == "G91":
                fail(line_no, raw, "relative Positionierung ist nicht erlaubt")
            if head == "G28":
                fail(
                    line_no, raw,
                    "Homing im Job ist verboten — G28 setzt Z auf Bettniveau "
                    "(nicht Papierniveau) und zerstört die Stift-Höhe",
                )

            words = {k: float(v) for k, v in _WORD.findall(line)}
            g = words.get("G")
            if g not in (0.0, 1.0):
                continue  # G4, G21, G90, M-codes …

            nx = words.get("X", x)
            ny = words.get("Y", y)
            nz = words.get("Z", z)

            if "Z" in words:
                # Strict height discipline: only the two calibrated pen
                # heights are ever allowed as Z targets.
                if not (
                    abs(nz - cal.pen_up_z) <= tol or abs(nz - cal.pen_down_z) <= tol
                ):
                    fail(
                        line_no, raw,
                        f"Z {nz:.3f} ist keine kalibrierte Stift-Höhe "
                        f"(oben {cal.pen_up_z:.3f}, unten {cal.pen_down_z:.3f})",
                    )
            if "X" in words or "Y" in words:
                if z is None:
                    fail(line_no, raw, "XY-Bewegung bevor der Stift angehoben wurde")
                pen_down = z < cal.pen_up_z - tol
                if pen_down:
                    if not (px0 - tol <= nx <= px1 + tol and py0 - tol <= ny <= py1 + tol):
                        fail(
                            line_no, raw,
                            f"Zeichnen bei ({nx:.2f}, {ny:.2f}) außerhalb des Plotbereichs "
                            f"[{px0:.1f}–{px1:.1f}] × [{py0:.1f}–{py1:.1f}]",
                        )
                else:
                    in_bed = (
                        -tol <= nx <= cal.bed_width + tol
                        and -tol <= ny <= cal.bed_height + tol
                    )
                    if not in_bed:
                        fail(line_no, raw, f"Travel bei ({nx:.2f}, {ny:.2f}) außerhalb des Betts")

            x, y = nx, ny
            if nz is not None:
                z = nz
