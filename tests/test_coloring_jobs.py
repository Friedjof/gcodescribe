from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from plotter.jobmeta import read_job_meta
from plotter.services.profiles import ProfileService


@pytest.fixture
def client(workspace, cal) -> TestClient:
    from plotter.web.app import app

    return TestClient(app)


def _line_object(oid: str, x0: float, y0: float, x1: float, y1: float) -> dict:
    return {
        "id": oid,
        "type": "line",
        "transform": {"x": 0, "y": 0, "rotation": 0, "scale": 1},
        "cachedPolylines": [[[x0, y0], [x1, y1]]],
    }


def _page(client: TestClient) -> str:
    """A fresh page bound to the active profile; returns its id."""
    page = client.post("/api/pages", json={"name": "Postkarte"}).json()
    return page["id"]


def _colors(*items: dict) -> list[dict]:
    return list(items)


def _slice(client: TestClient, page_id: str, group: str, colors: list[dict], replace=False):
    return client.post(
        f"/api/pages/{page_id}/color-gcode",
        json={"color_group_id": group, "replace_existing": replace, "colors": colors},
    )


class TestColorGcode:
    def test_two_colors_create_two_named_jobs(self, client):
        page_id = _page(client)
        r = _slice(
            client,
            page_id,
            "group-a",
            _colors(
                {"color": "black", "label": "Schwarz", "order": 1,
                 "objects": [_line_object("o1", 10, 10, 50, 50)]},
                {"color": "red", "label": "Rot", "order": 2,
                 "objects": [_line_object("o2", 20, 20, 60, 60)]},
            ),
        )
        assert r.status_code == 200, r.text
        files = r.json()["files"]
        assert len(files) == 2
        names = sorted(f["filename"] for f in files)
        assert "color-01-schwarz" in names[0]
        assert "color-02-rot" in names[1]

    def test_sidecar_carries_color_metadata(self, client, workspace):
        page_id = _page(client)
        r = _slice(
            client, page_id, "group-meta",
            _colors({"color": "red", "label": "Rot", "order": 2,
                     "objects": [_line_object("o2", 20, 20, 60, 60)]}),
        )
        filename = r.json()["files"][0]["filename"]
        meta = read_job_meta(workspace / "jobs" / filename)
        assert meta["source"]["kind"] == "paint_coloring"
        assert meta["source"]["color"] == "red"
        assert meta["source"]["color_label"] == "Rot"
        assert meta["source"]["color_order"] == 2
        assert meta["source"]["color_group_id"] == "group-meta"
        active = ProfileService().active_profile_meta()
        assert meta["profile"]["id"] == active["id"]

    def test_replace_drops_stale_jobs_without_duplicates(self, client):
        page_id = _page(client)
        first = _slice(
            client, page_id, "group-x",
            _colors(
                {"color": "black", "label": "Schwarz", "order": 1,
                 "objects": [_line_object("o1", 10, 10, 50, 50)]},
                {"color": "blue", "label": "Blau", "order": 2,
                 "objects": [_line_object("o3", 30, 30, 70, 70)]},
            ),
        )
        assert first.status_code == 200
        # Re-slice the same session down to a single colour: the now-stale blue
        # job must be removed, leaving exactly one coloring job, no duplicates.
        second = _slice(
            client, page_id, "group-x",
            _colors({"color": "black", "label": "Schwarz", "order": 1,
                     "objects": [_line_object("o1", 10, 10, 50, 50)]}),
            replace=True,
        )
        assert second.status_code == 200, second.text
        jobs = client.get("/api/jobs").json()
        coloring = [j for j in jobs if "color-" in j["filename"]]
        assert len(coloring) == 1
        assert "blau" not in coloring[0]["filename"]

    def test_existing_group_without_replace_conflicts(self, client):
        page_id = _page(client)
        colors = _colors({"color": "black", "label": "Schwarz", "order": 1,
                          "objects": [_line_object("o1", 10, 10, 50, 50)]})
        assert _slice(client, page_id, "group-c", colors).status_code == 200
        r = _slice(client, page_id, "group-c", colors, replace=False)
        assert r.status_code == 409
        assert "ersetzen" in r.json()["detail"]

    def test_empty_color_groups_are_ignored(self, client):
        page_id = _page(client)
        r = _slice(
            client, page_id, "group-e",
            _colors(
                {"color": "black", "label": "Schwarz", "order": 1,
                 "objects": [_line_object("o1", 10, 10, 50, 50)]},
                {"color": "green", "label": "Gruen", "order": 2, "objects": []},
            ),
        )
        assert r.status_code == 200
        assert len(r.json()["files"]) == 1

    def test_all_empty_is_rejected(self, client):
        page_id = _page(client)
        r = _slice(
            client, page_id, "group-z",
            _colors({"color": "black", "label": "Schwarz", "order": 1, "objects": []}),
        )
        assert r.status_code == 422

    def test_unknown_color_is_rejected(self, client):
        page_id = _page(client)
        r = _slice(
            client, page_id, "group-u",
            _colors({"color": "purple", "label": "Lila", "order": 1,
                     "objects": [_line_object("o1", 10, 10, 50, 50)]}),
        )
        assert r.status_code == 422

    def test_invalid_group_id_is_rejected(self, client):
        page_id = _page(client)
        r = _slice(
            client, page_id, "bad group/id!",
            _colors({"color": "black", "label": "Schwarz", "order": 1,
                     "objects": [_line_object("o1", 10, 10, 50, 50)]}),
        )
        assert r.status_code == 422

    def test_foreign_profile_is_blocked(self, client):
        page_id = _page(client)
        other = ProfileService().create("Anderes")
        ProfileService().activate(other["id"])
        r = _slice(
            client, page_id, "group-f",
            _colors({"color": "black", "label": "Schwarz", "order": 1,
                     "objects": [_line_object("o1", 10, 10, 50, 50)]}),
        )
        assert r.status_code == 409
        assert "gehört zu Profil" in r.json()["detail"]

    def test_failed_color_rolls_back_created_jobs(self, client):
        page_id = _page(client)
        # Second colour has only a degenerate (single-point) polyline, so its
        # job generation fails after the first colour was already written.
        degenerate = {
            "id": "o-bad", "type": "line",
            "transform": {"x": 0, "y": 0, "rotation": 0, "scale": 1},
            "cachedPolylines": [[[10, 10]]],
        }
        r = _slice(
            client, page_id, "group-roll",
            _colors(
                {"color": "black", "label": "Schwarz", "order": 1,
                 "objects": [_line_object("o1", 10, 10, 50, 50)]},
                {"color": "red", "label": "Rot", "order": 2, "objects": [degenerate]},
            ),
        )
        assert r.status_code == 400
        # The first colour's job must have been cleaned up — no half group left.
        jobs = client.get("/api/jobs").json()
        assert not [j for j in jobs if "color-" in j["filename"]]

    def test_job_list_exposes_color_source(self, client):
        page_id = _page(client)
        _slice(
            client, page_id, "group-badge",
            _colors({"color": "blue", "label": "Blau", "order": 1,
                     "objects": [_line_object("o1", 10, 10, 50, 50)]}),
        )
        job = next(j for j in client.get("/api/jobs").json() if "color-" in j["filename"])
        assert job["source"]["kind"] == "paint_coloring"
        assert job["source"]["color"] == "blue"
        assert job["source"]["color_group_id"] == "group-badge"

    def test_coloring_session_persists_on_page(self, client):
        page_id = _page(client)
        coloring = {
            "assignments": {"3_abc": ["black", None]},
            "order": ["red", "black", "blue", "green"],
        }
        r = client.put(f"/api/pages/{page_id}", json={"coloring": coloring})
        assert r.status_code == 200
        got = client.get(f"/api/pages/{page_id}").json()
        assert got["coloring"] == coloring
        # An unrelated save must not wipe the stored coloring.
        client.put(f"/api/pages/{page_id}", json={"name": "Neu"})
        assert client.get(f"/api/pages/{page_id}").json()["coloring"] == coloring

    def test_normal_gcode_route_is_unchanged(self, client):
        page_id = _page(client)
        client.put(f"/api/pages/{page_id}", json={"objects": [_line_object("o1", 10, 10, 50, 50)]})
        r = client.post(f"/api/pages/{page_id}/gcode")
        assert r.status_code == 200
        assert "color-" not in r.json()["filename"]
