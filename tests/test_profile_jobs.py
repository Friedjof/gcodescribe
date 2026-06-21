from __future__ import annotations

import json
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import plotter.octoprint as op
from plotter.jobmeta import job_meta_path, read_job_meta
from plotter.services.profiles import ProfileService


@pytest.fixture
def client(workspace, cal) -> TestClient:
    from plotter.web.app import app

    return TestClient(app)


def _make_job(client: TestClient) -> str:
    """A safety-clean job with sidecar, created through the real API."""
    r = client.post("/api/testpattern/frame")
    assert r.status_code == 200
    return r.json()["filename"]


class TestSidecars:
    def test_testpattern_writes_sidecar(self, client, workspace):
        filename = _make_job(client)
        meta = read_job_meta(workspace / "jobs" / filename)
        assert meta is not None
        assert meta["filename"] == filename
        active = ProfileService().active_profile_meta()
        assert meta["profile"]["id"] == active["id"]
        assert meta["profile"]["fingerprint"] == active["fingerprint"]
        assert meta["source"]["kind"] == "testpattern"

    def test_job_list_reports_profile_status(self, client):
        _make_job(client)
        jobs = client.get("/api/jobs").json()
        assert jobs[0]["profile"]["matchesActive"] is True
        assert jobs[0]["profile"]["stale"] is False
        assert jobs[0]["profile"]["legacy"] is False

    def test_rename_moves_sidecar(self, client, workspace):
        filename = _make_job(client)
        r = client.post(f"/api/jobs/{filename}/rename", json={"name": "umbenannt"})
        assert r.status_code == 200
        jobs = workspace / "jobs"
        assert not job_meta_path(jobs / filename).exists()
        meta = read_job_meta(jobs / "umbenannt.gcode")
        assert meta is not None
        assert meta["filename"] == "umbenannt.gcode"
        assert r.json()["profile"]["matchesActive"] is True

    def test_rename_refuses_existing_sidecar_target(self, client, workspace):
        filename = _make_job(client)
        jobs = workspace / "jobs"
        (jobs / "ziel.json").write_text("{}")
        r = client.post(f"/api/jobs/{filename}/rename", json={"name": "ziel"})
        assert r.status_code == 409
        assert (jobs / filename).exists()
        assert job_meta_path(jobs / filename).exists()

    def test_rename_keeps_corrupt_sidecar_with_job(self, client, workspace):
        filename = _make_job(client)
        jobs = workspace / "jobs"
        job_meta_path(jobs / filename).write_text("{kaputt")
        r = client.post(f"/api/jobs/{filename}/rename", json={"name": "defekt"})
        assert r.status_code == 200
        assert not job_meta_path(jobs / filename).exists()
        assert (jobs / "defekt.json").read_text() == "{kaputt"
        assert r.json()["issue"].startswith("Job-Metadaten sind beschädigt")

    def test_delete_removes_sidecar(self, client, workspace):
        filename = _make_job(client)
        client.delete(f"/api/jobs/{filename}")
        jobs = workspace / "jobs"
        assert not (jobs / filename).exists()
        assert not job_meta_path(jobs / filename).exists()

    def test_legacy_job_listed_but_marked(self, client, workspace):
        (workspace / "jobs").mkdir(exist_ok=True)
        (workspace / "jobs" / "alt.gcode").write_text("G21\nG90\n")
        jobs = client.get("/api/jobs").json()
        legacy = next(j for j in jobs if j["filename"] == "alt.gcode")
        assert legacy["profile"]["legacy"] is True
        assert legacy["profile"]["matchesActive"] is False

    def test_job_list_reports_missing_profile(self, client, workspace):
        filename = _make_job(client)
        path = workspace / "jobs" / filename
        meta = read_job_meta(path)
        meta["profile"]["id"] = "prof-geloescht"
        meta["profile"]["name"] = "Gelöscht"
        job_meta_path(path).write_text(json.dumps(meta))
        job = next(j for j in client.get("/api/jobs").json() if j["filename"] == filename)
        assert job["profile"]["missing"] is True
        assert job["profile"]["matchesActive"] is False

    def test_job_list_reports_archived_profile(self, client):
        filename = _make_job(client)
        svc = ProfileService()
        original = svc.active_id()
        other = svc.create("Postkarte")
        svc.activate(other["id"])
        svc.archive(original)
        job = next(j for j in client.get("/api/jobs").json() if j["filename"] == filename)
        assert job["profile"]["archived"] is True
        assert job["profile"]["matchesActive"] is False

    def test_corrupt_sidecar_listed_as_issue(self, client, workspace):
        filename = _make_job(client)
        path = workspace / "jobs" / filename
        job_meta_path(path).write_text("{kaputt")
        jobs = client.get("/api/jobs").json()
        job = next(j for j in jobs if j["filename"] == filename)
        assert job["fits"] is False
        assert job["issue"].startswith("Job-Metadaten sind beschädigt")
        assert job["profile"]["legacy"] is True


