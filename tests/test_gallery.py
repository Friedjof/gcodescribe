from __future__ import annotations

import cv2
import numpy as np
import pytest

from plotter.gallery_metrics import analyze_gcode, evaluate_gcode, metrics_dict, score_metrics
from plotter.services.gallery import GalleryService
from plotter.services.profiles import ProfileService
from plotter.services.upload_validation import (
    MAX_GCODE_BYTES,
    MAX_STL_BYTES,
    MAX_UPLOAD_BYTES,
    UnsupportedUpload,
    UploadTooLarge,
    check_stl,
    sniff_asset_kind,
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

    def test_analyze_includes_dwell_and_motion_overhead(self):
        base = analyze_gcode("G0 Z5 F1000\n")
        with_dwell = analyze_gcode("G0 Z5 F1000\nG4 P500\nG4 S1\n")
        assert with_dwell.duration_s == pytest.approx(base.duration_s + 1.5, abs=0.01)
        assert base.duration_s > 5 / 1000 * 60

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

    def test_sniff_asset_accepts_documents(self):
        assert sniff_asset_kind("a.svg", SVG) == "svg"
        assert sniff_asset_kind("a.pdf", b"%PDF-1.7\n...") == "pdf"
        assert sniff_asset_kind("a.docx", b"PK\x03\x04rest") == "docx"

    def test_sniff_asset_rejects_bad_document_magic(self):
        with pytest.raises(UnsupportedUpload):
            sniff_asset_kind("a.pdf", b"not a pdf")
        with pytest.raises(UnsupportedUpload):
            sniff_asset_kind("a.docx", b"not a zip")


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
        thumb = svc.svg_thumbnail(meta["id"])
        assert thumb["polylines"]
        assert sum(len(line) for line in thumb["polylines"]) <= sum(
            len(line) for line in preview["polylines"]
        )
        assert svc.gcode_path(meta["id"]).exists()

    def test_thumbnail_route_returns_cached_preview(self, cal, workspace):
        from fastapi.testclient import TestClient

        from plotter.web.app import create_app

        meta = GalleryService().create("art.svg", SVG)
        client = TestClient(create_app())
        payload = client.get(f"/api/gallery/{meta['id']}/thumbnail").json()

        assert payload["polylines"]
        assert payload["width"] == meta["width"]
        assert payload["height"] == meta["height"]

    def test_submission_gcode_has_profile_metadata(self, cal):
        svc = GalleryService()
        meta = svc.create("art.svg", SVG, title="Profiltest")
        active = ProfileService().active_profile_meta()
        assert meta["profile"]["id"] == active["id"]
        assert meta["profile"]["fingerprint"] == active["fingerprint"]
        text = svc.gcode_path(meta["id"]).read_text()
        assert text.startswith("; --- plotter profile ---")
        assert f"; profile_id = {active['id']}" in text
        assert "; --- plotter calibration ---" in text

    def test_create_png_submission(self, cal):
        meta = GalleryService().create("foto.png", _png_bytes(), title="")
        assert meta["kind"] == "png"
        assert meta["original"]["filename"] == "foto.png"
        assert meta["original"]["mime"] == "image/png"
        assert meta["original"]["size"] > 0
        assert meta["metrics"]["draw_mm"] > 0

    def test_original_route_returns_uploaded_file(self, cal, workspace):
        from fastapi.testclient import TestClient

        from plotter.web.app import create_app

        data = _png_bytes()
        meta = GalleryService().create("foto.png", data, title="")
        client = TestClient(create_app())
        response = client.get(f"/api/gallery/{meta['id']}/original")

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("image/png")
        assert response.content == data

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

    def test_admin_asset_has_pages_and_no_score(self, cal):
        # Admin uploads go through the multi-page asset path: pages, no upfront
        # score, and on-demand previews — placement is scored later.
        svc = GalleryService()
        meta = svc.create("doc.svg", SVG, uploader="admin")
        assert meta["uploader"] == "admin"
        assert meta["kind"] == "svg"
        assert meta["mode"] == "vector"
        assert meta["pages"][0]["n"] == 1
        assert meta["pages"][0]["lines"] >= 1
        assert "score" not in meta and "metrics" not in meta
        preview = svc.preview(meta["id"], 1)
        assert preview["polylines"]
        assert svc.thumbnail(meta["id"])["polylines"]

    def test_admin_asset_has_transient_gcode_preview(self, cal, workspace):
        from fastapi.testclient import TestClient

        from plotter.web.app import create_app

        meta = GalleryService().create("doc.svg", SVG, uploader="admin")
        client = TestClient(create_app())
        response = client.get(f"/api/gallery/{meta['id']}/gcode/preview3d")

        assert response.status_code == 200
        assert response.json()["draws"]
        assert not (GalleryService().root / meta["id"] / "job.gcode").exists()

    def test_rerender_admin_asset_updates_pages_without_job(self, cal):
        svc = GalleryService()
        meta = svc.create("doc.svg", SVG, uploader="admin")

        updated = svc.rerender(meta["id"], mode="vector", detail=3)

        assert updated["mode"] == "vector"
        assert updated["detail"] == 3
        assert updated["pages"][0]["lines"] >= 1
        assert updated["original"]["filename"] == "doc.svg"
        assert not (svc.root / meta["id"] / "job.gcode").exists()

    def test_rerender_public_submission_updates_scored_derivatives(self, cal):
        svc = GalleryService()
        meta = svc.create("foto.png", _png_bytes(), title="")

        updated = svc.rerender(meta["id"], mode="lines", detail=1)

        assert updated["mode"] == "lines"
        assert updated["detail"] == 1
        assert updated["score"]["total"] >= 0
        assert (svc.root / meta["id"] / "image.svg").exists()
        assert (svc.root / meta["id"] / "job.gcode").exists()
        assert updated["original"]["filename"] == "foto.png"

    def test_rerender_rejects_unknown_mode(self, cal):
        svc = GalleryService()
        meta = svc.create("foto.png", _png_bytes(), title="")

        with pytest.raises(Exception, match="Unbekannter Modus"):
            svc.rerender(meta["id"], mode="bad", detail=2)

    def test_admin_rejects_document_only_for_public(self, cal):
        # PDFs/Office are admin-only; the public competition path refuses them.
        svc = GalleryService()
        with pytest.raises(UnsupportedUpload):
            svc.create("paper.pdf", b"%PDF-1.4 ...", uploader="public")

    def test_submission_keeps_pages_field(self, cal):
        # Scored submissions also carry the unified pages list (page 1 = image.svg).
        meta = GalleryService().create("art.svg", SVG)
        assert meta["pages"][0]["file"] == "image.svg"
        assert "score" in meta

    def test_normalize_backfills_pages_for_legacy_meta(self):
        meta = {"id": "x", "kind": "svg", "width": 10, "height": 5, "lines": 3}
        GalleryService._normalize(meta)
        assert meta["uploader"] == "public"
        assert meta["pages"] == [
            {"n": 1, "file": "image.svg", "width": 10, "height": 5, "lines": 3}
        ]
        assert meta["mode"] == "vector"
        assert meta["detail"] == 2

    def test_archive_and_delete(self, cal):
        svc = GalleryService()
        meta = svc.create("art.svg", SVG)
        assert svc.set_status(meta["id"], "archived")["status"] == "archived"
        assert svc.list(include_archived=False) == []
        assert len(svc.list()) == 1
        assert svc.set_status(meta["id"], "active")["status"] == "active"
        svc.delete(meta["id"])
        assert svc.list() == []


def _binary_stl(n=2) -> bytes:
    import struct
    buf = bytearray(b"\x00" * 80)
    buf += struct.pack("<I", n)
    for _ in range(n):
        # normal + 3 vertices + attribute byte count — geometry is irrelevant here.
        buf += struct.pack("<12fH", 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0)
    return bytes(buf)


def _layer_svg(color: str) -> str:
    # Mirrors the frontend polylinesToSvg() output shape (decimal mm dimensions,
    # decimal path coords, stroke-width) so this also guards SVG parsing.
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="100.000mm" height="60.000mm" '
        'viewBox="0 0 100.000 60.000">'
        f'<path d="M10.000,10.000L90.000,10.000L90.000,50.000" fill="none" '
        f'stroke="{color}" stroke-width="0.3"/>'
        "</svg>"
    )


