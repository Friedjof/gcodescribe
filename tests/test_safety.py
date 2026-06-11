from __future__ import annotations

import re

import pytest

from plotter.gcode_profile import TEST_PATTERNS
from plotter.gcode_profile import test_pattern as make_pattern
from plotter.safety import GcodeSafetyChecker, SafetyViolation

_MOVE = re.compile(r"^G([01])\b", re.IGNORECASE)
_WORD = re.compile(r"([XYZ])(-?\d+(?:\.\d+)?)")


def _moves(gcode: str):
    """Yield (x, y, z) after every motion line (absolute coords)."""
    x = y = 0.0
    z = None
    for line in gcode.splitlines():
        line = line.split(";", 1)[0].strip()
        if not line or not _MOVE.match(line):
            continue
        words = dict(_WORD.findall(line.upper()))
        x = float(words.get("X", x))
        y = float(words.get("Y", y))
        z = float(words["Z"]) if "Z" in words else z
        yield x, y, z


class TestPatternsRespectCalibration:
    @pytest.mark.parametrize("name", TEST_PATTERNS)
    def test_no_homing_at_all(self, cal, name):
        # The firmware may home Z even on "G28 X Y" — jobs must never home.
        gcode = make_pattern(name, cal)
        for line in gcode.splitlines():
            line = line.split(";", 1)[0].strip().upper()
            assert not line.startswith("G28"), f"G28 in {name}: {line}"

    @pytest.mark.parametrize("name", TEST_PATTERNS)
    def test_pen_lifted_before_any_xy(self, cal, name):
        gcode = make_pattern(name, cal)
        seen_lift = False
        for _x, _y, z in _moves(gcode):
            if not seen_lift:
                # The first motion must be the pen lift to pen_up_z.
                assert z == pytest.approx(cal.pen_up_z), f"{name}: first move is not the lift"
                seen_lift = True

    @pytest.mark.parametrize("name", TEST_PATTERNS)
    def test_z_heights_only_calibrated(self, cal, name):
        gcode = make_pattern(name, cal)
        zs = {z for _, _, z in _moves(gcode) if z is not None}
        assert zs == {cal.pen_up_z, cal.pen_down_z} or zs == {cal.pen_up_z}
        assert min(zs) >= cal.pen_down_z

    @pytest.mark.parametrize("name", TEST_PATTERNS)
    def test_drawing_stays_inside_plot_area(self, cal, name):
        gcode = make_pattern(name, cal)
        x0, y0 = cal.origin_x, cal.origin_y
        x1, y1 = x0 + cal.plot_width, y0 + cal.plot_height
        pen_down = False
        for x, y, z in _moves(gcode):
            if z is not None:
                pen_down = z < cal.pen_up_z - 0.01
            if pen_down:
                assert x0 - 0.05 <= x <= x1 + 0.05, f"{name}: draw x={x} outside [{x0}, {x1}]"
                assert y0 - 0.05 <= y <= y1 + 0.05, f"{name}: draw y={y} outside [{y0}, {y1}]"

    @pytest.mark.parametrize("name", TEST_PATTERNS)
    def test_pattern_passes_safety_checker(self, cal, name):
        GcodeSafetyChecker(cal).check(make_pattern(name, cal), name=name)

    @pytest.mark.parametrize("name", TEST_PATTERNS)
    def test_pattern_embeds_calibration(self, cal, name):
        gcode = make_pattern(name, cal)
        assert gcode.startswith("; --- plotter calibration ---")
        assert f"; pen_down_z = {cal.pen_down_z}" in gcode


class TestSafetyChecker:
    def test_rejects_bare_g28(self, cal):
        with pytest.raises(SafetyViolation, match="Homing im Job"):
            GcodeSafetyChecker(cal).check("G90\nG28\n")

    def test_rejects_z_home(self, cal):
        with pytest.raises(SafetyViolation, match="Homing im Job"):
            GcodeSafetyChecker(cal).check(f"G90\nG0 Z{cal.pen_up_z} F1000\nG28 Z\n")

    def test_rejects_xy_home_even_with_lifted_pen(self, cal):
        # Firmware may home Z on "G28 X Y" too — never allowed inside a job.
        with pytest.raises(SafetyViolation, match="Homing im Job"):
            GcodeSafetyChecker(cal).check(f"G90\nG0 Z{cal.pen_up_z} F1000\nG28 X Y\n")

    def test_rejects_z_below_pen_down(self, cal):
        with pytest.raises(SafetyViolation, match="keine kalibrierte Stift-Höhe"):
            GcodeSafetyChecker(cal).check(f"G90\nG0 Z{cal.pen_down_z - 1} F1000\n")

    def test_rejects_any_uncalibrated_z_height(self, cal):
        between = (cal.pen_up_z + cal.pen_down_z) / 2
        with pytest.raises(SafetyViolation, match="keine kalibrierte Stift-Höhe"):
            GcodeSafetyChecker(cal).check(f"G90\nG0 Z{between} F1000\n")

    def test_allows_exactly_calibrated_heights(self, cal):
        GcodeSafetyChecker(cal).check(
            f"G90\nG0 Z{cal.pen_up_z} F1000\nG1 Z{cal.pen_down_z} F1000\n"
            f"G0 Z{cal.pen_up_z} F1000\n"
        )

    def test_rejects_drawing_outside_plot_area(self, cal):
        gcode = (
            f"G90\nG0 Z{cal.pen_up_z} F1000\n"
            f"G0 X{cal.origin_x} Y{cal.origin_y} F6000\n"
            f"G1 Z{cal.pen_down_z} F1000\n"
            "G1 X30 Y30 F3000\n"  # outside the plot area while pen is down
        )
        with pytest.raises(SafetyViolation, match="außerhalb des Plotbereichs"):
            GcodeSafetyChecker(cal).check(gcode)

    def test_allows_travel_on_bed_outside_plot_area(self, cal):
        gcode = f"G90\nG0 Z{cal.pen_up_z} F1000\nG0 X0 Y0 F6000\n"
        GcodeSafetyChecker(cal).check(gcode)

    def test_rejects_travel_outside_bed(self, cal):
        gcode = f"G90\nG0 Z{cal.pen_up_z} F1000\nG0 X{cal.bed_width + 10} Y0 F6000\n"
        with pytest.raises(SafetyViolation, match="außerhalb des Betts"):
            GcodeSafetyChecker(cal).check(gcode)

    def test_rejects_relative_mode(self, cal):
        with pytest.raises(SafetyViolation, match="relative"):
            GcodeSafetyChecker(cal).check("G91\nG0 Z5 F1000\n")

    def test_rejects_xy_before_pen_lift(self, cal):
        with pytest.raises(SafetyViolation, match="bevor der Stift"):
            GcodeSafetyChecker(cal).check("G90\nG0 X50 Y50 F6000\n")