class TestSendGuard:
    def test_matching_job_is_sent(self, client):
        filename = _make_job(client)
        with patch.object(op.OctoPrintClient, "upload", return_value={"done": True}):
            r = client.post("/api/printer/send", json={"filename": filename, "start": False})
        assert r.status_code == 200

    def test_legacy_job_is_blocked(self, client, workspace):
        (workspace / "jobs").mkdir(exist_ok=True)
        (workspace / "jobs" / "alt.gcode").write_text("G21\nG90\n")
        r = client.post("/api/printer/send", json={"filename": "alt.gcode", "start": False})
        assert r.status_code == 409
        assert "Legacy" in r.json()["detail"]

    def test_foreign_profile_job_is_blocked(self, client):
        filename = _make_job(client)
        svc = ProfileService()
        other = svc.create("Postkarte")
        svc.activate(other["id"])
        r = client.post("/api/printer/send", json={"filename": filename, "start": False})
        assert r.status_code == 409
        assert "gehört zu Profil" in r.json()["detail"]

    def test_stale_job_is_blocked(self, client):
        filename = _make_job(client)
        # Same profile id, but a safety-relevant value changed afterwards.
        svc = ProfileService()
        svc.update(svc.active_id(), calibration={"pen_down_z": 2.9})
        r = client.post("/api/printer/send", json={"filename": filename, "start": False})
        assert r.status_code == 409
        assert "geändert" in r.json()["detail"]

    def test_sidecar_without_profile_id_is_legacy(self, client, workspace):
        filename = _make_job(client)
        path = workspace / "jobs" / filename
        meta = read_job_meta(path)
        meta["profile"] = {}
        job_meta_path(path).write_text(json.dumps(meta))
        r = client.post("/api/printer/send", json={"filename": filename, "start": False})
        assert r.status_code == 409
        assert "Legacy" in r.json()["detail"]

    def test_missing_profile_job_is_blocked(self, client, workspace):
        filename = _make_job(client)
        path = workspace / "jobs" / filename
        meta = read_job_meta(path)
        meta["profile"]["id"] = "prof-geloescht"
        meta["profile"]["name"] = "Gelöscht"
        job_meta_path(path).write_text(json.dumps(meta))
        r = client.post("/api/printer/send", json={"filename": filename, "start": False})
        assert r.status_code == 409
        assert "existiert nicht mehr" in r.json()["detail"]

    def test_archived_profile_job_is_blocked(self, client):
        filename = _make_job(client)
        svc = ProfileService()
        original = svc.active_id()
        other = svc.create("Postkarte")
        svc.activate(other["id"])
        svc.archive(original)
        r = client.post("/api/printer/send", json={"filename": filename, "start": False})
        assert r.status_code == 409
        assert "archiviert" in r.json()["detail"]

    def test_corrupt_sidecar_is_blocked(self, client, workspace):
        filename = _make_job(client)
        path = workspace / "jobs" / filename
        job_meta_path(path).write_text("{kaputt")
        r = client.post("/api/printer/send", json={"filename": filename, "start": False})
        assert r.status_code == 409
        assert "Metadaten sind beschädigt" in r.json()["detail"]
