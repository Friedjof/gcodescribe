from __future__ import annotations

from .calibration import Calibration
from .export import calibration_comment
from .safety import GcodeSafetyChecker


def build_vpype_config(cal: Calibration, profile: str = "plotter") -> str:
    """Render a vpype-gcode config from calibration values.

    The ``{x}`` / ``{y}`` placeholders stay literal so vpype fills them per
    point; everything else (pen heights, feedrates) is baked in here.
    """
    pen_up = (
        f"G0 Z{cal.pen_up_z:.3f} F{cal.z_feed:.0f}\n"
    )
    pen_down = (
        f"G1 Z{cal.pen_down_z:.3f} F{cal.z_feed:.0f}\n"
    )

    # Never home inside a job. Machine Z=0 is bed level, not pen level (there
    # is paper on the bed), so an in-job G28 could crush the pen.
    # The app refuses to start a print unless the machine was homed, so the
    # absolute coordinates are already trustworthy. First motion: lift the pen.
    document_start = f"G21\nG90\n{pen_up}"
    # New polyline: lift, travel to first point, drop.
    segment_first = (
        f"{pen_up}"
        f"G0 X{{x:.4f}} Y{{y:.4f}} F{cal.travel_feed:.0f}\n"
        f"{pen_down}"
    )
    segment = f"G1 X{{x:.4f}} Y{{y:.4f}} F{cal.draw_feed:.0f}\n"
    document_end = f"{pen_up}G0 X0 Y0 F{cal.travel_feed:.0f}\nM2\n"

    def esc(value: str) -> str:
        return value.replace("\n", "\\n")

    return "\n".join(
        [
            "[gwrite]",
            f'default_profile = "{profile}"',
            "",
            f"[gwrite.{profile}]",
            f'document_start = "{esc(document_start)}"',
            f'segment_first = "{esc(segment_first)}"',
            f'segment = "{esc(segment)}"',
            f'document_end = "{esc(document_end)}"',
            'unit = "mm"',
            # Y handling is done explicitly in layout_operations, not here.
            "vertical_flip = false",
            "",
        ]
    )


def layout_operations(cal: Calibration) -> list[str]:
    """Extra vpype operations applied between read and gwrite.

    ``layout`` sets the page size to the plot area and (optionally) scales the
    drawing to fit it, centered. Setting the page to ``plot_height`` makes
    gwrite's ``vertical_flip`` flip about the correct height, so coordinates
    land in ``[0, plot_*]``. A final ``translate`` shifts into the usable bed
    area by the origin offset.
    """
    ops: list[str] = ["layout"]
    if cal.plot_width > cal.plot_height:
        ops.append("--landscape")
    if cal.fit_to_area:
        ops += ["--fit-to-margins", "0mm"]
    ops.append(f"{cal.plot_width}x{cal.plot_height}mm")

    # SVG y points down; the printer's y points up. Mirror about y=0, then
    # shift so the drawing sits in [origin, origin + plot_*] on the bed.
    if cal.flip_y:
        ops += ["scale", "-o", "0", "0", "--", "1", "-1"]
        ops += ["translate", f"{cal.origin_x}mm", f"{cal.origin_y + cal.plot_height}mm"]
    elif cal.origin_x or cal.origin_y:
        ops += ["translate", f"{cal.origin_x}mm", f"{cal.origin_y}mm"]
    return ops


# --- Test patterns -------------------------------------------------------

def _header(cal: Calibration) -> list[str]:
    # No homing inside jobs (see build_vpype_config); lift the pen first.
    return ["G21", "G90", f"G0 Z{cal.pen_up_z:.3f} F{cal.z_feed:.0f}"]


def _footer(cal: Calibration) -> list[str]:
    return [
        f"G0 Z{cal.pen_up_z:.3f} F{cal.z_feed:.0f}",
        f"G0 X0 Y0 F{cal.travel_feed:.0f}",
        "M2",
    ]


def _pen_down(cal: Calibration) -> str:
    return f"G1 Z{cal.pen_down_z:.3f} F{cal.z_feed:.0f}"


def _pen_up(cal: Calibration) -> str:
    return f"G0 Z{cal.pen_up_z:.3f} F{cal.z_feed:.0f}"


def _move(cal: Calibration, x: float, y: float, draw: bool) -> str:
    feed = cal.draw_feed if draw else cal.travel_feed
    cmd = "G1" if draw else "G0"
    return f"{cmd} X{x:.3f} Y{y:.3f} F{feed:.0f}"


def test_pattern(name: str, cal: Calibration) -> str:
    """Return G-code for a named calibration pattern."""
    x0, y0 = cal.origin_x, cal.origin_y
    x1, y1 = cal.origin_x + cal.plot_width, cal.origin_y + cal.plot_height
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    lines = _header(cal)

    if name == "frame":
        lines += [
            _move(cal, x0, y0, False),
            _pen_down(cal),
            _move(cal, x1, y0, True),
            _move(cal, x1, y1, True),
            _move(cal, x0, y1, True),
            _move(cal, x0, y0, True),
            _pen_up(cal),
        ]
    elif name == "cross":
        lines += [
            _move(cal, cx, y0, False),
            _pen_down(cal),
            _move(cal, cx, y1, True),
            _pen_up(cal),
            _move(cal, x0, cy, False),
            _pen_down(cal),
            _move(cal, x1, cy, True),
            _pen_up(cal),
        ]
    elif name == "pen":
        # Lower and lift the pen at center a few times to check contact.
        lines += [_move(cal, cx, cy, False)]
        for _ in range(3):
            lines += [_pen_down(cal), "G4 P500", _pen_up(cal), "G4 P500"]
    elif name == "grid":
        step = min(cal.plot_width, cal.plot_height) / 5
        x = x0
        while x <= x1 + 1e-6:
            lines += [
                _move(cal, x, y0, False),
                _pen_down(cal),
                _move(cal, x, y1, True),
                _pen_up(cal),
            ]
            x += step
        y = y0
        while y <= y1 + 1e-6:
            lines += [
                _move(cal, x0, y, False),
                _pen_down(cal),
                _move(cal, x1, y, True),
                _pen_up(cal),
            ]
            y += step
    else:
        raise ValueError(f"Unbekanntes Test-Pattern: {name}")

    lines += _footer(cal)
    gcode = "\n".join(lines) + "\n"
    # Every job embeds its calibration and must pass the bounds check.
    GcodeSafetyChecker(cal).check(gcode, name=f"Test-Pattern '{name}'")
    return calibration_comment(cal) + gcode


TEST_PATTERNS = ["frame", "cross", "pen", "grid"]
