from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import plotter.printer.octoprint as op
from plotter.core.document import DocumentStore
from plotter.core.jobmeta import read_job_meta
from plotter.core.state import FileStateStore
from plotter.gcode.preview import parse_gcode_3d
from plotter.services.profiles import ProfileService


def _line_object() -> dict:
    return {
        "id": "line",
        "type": "line",
        "cachedPolylines": [[[10, 10], [40, 40]]],
        "transform": {"x": 0, "y": 0, "scale": 1, "rotation": 0},
    }


def _plot_request(endpoint: str, **extra) -> dict:
    if endpoint == "color-gcode":
        return {
            "color_group_id": "project-regression",
            "colors": [
                {
                    "color": "black",
                    "order": 1,
                    "objects": [_line_object()],
                }
            ],
            **extra,
        }
    return extra


def test_project_switch_scopes_slides_and_copies_profile(workspace, cal):
    from plotter.web.app import app

    client = TestClient(app)
    first = client.get("/api/pages").json()
    first_page = first["activeId"]
    created = client.post("/api/projects", json={"name": "Brief"})
    assert created.status_code == 200
    second = created.json()
    assert second["project"]["name"] == "Brief"
    assert second["project"]["profileId"] != first["project"]["profileId"]
    assert first_page not in [m["id"] for m in second["order"]]
    assert second["order"][0]["projectId"] == second["project"]["id"]
    assert (
        client.get(f"/api/pages/{second['activeId']}").json()["profileSnapshot"]["calibration"][
            "plot_width"
        ]
        == cal.plot_width
    )
    reopened = client.post(f"/api/projects/{first['project']['id']}/activate").json()
    assert first_page in [m["id"] for m in reopened["order"]]
    assert second["activeId"] not in [m["id"] for m in reopened["order"]]


def test_project_switch_does_not_change_the_checked_machine_calibration(workspace, cal):
    from plotter.web.app import app

    client = TestClient(app)
    first = client.get("/api/pages").json()
    client.post("/api/projects", json={"name": "Brief"})
    active_id = ProfileService().active_id()
    response = client.post(f"/api/projects/{first['project']['id']}/activate")
    assert response.status_code == 200
    with patch("plotter.web.routes.profiles.printer_controller") as printer:
        printer.return_value.status.return_value = {"job": {"state": "Paused"}}
        response = client.post(f"/api/profiles/{first['project']['profileId']}/activate")
    assert response.status_code == 409
    assert ProfileService().active_id() == active_id
    assert client.get("/api/pages").json()["project"]["id"] == first["project"]["id"]


