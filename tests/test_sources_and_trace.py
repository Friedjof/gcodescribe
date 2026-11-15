from __future__ import annotations

import cv2
import numpy as np
import pytest

from plotter.artwork.drawing import load_svg_drawing, placed_gcode
from plotter.artwork.trace import centerline_image_to_svg, trace_image_to_svg
from plotter.core.calibration import feed_word
from plotter.gcode.preview import parse_gcode
from plotter.gcode.safety import SafetyViolation
from plotter.services.sources import SourceService

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
        from plotter.artwork.pipeline import PlotterError

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

    def test_centerline_continues_straight_through_crossing(self, workspace):
        from plotter.artwork.trace import _centerline_paths

        img = np.full((300, 300), 255, np.uint8)
        cv2.line(img, (20, 150), (280, 150), 0, 4)  # horizontal stroke
        cv2.line(img, (150, 20), (150, 280), 0, 4)  # vertical stroke, crossing it
        png = workspace / "cross.png"
        cv2.imwrite(str(png), img)

        paths, _, _ = _centerline_paths(png, dpi=100, detail=2)
        # Each stroke should survive the crossing as one continuous polyline
        # (not chopped into 4+ fragments at the intersection), and the two
        # perpendicular strokes must not get consolidated into one either.
        assert len(paths) == 2
        spans = sorted(
            max(abs(p[:, 0].max() - p[:, 0].min()), abs(p[:, 1].max() - p[:, 1].min()))
            for p in paths
        )
        assert spans[-1] > 50  # mm, spans most of the page
        assert spans[-2] > 50

    def test_noisy_straight_stroke_is_straightened(self, workspace):
        from plotter.artwork.trace import _centerline_paths

        # A stroke that's meant to be straight but has small realistic
        # per-pixel jitter, like a photographed or AI-rendered sketch line.
        img = np.full((400, 400), 255, np.uint8)
        n = 60
        t = np.linspace(0, 1, n)
        p0, p1 = np.array([40, 40]), np.array([360, 300])
        base = p0 + t[:, None] * (p1 - p0)
        rng = np.random.default_rng(0)
        noise = rng.normal(0, 1.8, size=(n, 2))
        pts = (base + noise).astype(np.int32)
        for a, b in zip(pts[:-1], pts[1:], strict=False):
            cv2.line(img, tuple(a), tuple(b), 0, 4)
        png = workspace / "wobbly.png"
        cv2.imwrite(str(png), img)

        paths, _, _ = _centerline_paths(png, dpi=100, detail=2)
        main = max(paths, key=len)
        # Collapsed to one exact straight segment, not a wobbly polyline.
        assert len(main) == 2
        length = float(np.linalg.norm(main[-1] - main[0]))
        assert 90 < length < 115

    def test_genuine_corner_is_not_straightened(self, workspace):
        from plotter.artwork.trace import _centerline_paths

        img = np.full((400, 400), 255, np.uint8)
        cv2.line(img, (40, 300), (200, 300), 0, 4)
        cv2.line(img, (200, 300), (200, 60), 0, 4)  # sharp 90 degree bend
        png = workspace / "corner.png"
        cv2.imwrite(str(png), img)

        paths, _, _ = _centerline_paths(png, dpi=100, detail=2)
        main = max(paths, key=len)
        # A real bend must survive as more than one straight chord.
        assert len(main) > 2

    def test_overdrawn_duplicate_stroke_is_dropped(self, workspace):
        from plotter.artwork.trace import _centerline_paths

        img = np.full((200, 400), 255, np.uint8)
        cv2.line(img, (40, 100), (360, 100), 0, 3)
        cv2.line(img, (40, 106), (360, 106), 0, 3)  # retraced right alongside it
        png = workspace / "overdrawn.png"
        cv2.imwrite(str(png), img)

        paths, _, _ = _centerline_paths(png, dpi=100, detail=2)
        # The retraced copy is a duplicate of the same intended line -- only
        # one stroke should remain, not two parallel near-identical ones.
        assert len(paths) == 1

    def test_parallel_but_distinct_strokes_both_kept(self, workspace):
        from plotter.artwork.trace import _centerline_paths

        img = np.full((200, 400), 255, np.uint8)
        cv2.line(img, (40, 100), (360, 100), 0, 3)
        cv2.line(img, (40, 160), (360, 160), 0, 3)  # ~15mm away, a distinct line
        png = workspace / "parallel_distinct.png"
        cv2.imwrite(str(png), img)

        paths, _, _ = _centerline_paths(png, dpi=100, detail=2)
        assert len(paths) == 2

    def test_blank_image_rejected(self, workspace):
        from plotter.artwork.pipeline import PlotterError

        png = workspace / "blank.png"
        cv2.imwrite(str(png), np.full((100, 100), 255, np.uint8))
        with pytest.raises(PlotterError, match="Keine Striche"):
            centerline_image_to_svg(png, workspace / "blank.svg", dpi=100)

    def test_shading_drops_faint_and_doubles_bold_strokes(self, workspace):
        from plotter.artwork.trace import _centerline_paths

        img = np.full((500, 400), 255, np.uint8)
        for i in range(4):  # faint construction lines
            y = 30 + i * 40
            cv2.line(img, (20, y), (100, y), 235, 2)
        for i in range(4):  # normal-weight strokes
            y = 220 + i * 40
            cv2.line(img, (20, y), (150, y), 150, 3)
        cv2.line(img, (20, 480), (380, 480), 10, 5)  # one bold stroke
        png = workspace / "shading.png"
        cv2.imwrite(str(png), img)

        paths, _, _ = _centerline_paths(png, dpi=100, detail=2)
        lengths = sorted(
            round(float(np.linalg.norm(np.diff(p, axis=0), axis=1).sum()), 1) for p in paths
        )
        # One faintest stroke is dropped (3 of the 4 remain), the normal-weight
        # strokes are untouched, and the single darkest stroke is doubled.
        assert lengths.count(pytest.approx(20.3, abs=0.5)) == 3
        assert lengths.count(pytest.approx(32.5, abs=0.5)) == 4
        assert lengths.count(pytest.approx(91.7, abs=0.5)) == 2

    def test_chaikin_rounds_corners_keeping_endpoints(self):
        from plotter.geometry.smoothing import chaikin

        corner = np.array([[0.0, 0.0], [10.0, 0.0], [10.0, 10.0]])  # sharp 90° turn
        smooth = chaikin(corner, 2)
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

    def test_park_lift_and_position_used_when_parking(self, workspace, cal):
        cal = cal.merged({"park_x": 12.0, "park_y": 34.0, "park_lift_z": cal.pen_up_z + 9.0})
        svg = workspace / "d.svg"
        svg.write_text(SVG)
        gcode = placed_gcode(load_svg_drawing(svg), cal, x=50, y=60, width=80)
        lines = [ln.split(";", 1)[0].strip() for ln in gcode.splitlines() if ln.strip()]
        motion = [ln for ln in lines if ln.startswith(("G0", "G1"))]
        assert motion[-2] == f"G0 Z{cal.park_lift_z:.3f} {feed_word(cal.z_feed)}"
        assert motion[-1] == f"G0 X{cal.park_x:.3f} Y{cal.park_y:.3f} {feed_word(cal.travel_feed)}"
        assert "G28" not in gcode

    def test_raising_pen_up_z_later_does_not_break_the_park_move(self, workspace, cal):
        # Regression: park_x/park_y/park_lift_z must keep tracking pen_up_z
        # even after it changes via a lightweight partial update (as the
        # Paper wizard's "save as up/down" buttons do via PUT /calibration) —
        # never freeze at whatever pen_up_z happened to be when first read.
        cal = cal.merged({"pen_up_z": cal.pen_up_z + 20.0})
        svg = workspace / "d.svg"
        svg.write_text(SVG)
        # placed_gcode() runs the safety checker internally — must not raise.
        placed_gcode(load_svg_drawing(svg), cal, x=50, y=60, width=80)


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
