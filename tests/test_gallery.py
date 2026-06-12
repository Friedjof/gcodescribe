from __future__ import annotations

import cv2
import numpy as np
import pytest

from plotter.gallery_metrics import analyze_gcode, evaluate_gcode, metrics_dict, score_metrics
from plotter.services.gallery import GalleryService
from plotter.services.upload_validation import (
    MAX_GCODE_BYTES,
    MAX_UPLOAD_BYTES,
    UnsupportedUpload,
    UploadTooLarge,
    sniff_kind,
)

SVG = b"""<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm"
     viewBox="0 0 100 50">
  <rect x="10" y="10" width="80" height="30" fill="none" stroke="black"/>
  <line x1="10" y1="10" x2="90" y2="40" stroke="black"/>
</svg>
"""

GCODE = "\n".join(
    [
        "G21",
        "G90",
        "G0 Z7.4 F300",
        "G0 X10.000 Y10.000 F3000",
        "G1 Z1.4 F300",
        "G1 X110.000 Y10.000 F1500",
        "G1 X110.000 Y60.000 F1500",
        "G0 Z7.4 F300",
        "G0 X10.000 Y10.000 F3000",
        "G1 Z1.4 F300",
        "G1 X110.000 Y60.000 F1500",
        "G0 Z7.4 F300",
        "M2",
        "",
    ]
)


def _png_bytes(w=400, h=200) -> bytes:
    img = np.full((h, w), 255, np.uint8)
    cv2.rectangle(img, (40, 40), (200, 160), 0, -1)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return buf.tobytes()


def _jpg_bytes(w=400, h=200) -> bytes:
    img = np.full((h, w), 255, np.uint8)
    cv2.circle(img, (200, 100), 70, 0, -1)
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    return buf.tobytes()


class TestMetrics:
    def test_analyze_counts_and_distances(self):
        m = analyze_gcode(GCODE)
        assert m.pen_lifts == 2  # the pen touches down twice
        assert m.polyline_count == 2
        assert m.point_count == 3
        assert m.draw_mm == pytest.approx(100 + 50 + np.hypot(100, 50), abs=0.5)
        assert m.travel_mm > 0
        assert m.duration_s > 0
        assert m.size_bytes == len(GCODE.encode())

    def test_score_range_and_breakdown(self):
        s = score_metrics(analyze_gcode(GCODE), MAX_GCODE_BYTES)
        assert set(s) == {"total", "time", "lifts", "size", "detail"}
        assert all(0 <= v <= 100 for v in s.values())
        # A tiny fast drawing: great time/size, low detail.
        assert s["time"] == 100
        assert s["detail"] < 50

    def test_evaluate_is_the_shared_entry_point(self):
        result = evaluate_gcode(GCODE, MAX_GCODE_BYTES)
        m = analyze_gcode(GCODE)
        assert result == {
            "metrics": metrics_dict(m),
            "score": score_metrics(m, MAX_GCODE_BYTES),
        }


class TestValidation:
    def test_sniff_accepts_real_files(self):
        assert sniff_kind("a.svg", SVG) == "svg"
        assert sniff_kind("a.png", _png_bytes()) == "png"
        assert sniff_kind("a.jpg", _jpg_bytes()) == "jpeg"

    def test_rejects_unknown_extension(self):
        with pytest.raises(UnsupportedUpload):
            sniff_kind("a.gif", b"GIF89a")

    def test_rejects_mismatched_magic(self):
        with pytest.raises(UnsupportedUpload):
            sniff_kind("a.png", _jpg_bytes())

    def test_rejects_svg_with_script_or_doctype(self):
        with pytest.raises(UnsupportedUpload):
            sniff_kind("a.svg", b"<svg><script>alert(1)</script></svg>")
        with pytest.raises(UnsupportedUpload):
            sniff_kind("a.svg", b'<!DOCTYPE svg [<!ENTITY x "y">]><svg/>')


class TestGalleryService:
    def test_create_svg_submission(self, cal):
        svc = GalleryService()
        meta = svc.create("art.svg", SVG, title="  Mein Bild  ")
        assert meta["title"] == "Mein Bild"
        assert meta["kind"] == "svg"
        assert meta["status"] == "active"
        # vpype merges the rect and the diagonal at their shared corner.
        assert meta["lines"] >= 1
        assert 0 <= meta["score"]["total"] <= 100
        assert meta["metrics"]["pen_lifts"] >= 1

        assert svc.list() == [meta]
        preview = svc.svg_preview(meta["id"])
        assert preview["polylines"]
        assert svc.gcode_path(meta["id"]).exists()

    def test_create_png_submission(self, cal):
        meta = GalleryService().create("foto.png", _png_bytes(), title="")
        assert meta["kind"] == "png"
        assert meta["metrics"]["draw_mm"] > 0

    def test_oversized_upload_rejected_without_residue(self, cal):
        svc = GalleryService()
        with pytest.raises(UploadTooLarge):
            svc.create("big.png", b"\x89PNG" + b"0" * (MAX_UPLOAD_BYTES + 1))
        assert svc.list() == []
        assert list(svc.root.iterdir()) == []

    def test_invalid_upload_leaves_no_residue(self, cal):
        svc = GalleryService()
        with pytest.raises(UnsupportedUpload):
            svc.create("fake.png", b"not a png at all")
        assert list(svc.root.iterdir()) == []

    def test_set_title(self, cal):
        svc = GalleryService()
        meta = svc.create("art.svg", SVG, title="Alt")
        updated = svc.set_title(meta["id"], "  Neuer Titel  ")
        assert updated["title"] == "Neuer Titel"
        assert svc.get(meta["id"])["title"] == "Neuer Titel"
        # over-long titles are clipped just like on upload
        assert len(svc.set_title(meta["id"], "x" * 200)["title"]) == 80

    def test_archive_and_delete(self, cal):
        svc = GalleryService()
        meta = svc.create("art.svg", SVG)
        assert svc.set_status(meta["id"], "archived")["status"] == "archived"
        assert svc.list(include_archived=False) == []
        assert len(svc.list()) == 1
        assert svc.set_status(meta["id"], "active")["status"] == "active"
        svc.delete(meta["id"])
        assert svc.list() == []
