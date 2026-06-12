from __future__ import annotations

import plotter.document as document
from plotter.document import DocumentStore
from plotter.state import FileStateStore


def _store(workspace) -> DocumentStore:
    return DocumentStore(FileStateStore(workspace / "state"))


class TestDocumentStore:
    def test_first_list_autocreates_a_page(self, workspace):
        idx = _store(workspace).list_pages()
        assert len(idx["order"]) == 1
        assert idx["activeId"] == idx["order"][0]["id"]

    def test_default_name_is_the_id(self, workspace):
        s = _store(workspace)
        page = s.create_page()
        assert page["name"] == page["id"]
        assert page["grid"] == document.DEFAULT_GRID

    def test_save_objects_and_grid(self, workspace):
        s = _store(workspace)
        page = s.create_page()
        s.save_page(page["id"], {"grid": {"step": 5, "snap": True},
                                 "objects": [{"id": "o1", "type": "line", "plotted": False}]})
        reloaded = s.get_page(page["id"])
        assert reloaded["grid"] == {"step": 5, "snap": True}
        assert len(reloaded["objects"]) == 1
        # metadata in the index reflects the object count
        meta = next(m for m in s.list_pages()["order"] if m["id"] == page["id"])
        assert meta["objectCount"] == 1

    def test_plotted_count_in_meta(self, workspace):
        s = _store(workspace)
        page = s.create_page()
        s.save_page(page["id"], {"objects": [
            {"id": "a", "plotted": True},
            {"id": "b", "plotted": False},
        ]})
        meta = next(m for m in s.list_pages()["order"] if m["id"] == page["id"])
        assert meta["plottedCount"] == 1

    def test_rename(self, workspace):
        s = _store(workspace)
        page = s.create_page()
        s.rename_page(page["id"], "Plakat")
        assert s.get_page(page["id"])["name"] == "Plakat"

    def test_duplicate_copies_objects(self, workspace):
        s = _store(workspace)
        page = s.create_page("Original")
        s.save_page(page["id"], {"objects": [{"id": "o1", "type": "rect"}]})
        copy = s.duplicate_page(page["id"])
        assert copy["id"] != page["id"]
        assert "Kopie" in copy["name"]
        assert len(copy["objects"]) == 1

    def test_delete_and_active_fallback(self, workspace):
        s = _store(workspace)
        first = s.list_pages()["order"][0]["id"]
        second = s.create_page()["id"]
        idx = s.delete_page(second)
        assert all(m["id"] != second for m in idx["order"])
        assert idx["activeId"] == first

    def test_deleting_last_page_recreates_one(self, workspace):
        s = _store(workspace)
        only = s.list_pages()["order"][0]["id"]
        idx = s.delete_page(only)
        assert len(idx["order"]) == 1
        assert idx["order"][0]["id"] != only

    def test_set_active(self, workspace):
        s = _store(workspace)
        a = s.list_pages()["order"][0]["id"]
        b = s.create_page()["id"]
        s.set_active(a)
        assert s.list_pages()["activeId"] == a
        s.set_active("nonexistent")  # ignored
        assert s.list_pages()["activeId"] == a
        assert b  # silences lint


class TestPagesApi:
    def test_crud_roundtrip(self, workspace):
        from unittest.mock import patch

        from fastapi.testclient import TestClient

        document._doc = None  # reset singleton for the isolated workspace
        with patch.object(document, "create_store",
                          return_value=FileStateStore(workspace / "state")):
            from plotter.web.app import app
            c = TestClient(app)
            idx = c.get("/api/pages").json()
            assert len(idx["order"]) == 1
            pid = idx["activeId"]
            assert c.put(f"/api/pages/{pid}", json={"name": "A"}).json()["name"] == "A"
            assert c.post("/api/pages", json={}).status_code == 200
            assert len(c.get("/api/pages").json()["order"]) == 2
            assert c.get("/api/pages/nonexistent").status_code == 404
        document._doc = None

    def test_score_and_preview3d_are_transient(self, cal, workspace):
        from unittest.mock import patch

        from fastapi.testclient import TestClient

        line = {
            "id": "l1",
            "type": "line",
            "plotted": False,
            "transform": {"x": 20, "y": 20, "rotation": 0, "scale": 1},
            "cachedPolylines": [[[0, 0], [100, 0], [100, 80]]],
        }
        document._doc = None
        with patch.object(document, "create_store",
                          return_value=FileStateStore(workspace / "state")):
            from plotter.web.app import app
            c = TestClient(app)
            pid = c.get("/api/pages").json()["activeId"]

            # empty page: no score, but a reason instead of an error
            empty = c.post(f"/api/pages/{pid}/score", json={}).json()
            assert empty["score"] is None and empty["reason"]

            # live objects override the (empty) persisted page
            rated = c.post(f"/api/pages/{pid}/score", json={"objects": [line]}).json()
            assert rated["reason"] is None
            assert 0 <= rated["score"]["total"] <= 100
            assert rated["metrics"]["draw_mm"] > 0

            preview = c.post(f"/api/pages/{pid}/preview3d", json={"objects": [line]}).json()
            assert preview["draws"] and preview["bounds"]
            assert c.post(f"/api/pages/{pid}/preview3d", json={}).status_code == 400

            # neither endpoint persisted a job file
            assert c.get("/api/jobs").json() == []
        document._doc = None
