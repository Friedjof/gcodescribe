from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from plotter.core.calibration import Calibration
from plotter.core.document import get_document_store
from plotter.core.jobmeta import read_job_meta
from plotter.core.storage import jobs_dir
from plotter.gcode.preview import parse_gcode_3d
from plotter.services.profiles import ProfileService


@pytest.fixture
def client(workspace, cal) -> TestClient:
    from plotter.web.app import app

    return TestClient(app)


def _line_object(x0: float, y0: float, x1: float, y1: float) -> dict:
    return {
        "id": "o-1",
        "type": "line",
        "transform": {"x": 0, "y": 0, "rotation": 0, "scale": 1},
        "cachedPolylines": [[[x0, y0], [x1, y1]]],
    }


class TestPageProfileBinding:
    def test_new_page_gets_project_profile_after_global_switch(self, client):
        project = client.get("/api/pages").json()["project"]
        profiles = ProfileService()
        project_profile = profiles.get(project["profileId"])
        profiles.activate(profiles.create("Other global profile")["id"])
        page = client.post("/api/pages", json={"name": "Karte"}).json()
        assert page["profileId"] == project_profile["id"]
        assert page["profileFingerprint"] == project_profile["fingerprint"]

    def test_page_list_reports_status(self, client):
        page = client.post("/api/pages", json={}).json()
        index = client.get("/api/pages").json()
        meta = next(m for m in index["order"] if m["id"] == page["id"])
        assert meta["profileStatus"] == "active"
        assert index["activeProfile"]["id"] == page["profileId"]

    def test_global_profile_switch_does_not_change_project_page(self, client):
        page = client.post("/api/pages", json={}).json()
        svc = ProfileService()
        svc.activate(svc.create("Postkarte")["id"])
        index = client.get("/api/pages").json()
        meta = next(m for m in index["order"] if m["id"] == page["id"])
        assert meta["profileStatus"] == "active"

    def test_archived_profile_marks_page_as_archived(self, client):
        page = client.post("/api/pages", json={}).json()
        svc = ProfileService()
        original = svc.active_id()
        other = svc.create("Postkarte")
        svc.activate(other["id"])
        svc.archive(original)
        meta = next(m for m in client.get("/api/pages").json()["order"] if m["id"] == page["id"])
        assert meta["profileStatus"] == "archived"

    def test_missing_profile_marks_page_as_missing(self, client):
        page = client.post("/api/pages", json={}).json()
        store = get_document_store()
        store.set_page_profile(
            page["id"],
            {"id": "prof-geloescht", "name": "Gelöscht", "fingerprint": "sha256:x"},
        )
        assert client.get(f"/api/pages/{page['id']}").json()["profileStatus"] == "missing"

    def test_calibration_edit_marks_page_as_stale(self, client):
        page = client.post("/api/pages", json={}).json()
        svc = ProfileService()
        svc.update(svc.active_id(), calibration={"pen_down_z": 2.2})
        assert client.get(f"/api/pages/{page['id']}").json()["profileStatus"] == "stale"

    def test_duplicate_keeps_source_profile(self, client):
        page = client.post("/api/pages", json={}).json()
        svc = ProfileService()
        svc.activate(svc.create("Postkarte")["id"])
        copy = client.post(f"/api/pages/{page['id']}/duplicate").json()
        assert copy["profileId"] == page["profileId"]


