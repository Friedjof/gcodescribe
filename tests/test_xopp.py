from __future__ import annotations

import gzip
import json
from pathlib import Path

import pytest

from plotter.artwork.xopp import read_xopp_bytes, select_xopp_page
from plotter.core.calibration import Calibration
from plotter.gcode.scene import scene_gcode
from plotter.services.asset_task_worker import run
from plotter.services.gallery import GalleryService


def _document() -> bytes:
    return gzip.compress(b'''<xournal>
      <page width="595.275591" height="419.527559">
        <background type="solid"/><layer>
          <stroke tool="pen" color="black" width="2">200 20 100 20 80 30</stroke>
          <image>ignored</image>
          <stroke tool="pen" color="black" width="2">40 40 50 40</stroke>
        </layer>
      </page>
      <page width="419.527559" height="595.275591">
        <layer><stroke tool="pen" width="3">10 10 15 15</stroke></layer>
      </page>
    </xournal>''')


def test_native_points_and_page_selection() -> None:
    pages = read_xopp_bytes(_document())
    assert len(pages) == 2
    assert len(pages[0].polylines) == 2  # embedded image was ignored
    assert pages[0].width == pytest.approx(210.0)
    first = pages[0].polylines[0]
    assert first[0].real > first[-1].real  # original pen direction
    selected = read_xopp_bytes(select_xopp_page(_document(), 2))
    assert len(selected) == 1
    assert len(selected[0].polylines) == 1
    assert selected[0].width == pytest.approx(148.0)
    assert selected[0].height == pytest.approx(210.0)


def _pressure_document(width: str = "2 0 1 3") -> bytes:
    return gzip.compress(f'''<xournal><page width="200" height="300"><layer>
      <stroke tool="pen" width="{width}">0 0 10 0 20 10 30 10</stroke>
      <stroke tool="pen" width="4 1 2">30 20 40 20 50 30</stroke>
      <stroke tool="pen" width="2">60 20 70 30</stroke>
      <stroke tool="pen" width="2">80 40</stroke>
    </layer></page></xournal>'''.encode())


def test_pressure_uses_each_strokes_base_width_without_stretching() -> None:
    drawing = read_xopp_bytes(_pressure_document())[0]
    assert drawing.segment_pressures == [[0.0, 0.5, 1.0], [0.25, 0.5], None, None]
    assert [len(line) for line in drawing.polylines] == [4, 3, 2, 2]
    assert drawing.polylines[-1][0] == drawing.polylines[-1][1]  # pen tap survives
    selected = read_xopp_bytes(select_xopp_page(_pressure_document(), 1))[0]
    assert selected.segment_pressures == drawing.segment_pressures


@pytest.mark.parametrize("width", [
    "", "2", "2 1", "2 1 1 1 1", "0 0 1 2", "-2 0 1 2",
    "2 0 -1 2", "2 0 nan 2", "inf 0 1 2", "2 0 1 inf", "2 0 bad 2",
])
def test_bad_pressure_falls_back_without_losing_geometry(width: str) -> None:
    drawing = read_xopp_bytes(_pressure_document(width))[0]
    assert len(drawing.polylines) == 4
    assert len(drawing.polylines[0]) == 4
    assert drawing.segment_pressures == [None, [0.25, 0.5], None, None]


def test_pressure_metadata_survives_gallery_and_slide_import(tmp_path: Path) -> None:
    folder = tmp_path / "task"
    folder.mkdir()
    (folder / "source").write_bytes(_pressure_document())
    (folder / "request.json").write_text(json.dumps({
        "kind": "import", "id": "test-pressure-import", "filename": "druck.xopp",
        "mode": "auto", "detail": 2, "selected_pages": [1],
        "target": {"x": 0, "y": 0, "width": 200, "height": 200},
    }))
    run(folder)
    result = json.loads((folder / "result.json").read_text())
    strokes = GalleryService(folder / "staging").original_strokes(result["item"]["id"])
    expected = [[0.0, 0.5, 1.0], [0.25, 0.5], None, None]
    assert strokes["segmentPressures"] == expected
    data = result["object"]["data"]
    assert data["baseSegmentPressures"] == expected
    assert data["cachedSegmentPressures"] == expected
    assert data["pressureEnabled"] is False
    assert [len(line) - 1 for line in result["object"]["cachedPolylines"]] == [3, 2, 1, 1]


def test_batch_import_creates_individual_gallery_items(tmp_path: Path) -> None:
    folder = tmp_path / "task"
    folder.mkdir()
    (folder / "source").write_bytes(_document())
    (folder / "request.json").write_text(json.dumps({
        "kind": "import", "filename": "notiz.xopp", "title": "Notiz",
        "mode": "auto", "detail": 2, "selected_pages": [1, 2],
    }))
    run(folder)
    result = json.loads((folder / "result.json").read_text())
    assert len(result["items"]) == 2
    gallery = GalleryService(folder / "staging")
    first, second = result["items"]
    assert first["id"] != second["id"]
    assert first["mode"] == second["mode"] == "strokes"
    assert first["pages"][0]["lines"] == 2
    assert second["pages"][0]["lines"] == 1
    assert len(gallery.original_strokes(first["id"], 1)["polylines"]) == 2


@pytest.mark.parametrize("number, width, height", [(1, 210, 148), (2, 148, 210)])
def test_import_into_slide_keeps_source_page_margins(
    tmp_path: Path, number: int, width: int, height: int,
) -> None:
    folder = tmp_path / "task"
    folder.mkdir()
    (folder / "source").write_bytes(_document())
    (folder / "request.json").write_text(json.dumps({
        "kind": "import", "id": "test-import", "filename": "notiz.xopp",
        "mode": "auto", "detail": 2, "selected_pages": [number],
        "target": {"x": 0, "y": 0, "width": 200, "height": 200},
    }))
    run(folder)
    obj = json.loads((folder / "result.json").read_text())["object"]
    assert obj["data"]["sourcePage"]["width"] == pytest.approx(width)
    assert obj["data"]["sourcePage"]["height"] == pytest.approx(height)
    assert obj["data"]["strokeOrder"] == "source"
    assert obj["cachedPolylines"][0][0][0] == pytest.approx(
        (200 if number == 1 else 10) * 25.4 / 72 - width / 2
    )
    assert obj["transform"]["scale"] == pytest.approx(120 / max(width, height))
    assert obj["transform"]["rotation"] == 0


def test_scene_plot_keeps_stroke_order_and_direction() -> None:
    page = {
        "name": "Handschrift", "continuous": True,
        "objects": [{
            "type": "image", "plotted": False,
            "data": {"strokeOrder": "source"},
            "cachedPolylines": [
                [[80, 20], [40, 20], [20, 30]],
                [[10, 40], [20, 40]],
            ],
        }],
    }
    gcode = scene_gcode(
        page, Calibration(park_after_plot=False, origin_x=0, origin_y=0, flip_y=False),
    )
    travel = [line for line in gcode.splitlines() if line.startswith("G0 X")]
    assert "X80.000 Y20.000" in travel[0]
    assert "X10.000 Y40.000" in travel[1]
    assert gcode.count("G1 Z") == 2