def test_project_can_link_existing_profile_without_copying_or_changing_slides(workspace, cal):
    from plotter.web.app import app

    client = TestClient(app)
    index = client.get("/api/pages").json()
    project_id = index["project"]["id"]
    page_id = index["activeId"]
    objects = [_line_object()]
    client.put(f"/api/pages/{page_id}", json={"objects": objects})
    before = client.post(f"/api/pages/{page_id}/preview3d", json={}).json()
    old_job = client.post(f"/api/pages/{page_id}/gcode", json={}).json()["filename"]
    state = FileStateStore(workspace / "state")
    saved_page = state.get(f"paint_page_{page_id}")
    service = ProfileService()
    active_id = service.active_id()
    target = service.create("Vorhandenes Profil")
    target = service.update(target["id"], calibration={"origin_x": 45, "plot_width": 140})
    profiles_before = service.list()

    response = client.put(f"/api/projects/{project_id}", json={"profileId": target["id"]})
    assert response.status_code == 200, response.text
    assert response.json()["profileId"] == target["id"]
    assert service.active_id() == active_id
    assert service.list() == profiles_before
    assert state.get(f"paint_page_{page_id}") == saved_page
    updated_index = client.get("/api/pages").json()
    assert updated_index["activeId"] == page_id
    assert updated_index["activeProfile"]["id"] == target["id"]
    assert updated_index["activeProfile"]["fingerprint"] == target["fingerprint"]
    after = client.post(f"/api/pages/{page_id}/preview3d", json={}).json()
    assert before["profileOutline"]["plot"][0] == [25,35,0]
    assert after["profileOutline"]["plot"][0] == [45,35,0]
    before_points = [point for line in before["draws"] for point in line]
    after_points = [point for line in after["draws"] for point in line]
    assert len(after_points) == len(before_points) > 0
    assert [point[0] for point in after_points] == pytest.approx(
        [point[0] + 20 for point in before_points]
    )
    assert [point[1] for point in after_points] == pytest.approx(
        [point[1] for point in before_points]
    )
    generated = client.post(f"/api/pages/{page_id}/gcode", json={})
    assert generated.status_code == 200, generated.text
    path = workspace / "jobs" / generated.json()["filename"]
    assert parse_gcode_3d(path)["draws"] == after["draws"]
    assert read_job_meta(path)["profile"]["id"] == target["id"]
    assert state.get(f"paint_page_{page_id}") == saved_page
    with patch("plotter.web.routes.printer.controller") as printer:
        refused = client.post("/api/printer/send", json={"filename": old_job, "start": True})
        assert refused.status_code == 409, refused.text
        assert "Profil des Projekts wurde gewechselt" in refused.json()["detail"]
        printer.return_value.home.assert_not_called()
        printer.return_value.client.upload.assert_not_called()


@pytest.mark.parametrize("archived", [False, True])
def test_project_rejects_invalid_profile_before_changing_project(workspace, cal, archived):
    from plotter.web.app import app

    client = TestClient(app)
    index = client.get("/api/pages").json()
    service = ProfileService()
    if archived:
        profile = service.create("Archiviert")
        service.archive(profile["id"])
        profile_id = profile["id"]
    else:
        profile_id = "prof-missing"
    before = client.get("/api/projects").json()
    state = FileStateStore(workspace / "state")
    saved_index = state.get("paint_index")
    profiles_before = service.list()
    active_id = service.active_id()
    response = client.put(
        f"/api/projects/{index['project']['id']}",
        json={
            "name": "Darf nicht gespeichert werden",
            "archived": True,
            "profileId": profile_id,
        },
    )
    assert response.status_code == (409 if archived else 404), response.text
    assert client.get("/api/projects").json() == before
    assert state.get("paint_index") == saved_index
    assert service.list() == profiles_before
    assert service.active_id() == active_id


def test_project_creation_can_link_existing_profile_directly(workspace, cal):
    from plotter.web.app import app

    client = TestClient(app)
    first = client.get("/api/pages").json()
    service = ProfileService()
    active_id = service.active_id()
    profile = service.create("Kalibrierung am Papier")
    profile = service.update(profile["id"], calibration={"origin_x": 45, "plot_width": 140})
    profiles_before = service.list()
    response = client.post("/api/projects", json={"name": "Brief", "profileId": profile["id"]})
    assert response.status_code == 200, response.text
    created = response.json()
    assert created["project"]["profileId"] == profile["id"]
    assert created["activeProfile"]["id"] == profile["id"]
    assert created["project"]["id"] != first["project"]["id"]
    assert service.active_id() == active_id
    assert service.list() == profiles_before
    page = client.get(f"/api/pages/{created['activeId']}").json()
    assert page["profileSnapshot"]["profileId"] == profile["id"]
    assert page["profileSnapshot"]["calibration"]["origin_x"] == 45