class TestStlValidation:
    def test_accepts_binary_and_ascii(self):
        check_stl("cube.stl", _binary_stl())
        check_stl("cube.stl", b"solid c\n facet normal 0 0 1\n outer loop\nendsolid")

    def test_rejects_wrong_extension_or_content(self):
        with pytest.raises(UnsupportedUpload):
            check_stl("cube.png", _binary_stl())
        with pytest.raises(UnsupportedUpload):
            check_stl("cube.stl", b"not really an stl at all")


class TestStlGallery:
    def _layers(self):
        return [
            {"color": "black", "role": "visible", "order": 1, "svg": _layer_svg("#111111")},
            {"color": "red", "role": "hidden", "order": 2, "svg": _layer_svg("#ff0000")},
        ]

    def test_create_stores_original_and_layers(self, cal):
        svc = GalleryService()
        params = {"azimuth": 0.6, "hidden": "secondColor"}
        meta = svc.create_stl("cube.stl", _binary_stl(), self._layers(), params, title="Cube")
        assert meta["kind"] == "stl"
        assert meta["title"] == "Cube"
        assert len(meta["pages"]) == 2
        assert [p["color"] for p in meta["pages"]] == ["black", "red"]
        assert meta["stl_params"]["hidden"] == "secondColor"
        item_dir = svc.root / meta["id"]
        assert (item_dir / "original.stl").exists()
        assert (item_dir / "page-0001.svg").exists()
        assert (item_dir / "page-0002.svg").exists()
        # the source STL is served back for re-rendering
        path, info = svc.original_path(meta["id"])
        assert path.name == "original.stl"
        assert info["mime"] == "model/stl"
        # thumbnail works through the standard page dispatch
        assert svc.thumbnail(meta["id"])["polylines"]

    def test_update_replaces_layers_keeps_stl(self, cal):
        svc = GalleryService()
        meta = svc.create_stl("cube.stl", _binary_stl(), self._layers(), {"hidden": "remove"})
        updated = svc.update_stl(
            meta["id"],
            [{"color": "blue", "role": "visible", "order": 1, "svg": _layer_svg("#0000ff")}],
            {"hidden": "remove", "azimuth": 1.2},
        )
        assert len(updated["pages"]) == 1
        assert updated["pages"][0]["color"] == "blue"
        assert updated["stl_params"]["azimuth"] == 1.2
        item_dir = svc.root / meta["id"]
        assert (item_dir / "original.stl").exists()
        assert not (item_dir / "page-0002.svg").exists()  # old second layer gone
        assert svc.stl_params(meta["id"])["azimuth"] == 1.2

    def test_rejects_oversize(self, cal):
        svc = GalleryService()
        big = _binary_stl() + b"\x00" * (MAX_STL_BYTES + 1)
        with pytest.raises(UploadTooLarge):
            svc.create_stl("cube.stl", big, self._layers(), {})
