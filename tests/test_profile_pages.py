from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from plotter.document import get_document_store
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
    def test_new_page_gets_active_profile(self, client):
        page = client.post("/api/pages", json={"name": "Karte"}).json()
        active = ProfileService().active_profile_meta()
        assert page["profileId"] == active["id"]
        assert page["profileFingerprint"] == active["fingerprint"]

    def test_page_list_reports_status(self, client):
        page = client.post("/api/pages", json={}).json()
        index = client.get("/api/pages").json()
        meta = next(m for m in index["order"] if m["id"] == page["id"])
        assert meta["profileStatus"] == "active"
        assert index["activeProfile"]["id"] == page["profileId"]

    def test_profile_switch_marks_page_as_other(self, client):
        page = client.post("/api/pages", json={}).json()
        svc = ProfileService()
        svc.activate(svc.create("Postkarte")["id"])
        index = client.get("/api/pages").json()
        meta = next(m for m in index["order"] if m["id"] == page["id"])
        assert meta["profileStatus"] == "other"

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

    def test_foreign_page_is_blocked(self, client):
        page = self._page_with_content(client)
        svc = ProfileService()
        svc.activate(svc.create("Postkarte")["id"])
        r = client.post(f"/api/pages/{page['id']}/gcode")
        assert r.status_code == 409
        assert "gehört zu Profil" in r.json()["detail"]

    def test_archived_page_is_blocked(self, client):
        page = self._page_with_content(client)
        svc = ProfileService()
        original = svc.active_id()
        other = svc.create("Postkarte")
        svc.activate(other["id"])
        svc.archive(original)
        r = client.post(f"/api/pages/{page['id']}/gcode")
        assert r.status_code == 409
        assert "archiviert" in r.json()["detail"]

    def test_missing_profile_page_is_blocked(self, client):
        page = self._page_with_content(client)
        get_document_store().set_page_profile(
            page["id"],
            {"id": "prof-geloescht", "name": "Gelöscht", "fingerprint": "sha256:x"},
        )
        r = client.post(f"/api/pages/{page['id']}/gcode")
        assert r.status_code == 409
        assert "existiert nicht mehr" in r.json()["detail"]

    def test_stale_expected_profile_blocks_gcode(self, client):
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
        assert r.status_code == 409
        assert "Profil" in r.json()["detail"]

    def test_stale_page_is_blocked(self, client):
        page = self._page_with_content(client)
        svc = ProfileService()
        svc.update(svc.active_id(), calibration={"pen_down_z": 2.2})
        r = client.post(f"/api/pages/{page['id']}/gcode")
        assert r.status_code == 409

    def test_legacy_page_is_blocked(self, client):
        store = get_document_store()
        page = store.create_page("Alt")  # no profile, like pre-profile data
        client.put(
            f"/api/pages/{page['id']}",
            json={"objects": [_line_object(10, 10, 50, 50)]},
        )
        r = client.post(f"/api/pages/{page['id']}/gcode")
        assert r.status_code == 409
        assert "Legacy" in r.json()["detail"]


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
        svc.activate(svc.create("Postkarte")["id"])
        r = client.post(
            f"/api/pages/{page['id']}/adopt-profile",
            json={
                "expected_profile_id": expected["id"],
                "expected_profile_fingerprint": expected["fingerprint"],
            },
        )
        assert r.status_code == 409
        assert "Profil" in r.json()["detail"]