@pytest.mark.parametrize("invalid", ["missing", "archived", "both-profile-fields"])
def test_project_creation_rejects_invalid_profile_without_creating_project(workspace, cal, invalid):
    from plotter.web.app import app

    client = TestClient(app)
    client.get("/api/pages")
    service = ProfileService()
    request = {"name": "Darf nicht angelegt werden"}
    if invalid == "missing":
        request["profileId"] = "prof-missing"
    else:
        profile = service.create("Vorhandenes Profil")
        request["profileId"] = profile["id"]
        if invalid == "archived":
            service.archive(profile["id"])
        else:
            request["templateProfileId"] = profile["id"]
    state = FileStateStore(workspace / "state")
    saved_index = state.get("paint_index")
    profiles_before = service.list()
    active_id = service.active_id()
    response = client.post("/api/projects", json=request)
    assert response.status_code == (404 if invalid == "missing" else 409), response.text
    assert state.get("paint_index") == saved_index
    assert service.list() == profiles_before
    assert service.active_id() == active_id


def test_profile_edit_keeps_historical_slide_snapshot_but_new_jobs_use_current_profile(
    workspace, cal
):
    from plotter.web.app import app

    client = TestClient(app)
    index = client.get("/api/pages").json()
    old_id = index["activeId"]
    profile_id = index["project"]["profileId"]
    old = client.get(f"/api/pages/{old_id}").json()
    objects = [_line_object()]
    client.put(f"/api/pages/{old_id}", json={"objects": objects})
    preview_before = client.post(f"/api/pages/{old_id}/preview3d", json={}).json()
    ProfileService().update(profile_id, calibration={"draw_feed": 17})
    assert client.get(f"/api/pages/{old_id}").json()["profileSnapshot"] == old["profileSnapshot"]
    assert client.get(f"/api/pages/{old_id}").json()["objects"] == objects
    preview_after = client.post(f"/api/pages/{old_id}/preview3d", json={}).json()
    # A speed change keeps preview geometry but must invalidate the immutable
    # plan identity: a later job uses the new feed even at the same coordinates.
    assert {k: v for k, v in preview_after.items() if k != "plotPlan"} == {
        k: v for k, v in preview_before.items() if k != "plotPlan"
    }
    assert preview_after["plotPlan"]["id"] != preview_before["plotPlan"]["id"]
    response = client.post(f"/api/pages/{old_id}/gcode", json={})
    assert response.status_code == 200, response.text
    meta = read_job_meta(workspace / "jobs" / response.json()["filename"])
    assert meta["calibrationSnapshot"]["calibration"]["draw_feed"] == 17
    assert meta["profile"]["fingerprint"] == ProfileService().active_profile_meta()["fingerprint"]
    assert (
        next(m for m in client.get("/api/pages").json()["order"] if m["id"] == old_id)["thumb"]
        is None
    )
    new = client.post("/api/pages", json={"name": "Neu"}).json()
    assert new["profileSnapshot"]["calibration"]["draw_feed"] == 17
    assert old["profileSnapshot"]["calibration"]["draw_feed"] != 17


def test_project_slide_job_uses_project_layout_when_reference_profile_differs(workspace, cal):
    from plotter.web.app import app

    client = TestClient(app)
    index = client.get("/api/pages").json()
    page_id = index["activeId"]
    client.put(
        f"/api/pages/{page_id}",
        json={
            "objects": [
                {
                    "id": "line",
                    "type": "line",
                    "cachedPolylines": [[[10, 10], [40, 40]]],
                    "transform": {"x": 0, "y": 0, "scale": 1, "rotation": 0},
                }
            ]
        },
    )
    job = client.post(f"/api/pages/{page_id}/gcode", json={})
    assert job.status_code == 200
    filename = job.json()["filename"]
    service = ProfileService()
    other = service.create("Anderer Drucker")
    service.update(other["id"], calibration={"origin_x": 5})
    service.activate(other["id"])
    listed = next(j for j in client.get("/api/jobs").json() if j["filename"] == filename)
    assert listed["fits"] is True
    with patch.object(op.OctoPrintClient, "upload", return_value={"done": True}):
        sent = client.post("/api/printer/send", json={"filename": filename})
    assert sent.status_code == 200

    # Neither the paper outline nor physical limits of an unrelated legacy
    # default profile can override the profile assigned to this project.
    service.update(other["id"], calibration={"bed_width": 45})
    with patch.object(op.OctoPrintClient, "upload", return_value={"done": True}):
        assert client.post("/api/printer/send", json={"filename": filename}).status_code == 200
    service.update(other["id"], calibration={"bed_width": cal.bed_width})

    service.update(index["project"]["profileId"], calibration={"draw_feed": 17})
    refused = client.post("/api/printer/send", json={"filename": filename})
    assert refused.status_code == 409
    assert (
        next(j for j in client.get("/api/jobs").json() if j["filename"] == filename)["fits"]
        is False
    )


