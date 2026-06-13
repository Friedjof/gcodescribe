from __future__ import annotations

import cv2
import numpy as np
import pytest

from plotter.drawing import load_svg_drawing, placed_gcode
from plotter.gcode_preview import parse_gcode
from plotter.safety import SafetyViolation
from plotter.services.sources import SourceService
from plotter.trace import centerline_image_to_svg, trace_image_to_svg

SVG = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm"
     viewBox="0 0 100 50">
  <rect x="10" y="10" width="80" height="30" fill="none" stroke="black"/>
</svg>
"""


def _test_png(path, w=400, h=200):
    """White canvas with a black filled rectangle and a gray disc."""
    img = np.full((h, w), 255, np.uint8)
    cv2.rectangle(img, (40, 40), (200, 160), 0, -1)
    cv2.circle(img, (300, 100), 50, 128, -1)
    cv2.imwrite(str(path), img)
    return path


class TestTrace:
    def test_traces_area_borders(self, workspace):
        png = _test_png(workspace / "img.png")
        svg = workspace / "img.svg"
        w_mm, h_mm = trace_image_to_svg(png, svg, dpi=100, detail=2)
        assert w_mm == pytest.approx(400 * 25.4 / 100)
        drawing = load_svg_drawing(svg)
        # rectangle + disc borders detected
        assert len(drawing.polylines) >= 2
        bx0, by0, bx1, by1 = drawing.bounds()
        # rectangle corner at 40px = 10.16mm
        assert bx0 == pytest.approx(40 * 0.254, abs=0.6)

    def test_empty_image_rejected(self, workspace):
        img = np.full((100, 100), 255, np.uint8)
        png = workspace / "blank.png"
        cv2.imwrite(str(png), img)
        from plotter.pipeline import PlotterError

        with pytest.raises(PlotterError, match="Keine Konturen"):
            trace_image_to_svg(png, workspace / "blank.svg", dpi=100)


def _draw_len(drawing) -> float:
    return float(sum(np.abs(np.diff(line)).sum() for line in drawing.polylines))


class TestCenterline:
    def _stroke_png(self, path):
        img = np.full((200, 400), 255, np.uint8)
        cv2.line(img, (40, 100), (360, 100), 0, 4)  # one thick horizontal pen stroke
        cv2.imwrite(str(path), img)
        return path

    def test_centerline_follows_stroke_once_not_doubled(self, workspace):
        png = self._stroke_png(workspace / "stroke.png")
        cl, ol = workspace / "cl.svg", workspace / "ol.svg"
        centerline_image_to_svg(png, cl, dpi=100, detail=2)
        trace_image_to_svg(png, ol, dpi=100, detail=2)
        cdraw = _draw_len(load_svg_drawing(cl))
        odraw = _draw_len(load_svg_drawing(ol))
        # Outline traces both edges of the stroke; centreline follows it once.
        assert cdraw < odraw * 0.7

    def test_centerline_strokes_are_open(self, workspace):
        png = self._stroke_png(workspace / "stroke.png")
        cl = workspace / "cl.svg"
        centerline_image_to_svg(png, cl, dpi=100, detail=2)
        drawing = load_svg_drawing(cl)
        # The main stroke spans most of the page width as a single open polyline.
        assert max(abs(line[0] - line[-1]) for line in drawing.polylines) > 50

    def test_blank_image_rejected(self, workspace):
        from plotter.pipeline import PlotterError

        png = workspace / "blank.png"
        cv2.imwrite(str(png), np.full((100, 100), 255, np.uint8))
        with pytest.raises(PlotterError, match="Keine Striche"):
            centerline_image_to_svg(png, workspace / "blank.svg", dpi=100)

    def test_chaikin_rounds_corners_keeping_endpoints(self):
        from plotter.trace import _chaikin

        corner = np.array([[0.0, 0.0], [10.0, 0.0], [10.0, 10.0]])  # sharp 90° turn
        smooth = _chaikin(corner, 2)
        # endpoints preserved
        assert np.allclose(smooth[0], corner[0])
        assert np.allclose(smooth[-1], corner[-1])
        # corner cut: more points and the sharp vertex is gone
        assert len(smooth) > len(corner)
        assert not np.any(np.all(np.isclose(smooth, corner[1]), axis=1))


class TestPlacedGcode:
    def test_scaled_and_positioned_inside_plot_area(self, workspace, cal):
        svg = workspace / "d.svg"
        svg.write_text(SVG)
        drawing = load_svg_drawing(svg)
        gcode = placed_gcode(drawing, cal, x=50, y=60, width=80)
        out = workspace / "out.gcode"
        out.write_text(gcode)
        b = parse_gcode(out)["bounds"]
        # drawing is 80x30mm scaled to width 80 -> height 30, at (50, 60)
        assert b[0] == pytest.approx(50, abs=0.05)
        assert b[1] == pytest.approx(60, abs=0.05)
        assert b[2] == pytest.approx(130, abs=0.05)
        assert b[3] == pytest.approx(90, abs=0.05)

    def test_placement_outside_plot_area_rejected(self, workspace, cal):
        svg = workspace / "d.svg"
        svg.write_text(SVG)
        drawing = load_svg_drawing(svg)
        with pytest.raises(SafetyViolation):
            placed_gcode(drawing, cal, x=5, y=5, width=80)  # outside origin 25/35

    def test_z_only_calibrated_heights(self, workspace, cal):
        svg = workspace / "d.svg"
        svg.write_text(SVG)
        gcode = placed_gcode(load_svg_drawing(svg), cal, x=50, y=60, width=80)
        for line in gcode.splitlines():
            code = line.split(";", 1)[0].strip()
            if "Z" in code and code.startswith(("G0", "G1")):
                z = float(code.split("Z")[1].split()[0])
                assert z in (cal.pen_up_z, cal.pen_down_z)


class TestSourceService:
    def test_svg_source_roundtrip(self, workspace, cal):
        svc = SourceService(workspace / "sources")
        meta = svc.create("drawing.svg", SVG.encode())
        assert meta["mode"] == "vector"
        assert meta["pages"][0]["width"] == pytest.approx(100, abs=0.1)
        assert meta["pages"][0]["lines"] >= 1

        preview = svc.preview(meta["id"], 1)
        assert preview["polylines"]
        assert preview["bounds"][0] == pytest.approx(10, abs=0.1)

        job = svc.generate_gcode(meta["id"], 1, x=30, y=40, width=100)
        assert job.exists()
        text = job.read_text()
        assert text.startswith("; --- plotter profile ---")
        assert "; --- plotter calibration ---" in text

        assert any(m["id"] == meta["id"] for m in svc.list())
        svc.delete(meta["id"])
        assert not any(m["id"] == meta["id"] for m in svc.list())

    def test_image_source_is_traced(self, workspace, cal):
        png = _test_png(workspace / "img.png")
        svc = SourceService(workspace / "sources")
        meta = svc.create("img.png", png.read_bytes(), detail=2)
        assert meta["mode"] == "trace"
        assert svc.preview(meta["id"], 1)["polylines"]

    def test_handwriting_mode_centerline(self, workspace, cal):
        img = np.full((200, 400), 255, np.uint8)
        cv2.line(img, (40, 100), (360, 100), 0, 4)
        png = workspace / "hand.png"
        cv2.imwrite(str(png), img)
        svc = SourceService(workspace / "sources")
        meta = svc.create("hand.png", png.read_bytes(), mode="handwriting", detail=2)
        assert meta["mode"] == "handwriting"
        preview = svc.preview(meta["id"], 1)
        assert preview["polylines"]
        # strokes are open (centreline), not closed outlines
        assert any(line[0] != line[-1] for line in preview["polylines"])

    def test_oversized_placement_rejected(self, workspace, cal):
        svc = SourceService(workspace / "sources")
        meta = svc.create("drawing.svg", SVG.encode())
        with pytest.raises(SafetyViolation):
            svc.generate_gcode(meta["id"], 1, x=30, y=40, width=300)