class TestPageGcodeGuard:
    def _page_with_content(self, client) -> dict:
        page = client.post("/api/pages", json={"name": "Inhalt"}).json()
        client.put(
            f"/api/pages/{page['id']}",
            json={"objects": [_line_object(10, 10, 50, 50)]},
        )
        return page

    def test_matching_page_generates_job(self, client):
        page = self._page_with_content(client)
        r = client.post(f"/api/pages/{page['id']}/gcode")
        assert r.status_code == 200
        assert r.json()["profile"]["matchesActive"] is True

    def test_global_profile_switch_does_not_block_plot(self, client):
        page = self._page_with_content(client)
        svc = ProfileService()
        svc.activate(svc.create("Postkarte")["id"])
        r = client.post(f"/api/pages/{page['id']}/gcode")
        assert r.status_code == 200

    def test_archived_project_profile_blocks_render_without_erasing_slide_snapshot(self, client):
        page = self._page_with_content(client)
        store = get_document_store()
        snapshot = store.get_page(page["id"])["profileSnapshot"]
        svc = ProfileService()
        original = svc.active_id()
        other = svc.create("Postkarte")
        svc.activate(other["id"])
        svc.archive(original)
        r = client.post(f"/api/pages/{page['id']}/gcode")
        assert r.status_code == 422
        assert "archiviert" in r.json()["detail"]
        assert store.get_page(page["id"])["profileSnapshot"] == snapshot

    def test_missing_historical_profile_uses_current_project_profile(self, client):
        page = self._page_with_content(client)
        get_document_store().set_page_profile(
            page["id"],
            {"id": "prof-geloescht", "name": "Gelöscht", "fingerprint": "sha256:x"},
        )
        r = client.post(f"/api/pages/{page['id']}/gcode")
        assert r.status_code == 200
        meta = read_job_meta(jobs_dir() / r.json()["filename"])
        assert meta["profile"]["id"] == page["profileId"]
        assert get_document_store().get_page(page["id"])["profileId"] == "prof-geloescht"

    def test_project_expected_profile_is_valid_after_global_switch(self, client):
        page = self._page_with_content(client)
        expected = client.get("/api/pages").json()["activeProfile"]
        svc = ProfileService()
        svc.activate(svc.create("Postkarte")["id"])
        r = client.post(
            f"/api/pages/{page['id']}/gcode",
            json={
                "expected_profile_id": expected["id"],
                "expected_profile_fingerprint": expected["fingerprint"],
            },
        )
        assert r.status_code == 200

    def test_pen_height_change_is_used_without_adopting_existing_slide(self, client):
        page = self._page_with_content(client)
        store = get_document_store()
        snapshot = store.get_page(page["id"])["profileSnapshot"]
        svc = ProfileService()
        current = svc.update(page["profileId"], calibration={"pen_down_z": 2.2})
        preview = client.post(f"/api/pages/{page['id']}/preview3d", json={})
        assert preview.status_code == 200
        assert {point[2] for line in preview.json()["draws"] for point in line} == {2.2}
        r = client.post(f"/api/pages/{page['id']}/gcode")
        assert r.status_code == 200
        path = jobs_dir() / r.json()["filename"]
        assert parse_gcode_3d(path)["draws"] == preview.json()["draws"]
        meta = read_job_meta(path)
        assert meta["calibrationSnapshot"]["calibration"]["pen_down_z"] == 2.2
        assert meta["calibrationSnapshot"]["fingerprint"] == current["fingerprint"]
        assert store.get_page(page["id"])["profileSnapshot"] == snapshot

    def test_legacy_page_uses_project_profile_without_creating_historical_snapshot(self, client):
        store = get_document_store()
        page = store.create_page("Alt")
        legacy = store.get_page(page["id"])
        legacy.pop("profileSnapshot")
        store._store.set(store._page_key(page["id"]), legacy)
        client.put(
            f"/api/pages/{page['id']}",
            json={"objects": [_line_object(10, 10, 50, 50)]},
        )
        r = client.post(f"/api/pages/{page['id']}/gcode")
        assert r.status_code == 200
        meta = read_job_meta(jobs_dir() / r.json()["filename"])
        assert meta["profile"]["id"] == page["profileId"]
        assert "profileSnapshot" not in store.get_page(page["id"])

    def test_preview_and_gcode_use_changed_project_origin_despite_global_profile(self, client):
        page = self._page_with_content(client)
        store = get_document_store()
        snapshot = store.get_page(page["id"])["profileSnapshot"]
        profiles = ProfileService()
        current = profiles.update(page["profileId"], calibration={
            "origin_x": 65, "origin_y": 45, "plot_width": 120, "plot_height": 100,
            "flip_y": False,
        })
        other = profiles.create("Other paper", calibration={
            "origin_x": 0, "origin_y": 0, "plot_width": 200, "plot_height": 200,
            "pen_down_z": 4,
        })
        profiles.activate(other["id"])
        preview = client.post(f"/api/pages/{page['id']}/preview3d", json={})
        assert preview.status_code == 200
        assert preview.json()["draws"] == [[[75, 55, 1.4], [115, 95, 1.4]]]
        job = client.post(f"/api/pages/{page['id']}/gcode")
        assert job.status_code == 200
        path = jobs_dir() / job.json()["filename"]
        assert parse_gcode_3d(path)["draws"] == preview.json()["draws"]
        meta = read_job_meta(path)
        assert Calibration.from_dict(meta["calibrationSnapshot"]["calibration"]) == (
            Calibration.from_dict(current["calibration"])
        )
        assert store.get_page(page["id"])["profileSnapshot"] == snapshot
        assert profiles.active_id() == other["id"]