def test_pen_height_change_updates_new_output_and_invalidates_existing_job(workspace, cal):
    from plotter.web.app import app

    client = TestClient(app)
    index = client.get("/api/pages").json()
    page_id = index["activeId"]
    client.put(
        f"/api/pages/{page_id}",
        json={
            "objects": [
                {
                    "id": "line",
                    "type": "line",
                    "cachedPolylines": [[[10, 10], [40, 40]]],
                    "transform": {"x": 0, "y": 0, "scale": 1, "rotation": 0},
                }
            ]
        },
    )
    job = client.post(f"/api/pages/{page_id}/gcode", json={})
    assert job.status_code == 200
    filename = job.json()["filename"]

    ProfileService().update(index["project"]["profileId"], calibration={"pen_down_z": 2.2})
    preview = client.post(f"/api/pages/{page_id}/preview3d", json={})
    assert preview.status_code == 200, preview.text
    assert {point[2] for line in preview.json()["draws"] for point in line} == {2.2}
    refused = client.post("/api/printer/send", json={"filename": filename})
    assert refused.status_code == 409
    assert (
        next(j for j in client.get("/api/jobs").json() if j["filename"] == filename)["fits"]
        is False
    )
    generated = client.post(f"/api/pages/{page_id}/gcode", json={})
    assert generated.status_code == 200, generated.text
    meta = read_job_meta(workspace / "jobs" / generated.json()["filename"])
    assert meta["calibrationSnapshot"]["calibration"]["pen_down_z"] == 2.2
    assert (
        client.get(f"/api/pages/{page_id}").json()["profileSnapshot"]["calibration"]["pen_down_z"]
        == cal.pen_down_z
    )


def test_preview_and_gcode_follow_current_project_origin_without_moving_slide(workspace, cal):
    from plotter.web.app import app

    service = ProfileService()
    profile_id = service.active_id()
    service.update(
        profile_id,
        calibration={
            "paper_corners": {
                "bl": [20, 30],
                "br": [190, 30],
                "tr": [190, 200],
                "tl": [20, 200],
            }
        },
    )
    client = TestClient(app)
    page_id = client.get("/api/pages").json()["activeId"]
    objects = [_line_object()]
    client.put(f"/api/pages/{page_id}", json={"objects": objects})
    before = client.post(f"/api/pages/{page_id}/preview3d", json={}).json()
    with patch("plotter.gcode.scene.time.time", return_value=1000):
        old_job = client.post(f"/api/pages/{page_id}/gcode", json={}).json()["filename"]
    snapshot = client.get(f"/api/pages/{page_id}").json()["profileSnapshot"]

    service.update(profile_id, calibration={"origin_x": 45, "plot_width": 140})
    response = client.post(f"/api/pages/{page_id}/preview3d", json={})
    assert response.status_code == 200, response.text
    after = response.json()
    before_points = [point for line in before["draws"] for point in line]
    after_points = [point for line in after["draws"] for point in line]
    assert len(after_points) == len(before_points) > 0
    assert [point[0] for point in after_points] == pytest.approx(
        [point[0] + 20 for point in before_points]
    )
    assert [point[1] for point in after_points] == pytest.approx(
        [point[1] for point in before_points]
    )
    assert client.get(f"/api/pages/{page_id}").json()["profileSnapshot"] == snapshot
    assert client.get(f"/api/pages/{page_id}").json()["objects"] == objects
    listed = next(job for job in client.get("/api/jobs").json() if job["filename"] == old_job)
    assert listed["fits"] is False
    with patch.object(op.OctoPrintClient, "upload", return_value={"done": True}) as upload:
        assert client.post("/api/printer/send", json={"filename": old_job}).status_code == 409
        upload.assert_not_called()
    # Re-rendering within the same second must not overwrite a loaded old job.
    with patch("plotter.gcode.scene.time.time", return_value=1000):
        generated = client.post(f"/api/pages/{page_id}/gcode", json={})
    assert generated.status_code == 200, generated.text
    assert generated.json()["filename"] != old_job
    old_meta = read_job_meta(workspace / "jobs" / old_job)
    assert old_meta["calibrationSnapshot"]["calibration"]["origin_x"] == 25
    path = workspace / "jobs" / generated.json()["filename"]
    assert parse_gcode_3d(path)["draws"] == after["draws"]
    meta = read_job_meta(path)
    assert meta["calibrationSnapshot"]["calibration"]["origin_x"] == 45
    assert meta["calibrationSnapshot"]["calibration"]["plot_width"] == 140
    assert meta["profile"]["fingerprint"] == service.active_profile_meta()["fingerprint"]


