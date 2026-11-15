from __future__ import annotations

import copy
import gzip
import math
import re
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from plotter.artwork.pipeline import PlotterError
from plotter.artwork.xopp import read_xopp_bytes
from plotter.core.calibration import Calibration
from plotter.core.jobmeta import read_job_meta
from plotter.core.storage import jobs_dir
from plotter.gcode.pressure import PressureLine, clip_pressure_lines
from plotter.gcode.scene import _ordered_lines, scene_gcode
from plotter.services import PrinterController
from plotter.services.profiles import ProfileService


def _cal(**kwargs) -> Calibration:
    values = {
        "origin_x": 0, "origin_y": 0, "flip_y": False, "pen_down_z": 3, "pen_up_z": 5,
        "pen_pressure_max_depth": 0.4, "park_after_plot": False,
    }
    return Calibration(**{**values, **kwargs})


def _page(enabled: bool = True) -> dict:
    lines = [[[10, 10], [20, 10], [30, 10]]]
    return {"name": "Pressure", "continuous": True, "objects": [{
        "id": "writing", "type": "image", "cachedPolylines": lines,
        "data": {
            "strokeOrder": "source", "pressureEnabled": enabled,
            "basePolylines": lines, "baseSegmentPressures": [[0, 1]],
            "cachedSegmentPressures": [[0, 1]],
        },
    }]}


def test_disabled_pressure_keeps_existing_gcode_identical():
    page = _page(False)
    baseline = copy.deepcopy(page)
    baseline["objects"][0]["data"] = {"strokeOrder": "source"}
    assert scene_gcode(page, _cal()) == scene_gcode(baseline, _cal())


def test_pressure_moves_down_and_back_up_without_changing_xy():
    page = _page()
    obj = page["objects"][0]
    obj["cachedPolylines"][0].append([40, 10])
    obj["data"]["cachedSegmentPressures"] = [[0, 1, 0]]
    gcode = scene_gcode(page, _cal())
    draws = [line for line in gcode.splitlines() if line.startswith("G1 X")]
    assert [line.split(" F")[0] for line in draws] == [
        "G1 X20.000 Y10.000 Z2.800", "G1 X30.000 Y10.000 Z2.800",
        "G1 X40.000 Y10.000 Z3.000",
    ]
    assert "G0 X10.000 Y10.000" in gcode
    assert gcode.count("G0 Z5.000") == 2


def test_pressure_preserves_stroke_order_and_relative_strength_after_placement():
    page = _page()
    obj = page["objects"][0]
    obj["cachedPolylines"] = [[[10, 10], [20, 10]], [[0, 0], [2, 0]]]
    obj["data"]["cachedSegmentPressures"] = [[0.25], [1]]
    obj["transform"] = {"x": 50, "y": 50, "scale": 2, "rotation": math.pi / 2}
    gcode = scene_gcode(page, _cal())
    travel = [line for line in gcode.splitlines() if line.startswith("G0 X")]
    assert travel[0].startswith("G0 X30.000 Y70.000")
    assert travel[1].startswith("G0 X50.000 Y50.000")
    assert "G1 X30.000 Y90.000 Z2.900" in gcode
    assert "G1 X50.000 Y54.000 Z2.600" in gcode


def test_clipping_interpolates_curve_at_mask_boundaries():
    page = _page()
    page["objects"].append({
        "type": "mask-rect", "zOrder": 1,
        "cachedPolylines": [[[14, 0], [16, 0], [16, 20], [14, 20], [14, 0]]],
    })
    lines = _ordered_lines(page)
    assert [line.points for line in lines] == [
        [(10, 10), (14, 10)], [(16, 10), (20, 10), (30, 10)],
    ]
    assert lines[0].pressures == pytest.approx([0, 0.2])
    assert lines[1].pressures == pytest.approx([0.3, 0.5, 1])
    gcode = scene_gcode(page, _cal())
    assert "G1 X14.000 Y10.000 Z2.920" in gcode
    assert "G0 X16.000 Y10.000" in gcode
    assert "G1 Z2.880" in gcode


def test_dot_is_retained_outside_mask():
    line = PressureLine([(10, 10), (10, 10)], [0.25, 0.25])
    assert clip_pressure_lines([line], [[(20, 20), (30, 20), (30, 30), (20, 30)]]) == [line]
    assert clip_pressure_lines([line], [[(0, 0), (30, 0), (30, 30), (0, 30)]]) == []


@pytest.mark.parametrize("values", [[], [[0]], [[float("nan"), 1]], [[True, 1]], [[-1, 2]]])
def test_invalid_pressure_never_drives_the_pen(values):
    page = _page()
    page["objects"][0]["data"]["cachedSegmentPressures"] = values
    with pytest.raises(PlotterError, match="Druck"):
        scene_gcode(page, _cal())