class TestSelectionGcode:
    """Plot only a chosen subset of a page's objects (designer selection plot)."""

    def _pen_downs(self, filename: str) -> int:
        from plotter.core.storage import jobs_dir

        text = (jobs_dir() / filename).read_text()
        return sum(1 for line in text.splitlines() if line.startswith("G1 Z"))

    def _two_object_page(self, client) -> dict:
        page = client.post("/api/pages", json={"name": "Zwei"}).json()
        a = {**_line_object(10, 10, 20, 20), "id": "o-A"}
        b = {**_line_object(60, 60, 70, 70), "id": "o-B"}
        client.put(f"/api/pages/{page['id']}", json={"objects": [a, b]})
        return {"page": page, "a": a, "b": b}

    def test_subset_plots_only_chosen_objects(self, client):
        ctx = self._two_object_page(client)
        page_id = ctx["page"]["id"]

        # Read each job right after it is written: same-second plots of one page
        # share a timestamped filename, so a later plot would overwrite it.
        selection = client.post(f"/api/pages/{page_id}/gcode", json={"objects": [ctx["a"]]})
        assert selection.status_code == 200
        selection_downs = self._pen_downs(selection.json()["filename"])

        full = client.post(f"/api/pages/{page_id}/gcode")
        assert full.status_code == 200
        full_downs = self._pen_downs(full.json()["filename"])

        # One stroke for the single-object plot, two for the whole page.
        assert selection_downs == 1
        assert full_downs == 2

    def test_no_objects_field_plots_the_whole_page(self, client):
        ctx = self._two_object_page(client)
        r = client.post(f"/api/pages/{ctx['page']['id']}/gcode", json={})
        assert r.status_code == 200
        assert self._pen_downs(r.json()["filename"]) == 2

    def test_empty_selection_is_rejected(self, client):
        ctx = self._two_object_page(client)
        r = client.post(f"/api/pages/{ctx['page']['id']}/gcode", json={"objects": []})
        assert r.status_code == 400

    def test_selection_uses_project_profile_after_global_switch(self, client):
        ctx = self._two_object_page(client)
        svc = ProfileService()
        svc.activate(svc.create("Postkarte")["id"])
        r = client.post(f"/api/pages/{ctx['page']['id']}/gcode", json={"objects": [ctx["a"]]})
        assert r.status_code == 200


class TestAdoptProfile:
    def test_adopt_binds_legacy_page(self, client):
        store = get_document_store()
        page = store.create_page("Alt")
        r = client.post(f"/api/pages/{page['id']}/adopt-profile", json={})
        assert r.status_code == 200
        assert r.json()["profileStatus"] == "active"
        # Afterwards G-code generation works (with content).
        client.put(
            f"/api/pages/{page['id']}",
            json={"objects": [_line_object(10, 10, 50, 50)]},
        )
        assert client.post(f"/api/pages/{page['id']}/gcode").status_code == 200

    def test_adopt_refuses_out_of_bounds_content(self, client, cal):
        store = get_document_store()
        page = store.create_page("Gross")
        client.put(
            f"/api/pages/{page['id']}",
            json={"objects": [_line_object(0, 0, cal.plot_width + 50, 20)]},
        )
        r = client.post(f"/api/pages/{page['id']}/adopt-profile", json={})
        assert r.status_code == 409
        assert "Plotbereich" in r.json()["detail"]
        assert f"{cal.plot_width + 50:.1f}" in r.json()["detail"]

    def test_adopt_force_overrides_bounds(self, client, cal):
        store = get_document_store()
        page = store.create_page("Gross")
        client.put(
            f"/api/pages/{page['id']}",
            json={"objects": [_line_object(0, 0, cal.plot_width + 50, 20)]},
        )
        r = client.post(f"/api/pages/{page['id']}/adopt-profile", json={"force": True})
        assert r.status_code == 200
        assert r.json()["profileStatus"] == "active"

    def test_adopt_refreshes_stale_page(self, client):
        page = client.post("/api/pages", json={}).json()
        svc = ProfileService()
        svc.update(svc.active_id(), calibration={"pen_down_z": 2.2})
        assert client.get(f"/api/pages/{page['id']}").json()["profileStatus"] == "stale"
        r = client.post(f"/api/pages/{page['id']}/adopt-profile", json={})
        assert r.status_code == 200
        assert r.json()["profileStatus"] == "active"

    def test_stale_expected_profile_blocks_adopt(self, client):
        store = get_document_store()
        page = store.create_page("Alt")
        expected = client.get("/api/pages").json()["activeProfile"]
        svc = ProfileService()
        svc.update(expected["id"], calibration={"pen_down_z": 2.2})
        r = client.post(
            f"/api/pages/{page['id']}/adopt-profile",
            json={
                "expected_profile_id": expected["id"],
                "expected_profile_fingerprint": expected["fingerprint"],
            },
        )
        assert r.status_code == 409
        assert "Profil" in r.json()["detail"]