@pytest.mark.parametrize("endpoint", ["preview3d", "gcode", "color-gcode"])
def test_project_render_rejects_profile_changed_since_preview(workspace, cal, endpoint):
    from plotter.web.app import app

    client = TestClient(app)
    index = client.get("/api/pages").json()
    page_id = index["activeId"]
    client.put(f"/api/pages/{page_id}", json={"objects": [_line_object()]})
    service = ProfileService()
    expected = service.active_profile_meta()
    service.update(index["project"]["profileId"], calibration={"origin_x": 35})
    response = client.post(
        f"/api/pages/{page_id}/{endpoint}",
        json=_plot_request(
            endpoint,
            expected_profile_id=expected["id"],
            expected_profile_fingerprint=expected["fingerprint"],
        ),
    )
    assert response.status_code == 409, response.text
    assert not list((workspace / "jobs").glob("*.gcode"))


@pytest.mark.parametrize("endpoint", ["preview3d", "gcode", "color-gcode"])
def test_project_render_reports_content_bounds_when_current_area_is_too_small(
    workspace, cal, endpoint
):
    from plotter.web.app import app

    client = TestClient(app)
    index = client.get("/api/pages").json()
    page_id = index["activeId"]
    objects = [_line_object()]
    client.put(f"/api/pages/{page_id}", json={"objects": objects})
    ProfileService().update(index["project"]["profileId"], calibration={"plot_width": 30})
    response = client.post(f"/api/pages/{page_id}/{endpoint}", json=_plot_request(endpoint))
    assert 400 <= response.status_code < 500, response.text
    detail = response.json()["detail"]
    assert "Inhalt X 10.0–40.0 mm, Y 10.0–40.0 mm" in detail
    assert "verfügbar X 0–30 mm, Y 0–160 mm" in detail
    assert client.get(f"/api/pages/{page_id}").json()["objects"] == objects
    assert not list((workspace / "jobs").glob("*.gcode"))


