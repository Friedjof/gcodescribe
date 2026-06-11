from __future__ import annotations

import xml.etree.ElementTree as ET

import pytest

from plotter.calibration import Calibration
from plotter.convert import convert_with_calibration
from plotter.export import (
    CalibrationImportError,
    calibration_from_xml,
    calibration_to_xml,
)
from plotter.gcode_preview import parse_gcode
from plotter.safety import GcodeSafetyChecker, SafetyViolation

SVG = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="80mm"
     viewBox="0 0 100 80">
  <rect x="10" y="10" width="80" height="60" fill="none" stroke="black"/>
  <line x1="10" y1="10" x2="90" y2="70" stroke="black"/>
</svg>
"""


class TestConvertRespectsCalibration:
    def test_converted_job_stays_inside_plot_area(self, workspace, cal):
        src = workspace / "drawing.svg"
        src.write_text(SVG)
        result = convert_with_calibration(src, workspace / "jobs", cal)
        assert result.gcode_files

        x0, y0 = cal.origin_x, cal.origin_y
        x1, y1 = x0 + cal.plot_width, y0 + cal.plot_height
        for path in result.gcode_files:
            text = path.read_text()
            assert text.startswith("; --- plotter calibration ---")
            GcodeSafetyChecker(cal).check(text, name=path.name)
            bounds = parse_gcode(path)["bounds"]
            assert bounds is not None
            assert x0 - 0.05 <= bounds[0] and bounds[2] <= x1 + 0.05
            assert y0 - 0.05 <= bounds[1] and bounds[3] <= y1 + 0.05

    def test_oversized_drawing_without_fit_is_rejected(self, workspace, cal):
        cal = cal.merged({"fit_to_area": False})
        cal.save()
        big = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="400mm" height="400mm"
     viewBox="0 0 400 400">
  <rect x="10" y="10" width="380" height="380" fill="none" stroke="black"/>
</svg>
"""
        src = workspace / "big.svg"
        src.write_text(big)
        out = workspace / "jobs"
        with pytest.raises(SafetyViolation):
            convert_with_calibration(src, out, cal)
        # The violating job must not be left behind.
        assert not list(out.glob("*.gcode"))

    def test_no_homing_in_converted_job(self, workspace, cal):
        src = workspace / "drawing.svg"
        src.write_text(SVG)
        result = convert_with_calibration(src, workspace / "jobs", cal)
        for path in result.gcode_files:
            for line in path.read_text().splitlines():
                code = line.split(";", 1)[0].strip().upper()
                assert not code.startswith("G28"), f"G28 in job: {line}"

    def test_converted_job_z_only_calibrated_heights(self, workspace, cal):
        src = workspace / "drawing.svg"
        src.write_text(SVG)
        result = convert_with_calibration(src, workspace / "jobs", cal)
        z_re = __import__("re").compile(r"\bZ(-?\d+(?:\.\d+)?)")
        for path in result.gcode_files:
            for line in path.read_text().splitlines():
                code = line.split(";", 1)[0].strip().upper()
                if not code.startswith(("G0", "G1")):
                    continue
                m = z_re.search(code)
                if m:
                    z = float(m.group(1))
                    assert z in (cal.pen_up_z, cal.pen_down_z), f"Z {z} in {line}"


class TestXmlExport:
    def test_xml_contains_full_calibration(self, cal):
        root = ET.fromstring(calibration_to_xml(cal))
        assert root.tag == "plotterCalibration"

        area = root.find("plotArea")
        assert area is not None
        assert float(area.get("x")) == cal.origin_x
        assert float(area.get("width")) == cal.plot_width

        pen = root.find("pen")
        assert float(pen.get("downZ")) == cal.pen_down_z
        assert float(pen.get("upZ")) == cal.pen_up_z

        corners = {c.get("id"): (float(c.get("x")), float(c.get("y")))
                   for c in root.find("paper")}
        assert corners["bl"] == (20.0, 30.0)
        assert corners["tr"] == (190.0, 200.0)
        assert float(root.find("paper").get("margin")) == cal.paper_margin

        feeds = root.find("feedrates")
        assert float(feeds.get("draw")) == cal.draw_feed


class TestXmlImport:
    def test_roundtrip_preserves_all_fields(self, cal):
        restored = calibration_from_xml(calibration_to_xml(cal))
        assert restored.as_dict() == cal.as_dict()

    def test_partial_xml_keeps_base_values(self, cal):
        xml = (
            '<plotterCalibration version="1">'
            '<pen upZ="9.0" downZ="2.5"/>'
            "</plotterCalibration>"
        )
        restored = calibration_from_xml(xml, base=cal)
        assert restored.pen_up_z == 9.0
        assert restored.pen_down_z == 2.5
        # untouched fields stay as in the base
        assert restored.plot_width == cal.plot_width
        assert restored.paper_corners == cal.paper_corners

    def test_import_without_base_uses_defaults(self):
        xml = (
            '<plotterCalibration version="1">'
            '<plotArea x="10" y="12" width="100" height="120"/>'
            "</plotterCalibration>"
        )
        restored = calibration_from_xml(xml)
        assert (restored.origin_x, restored.origin_y) == (10.0, 12.0)
        assert restored.bed_width == Calibration().bed_width  # default

    def test_layout_flags_parsed(self, cal):
        xml = (
            '<plotterCalibration version="1">'
            '<layout fitToArea="false" flipY="false"/>'
            "</plotterCalibration>"
        )
        restored = calibration_from_xml(xml, base=cal)
        assert restored.fit_to_area is False
        assert restored.flip_y is False

    def test_rejects_wrong_root(self):
        with pytest.raises(CalibrationImportError, match="plotterCalibration"):
            calibration_from_xml("<something/>")

    def test_rejects_malformed_xml(self):
        with pytest.raises(CalibrationImportError, match="Ungültige XML"):
            calibration_from_xml("<plotterCalibration>")

    def test_rejects_non_numeric_value(self, cal):
        xml = (
            '<plotterCalibration version="1">'
            '<pen upZ="abc" downZ="1"/>'
            "</plotterCalibration>"
        )
        with pytest.raises(CalibrationImportError, match="pen_up_z"):
            calibration_from_xml(xml, base=cal)