def test_pressure_requires_positive_profile_range():
    with pytest.raises(PlotterError, match="Projektprofil.*Zusatzabsenkung"):
        scene_gcode(_page(), _cal(pen_pressure_max_depth=0))


def test_mixed_strokes_without_pressure_use_baseline():
    page = _page()
    obj = page["objects"][0]
    obj["cachedPolylines"].append([[40, 10], [50, 10]])
    obj["data"]["cachedSegmentPressures"].append(None)
    gcode = scene_gcode(page, _cal())
    assert "G1 X30.000 Y10.000 Z2.600" in gcode
    assert "G1 Z3.000" in gcode
    assert "G1 X50.000 Y10.000 F" in gcode


@pytest.mark.parametrize("speed", [0.333, 0.005])
def test_fast_short_segments_respect_z_speed(speed):
    page = _page()
    page["objects"][0]["cachedPolylines"] = [[[10, 10], [10.001, 10], [10.002, 10]]]
    cal = _cal(z_feed=speed, z_max_feedrate=0.5)
    gcode = scene_gcode(page, cal)
    assert "M203 Z0.5\n" in gcode
    assert " F0\n" not in gcode
    x = y = z = 0.0
    for line in gcode.splitlines():
        if not line.startswith(("G0 ", "G1 ")):
            continue
        words = {k: float(v) for k, v in re.findall(r"([XYZF])(-?[\d.]+)", line)}
        nx, ny, nz = (words.get(k, v) for k, v in (("X", x), ("Y", y), ("Z", z)))
        if "X" in words and "Z" in words:
            length = math.dist((x, y, z), (nx, ny, nz))
            assert abs(nz - z) / length * words["F"] / 60 <= cal.z_feed + 1e-9
        x, y, z = nx, ny, nz


def test_pressure_job_survives_save_list_send_and_mcp_validation(workspace, cal, monkeypatch):
    from plotter.mcp.orchestration import _validated_project_job_calibration
    from plotter.web.app import app
    from plotter.web.routes import printer

    client = TestClient(app)
    index = client.post("/api/projects", json={"name": "Pressure"}).json()
    project, page_id = index["project"], index["activeId"]
    profiles = ProfileService()
    profiles.update(project["profileId"], calibration={
        "pen_down_z": 3, "pen_up_z": 5, "pen_pressure_max_depth": 0.4,
    })
    saved = client.put(f"/api/pages/{page_id}", json={"objects": _page()["objects"]})
    assert saved.status_code == 200
    response = client.post(f"/api/pages/{page_id}/gcode", json={})
    assert response.status_code == 200, response.text
    path = jobs_dir() / response.json()["filename"]
    assert read_job_meta(path)["source"]["pressure_enabled"] is True
    listed = next(job for job in client.get("/api/jobs").json() if job["filename"] == path.name)
    assert listed["fits"] is True, listed
    controller = MagicMock(spec=PrinterController)
    controller.client = MagicMock()
    controller.client.upload.return_value = {"ok": True}
    monkeypatch.setattr(printer, "controller", lambda: controller)
    sent = client.post("/api/printer/send", json={"filename": path.name, "start": False})
    assert sent.status_code == 200, sent.text
    controller.home.assert_not_called()
    assert _validated_project_job_calibration(path).pen_pressure_max_depth == 0.4
    profiles.update(project["profileId"], calibration={"pen_pressure_max_depth": 0.2})
    stale = client.post("/api/printer/send", json={"filename": path.name, "start": False})
    assert stale.status_code == 409


def test_native_xopp_curve_generates_only_bounded_z():
    widths = " ".join(str(i / 10) for i in range(21))
    points = " ".join(f"{i * 10} 10" for i in range(22))
    document = (
        '<xournal><page width="595" height="842"><layer>'
        f'<stroke tool="pen" width="2 {widths}">{points}</stroke>'
        '</layer></page></xournal>'
    )
    drawing = read_xopp_bytes(gzip.compress(document.encode()))[0]
    scale = 150 / max(drawing.width, drawing.height)
    lines = [[[p.real * scale, p.imag * scale] for p in line] for line in drawing.polylines]
    page = {"objects": [{
        "cachedPolylines": lines,
        "data": {"strokeOrder": "source", "pressureEnabled": True,
                 "cachedSegmentPressures": drawing.segment_pressures},
    }]}
    cal = _cal()
    gcode = scene_gcode(page, cal)
    z = [float(v) for line in gcode.splitlines() if line.startswith(("G0 ", "G1 "))
         for v in re.findall(r" Z(-?[\d.]+)", line)]
    assert len(set(z)) > 10
    assert all(v == cal.pen_up_z or cal.pen_down_z - 0.4 <= v <= cal.pen_down_z for v in z)