def test_color_gcode_uses_current_project_calibration_and_snapshot(workspace, cal):
    from plotter.web.app import app

    client = TestClient(app)
    index = client.get("/api/pages").json()
    page_id = index["activeId"]
    client.put(f"/api/pages/{page_id}", json={"objects": [_line_object()]})
    ProfileService().update(
        index["project"]["profileId"], calibration={"origin_x": 45, "plot_width": 140}
    )
    preview = client.post(f"/api/pages/{page_id}/preview3d", json={})
    assert preview.status_code == 200, preview.text
    response = client.post(f"/api/pages/{page_id}/color-gcode", json=_plot_request("color-gcode"))
    assert response.status_code == 200, response.text
    path = workspace / "jobs" / response.json()["files"][0]["filename"]
    assert parse_gcode_3d(path)["draws"] == preview.json()["draws"]
    meta = read_job_meta(path)
    assert meta["calibrationSnapshot"]["calibration"]["origin_x"] == 45
    assert meta["profile"]["fingerprint"] == ProfileService().active_profile_meta()["fingerprint"]


def test_nested_folders_reject_cycles_and_cross_project_moves(workspace, cal):
    from plotter.web.app import app

    client = TestClient(app)
    first_page = client.get("/api/pages").json()["activeId"]
    parent = client.post("/api/pages/groups", json={"name": "Entwürfe"}).json()["groups"][0]
    child = client.post(
        "/api/pages/groups", json={"name": "Briefe", "parentId": parent["id"]}
    ).json()["groups"][1]
    assert child["parentId"] == parent["id"]
    assert (
        client.post(
            f"/api/pages/groups/{parent['id']}/parent", json={"parentId": child["id"]}
        ).status_code
        == 400
    )
    client.post("/api/projects", json={"name": "Anderes"})
    assert (
        client.post(f"/api/pages/{first_page}/group", json={"groupId": child["id"]}).status_code
        == 200
    )
    other_page = client.get("/api/pages").json()["activeId"]
    assert (
        client.post(f"/api/pages/{other_page}/group", json={"groupId": child["id"]}).status_code
        == 404
    )


def test_moving_slide_keeps_its_snapshot_and_repairs_old_project(workspace, cal):
    from plotter.web.app import app

    client = TestClient(app)
    original = client.get("/api/pages").json()
    page_id = original["activeId"]
    snapshot = client.get(f"/api/pages/{page_id}").json()["profileSnapshot"]
    target = client.post("/api/projects", json={"name": "Ziel"}).json()["project"]
    client.post(f"/api/projects/{original['project']['id']}/activate")
    result = client.post(f"/api/pages/{page_id}/move", json={"targetProjectId": target["id"]})
    assert result.status_code == 200
    assert page_id not in [m["id"] for m in result.json()["order"]]
    assert result.json()["activeId"] is not None
    moved = client.get(f"/api/pages/{page_id}").json()
    assert moved["projectId"] == target["id"]
    assert moved["profileSnapshot"] == snapshot


def test_legacy_index_migrates_without_changing_slide_ids(workspace, cal):
    state = FileStateStore(workspace / "state")
    profile = ProfileService().active_profile_meta()
    old = {
        "id": "p-old",
        "name": "Alt",
        "objects": [],
        "grid": {"step": 10, "snap": False},
        "profileId": profile["id"],
        "profileName": profile["name"],
        "profileFingerprint": profile["fingerprint"],
        "groupId": "g-old",
    }
    state.set("paint_page_p-old", old)
    state.set(
        "paint_index",
        {
            "order": [{"id": "p-old", "profileId": profile["id"], "groupId": "g-old"}],
            "activeId": "p-old",
            "groups": [{"id": "g-old", "name": "Archiv"}],
        },
    )
    index = DocumentStore(state).list_pages()
    assert index["activeId"] == "p-old"
    assert index["order"][0]["projectId"] == index["project"]["id"]
    assert index["groups"][0]["name"] == "Archiv"
    assert state.get("paint_page_p-old")["profileSnapshot"]["fingerprint"] == profile["fingerprint"]
    assert state.get("paint_index_before_projects")["activeId"] == "p-old"


def test_project_covers_and_slide_thumbnails_are_lazy_and_refresh_after_edit(workspace, cal):
    from plotter.gcode.scene import page_thumbnail
    from plotter.web.app import app

    client = TestClient(app)
    index = client.get("/api/pages").json()
    page_id = index["activeId"]
    assert client.get(f"/api/pages/{page_id}/thumbnail").json()["thumb"] is None
    assert client.get("/api/pages/missing/thumbnail").status_code == 404

    objects = [
        {
            "id": "line",
            "type": "line",
            "cachedPolylines": [[[10, 10], [40, 40]]],
            "transform": {"x": 0, "y": 0, "scale": 1, "rotation": 0},
        }
    ]
    client.put(f"/api/pages/{page_id}", json={"objects": objects})
    assert (
        next(page for page in client.get("/api/pages").json()["order"] if page["id"] == page_id)[
            "thumb"
        ]
        is None
    )
    project = next(
        p for p in client.get("/api/projects").json() if p["id"] == index["project"]["id"]
    )
    assert project["coverPageId"] == page_id
    assert project["slideCount"] == 1

    with patch("plotter.gcode.scene.page_thumbnail", wraps=page_thumbnail) as render:
        first = client.get(f"/api/pages/{page_id}/thumbnail").json()
        second = client.get(f"/api/pages/{page_id}/thumbnail").json()
        assert first == second
        assert first["thumb"]["d"]
        assert render.call_count == 1
        objects[0]["cachedPolylines"] = [[[10, 10], [70, 40]]]
        client.put(f"/api/pages/{page_id}", json={"objects": objects})
        changed = client.get(f"/api/pages/{page_id}/thumbnail").json()
        assert changed["thumb"]["d"] != first["thumb"]["d"]
        assert render.call_count == 2


def test_captured_project_page_creation_does_not_switch_the_current_project(workspace, cal):
    from plotter.core.document import get_document_store
    from plotter.web.app import app

    client = TestClient(app)
    first = client.get("/api/pages").json()
    second = client.post("/api/projects", json={"name": "Other window"}).json()
    profile = first["activeProfile"]
    response = client.post("/api/pages", json={
        "name": "Captured template", "projectId": first["project"]["id"],
        "expected_profile_id": profile["id"],
        "expected_profile_fingerprint": profile["fingerprint"],
    })
    assert response.status_code == 200
    page = response.json()
    assert page["projectId"] == first["project"]["id"]
    assert page["profileId"] == profile["id"]
    assert page["profileFingerprint"] == profile["fingerprint"]
    active = client.get("/api/pages").json()
    assert active["project"]["id"] == second["project"]["id"]
    assert active["activeId"] == second["activeId"]
    # Legacy activeId must remain consistent too, not only the project view.
    store = get_document_store()._pages.data
    assert store.index()["activeId"] == second["activeId"]
    reopened = client.post(f"/api/projects/{first['project']['id']}/activate").json()
    assert reopened["activeId"] == page["id"]


def test_captured_template_rejects_a_changed_profile_without_creating_a_page(workspace, cal):
    from plotter.web.app import app

    client = TestClient(app)
    index = client.get("/api/pages").json()
    profile = index["activeProfile"]
    ProfileService().update(profile["id"], calibration={"plot_width": 90})
    response = client.post("/api/pages", json={
        "projectId": index["project"]["id"],
        "expected_profile_id": profile["id"],
        "expected_profile_fingerprint": profile["fingerprint"],
    })
    assert response.status_code == 409
    assert len(client.get("/api/pages").json()["order"]) == len(index["order"])


def test_captured_template_rejects_missing_and_archived_projects(workspace, cal):
    from plotter.web.app import app

    client = TestClient(app)
    index = client.get("/api/pages").json()
    assert client.post("/api/pages", json={"projectId": "gone"}).status_code == 404
    client.post("/api/projects", json={"name": "Other"})
    client.put(f"/api/projects/{index['project']['id']}", json={"archived": True})
    assert client.post("/api/pages", json={"projectId": index["project"]["id"]}).status_code == 409
