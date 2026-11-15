from __future__ import annotations

import pytest

import plotter.core.document as document
from plotter.core.document import DocumentStore
from plotter.core.state import FileStateStore


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
        s.save_page(
            page["id"],
            {
                "grid": {"step": 5, "snap": True},
                "objects": [{"id": "o1", "type": "line", "plotted": False}],
            },
        )
        reloaded = s.get_page(page["id"])
        assert reloaded["grid"] == {"step": 5, "snap": True}
        assert len(reloaded["objects"]) == 1
        # metadata in the index reflects the object count
        meta = next(m for m in s.list_pages()["order"] if m["id"] == page["id"])
        assert meta["objectCount"] == 1

    def test_plotted_count_in_meta(self, workspace):
        s = _store(workspace)
        page = s.create_page()
        s.save_page(
            page["id"],
            {
                "objects": [
                    {"id": "a", "plotted": True},
                    {"id": "b", "plotted": False},
                ]
            },
        )
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

    def test_meta_carries_group_id(self, workspace):
        s = _store(workspace)
        page = s.create_page()
        meta = next(m for m in s.list_pages()["order"] if m["id"] == page["id"])
        assert meta["groupId"] is None

    def test_create_and_assign_group(self, workspace):
        s = _store(workspace)
        page = s.create_page()
        idx = s.create_group("Poster")
        gid = idx["groups"][0]["id"]
        assert idx["groups"][0]["name"] == "Poster"
        s.set_page_group(page["id"], gid)
        meta = next(m for m in s.list_pages()["order"] if m["id"] == page["id"])
        assert meta["groupId"] == gid
        assert s.get_page(page["id"])["groupId"] == gid

    def test_rename_group(self, workspace):
        s = _store(workspace)
        gid = s.create_group("A")["groups"][0]["id"]
        idx = s.rename_group(gid, "B")
        assert idx["groups"][0]["name"] == "B"

    def test_set_page_group_none_clears_it(self, workspace):
        s = _store(workspace)
        page = s.create_page()
        gid = s.create_group("Poster")["groups"][0]["id"]
        s.set_page_group(page["id"], gid)
        s.set_page_group(page["id"], None)
        meta = next(m for m in s.list_pages()["order"] if m["id"] == page["id"])
        assert meta["groupId"] is None
        assert "groupId" not in s.get_page(page["id"])

    def test_delete_group_ungroups_pages(self, workspace):
        s = _store(workspace)
        page = s.create_page()
        gid = s.create_group("Poster")["groups"][0]["id"]
        s.set_page_group(page["id"], gid)
        idx = s.delete_group(gid)
        assert idx["groups"] == []
        meta = next(m for m in idx["order"] if m["id"] == page["id"])
        assert meta["groupId"] is None
        assert "groupId" not in s.get_page(page["id"])


class TestPagesApi:
    def test_crud_roundtrip(self, workspace):
        from unittest.mock import patch

        from fastapi.testclient import TestClient

        document._doc = None  # reset singleton for the isolated workspace
        with patch.object(
            document, "create_store", return_value=FileStateStore(workspace / "state")
        ):
            from plotter.web.app import app

            c = TestClient(app)
            idx = c.get("/api/pages").json()
            assert len(idx["order"]) == 1
            pid = idx["activeId"]
            assert c.put(f"/api/pages/{pid}", json={"name": "A"}).json()["name"] == "A"
            assert c.post("/api/pages", json={}).status_code == 200
            assert len(c.get("/api/pages").json()["order"]) == 2
            assert c.get("/api/pages/nonexistent").status_code == 404

            # manual folders: create, assign, then delete un-groups the page
            gidx = c.post("/api/pages/groups", json={"name": "Poster"}).json()
            gid = gidx["groups"][0]["id"]
            assigned = c.post(f"/api/pages/{pid}/group", json={"groupId": gid}).json()
            meta = next(m for m in assigned["order"] if m["id"] == pid)
            assert meta["groupId"] == gid
            deleted = c.delete(f"/api/pages/groups/{gid}").json()
            assert deleted["groups"] == []
            meta = next(m for m in deleted["order"] if m["id"] == pid)
            assert meta["groupId"] is None
            assert c.post("/api/pages/nonexistent/group", json={"groupId": None}).status_code == 404
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
        with patch.object(
            document, "create_store", return_value=FileStateStore(workspace / "state")
        ):
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
            assert preview["bed"] == [cal.bed_width, cal.bed_height]
            assert c.post(f"/api/pages/{pid}/preview3d", json={}).status_code == 400

            # neither endpoint persisted a job file
            assert c.get("/api/jobs").json() == []
        document._doc = None


@pytest.mark.parametrize("operation", ["save", "profile", "duplicate", "group", "patch", "import"])
def test_late_writes_do_not_resurrect_deleted_pages(workspace, operation):
    state = FileStateStore(workspace / "state")
    store = DocumentStore(state)
    page_id = store.create_page()["id"]
    store.delete_page(page_id)
    assert store.get_page(page_id) is None
    actions = {
        "save": lambda: store.save_page(page_id, {"name": "Late update"}),
        "profile": lambda: store.set_page_profile(page_id, {"id": "gone"}),
        "duplicate": lambda: store.duplicate_page(page_id),
        "group": lambda: store.set_page_group(page_id, None),
        "patch": lambda: store.patch_objects(
            page_id, revision=0, mutation_id="late", changes=[], removed=[]
        ),
        "import": lambda: store.append_import(page_id, None, None, "late", {"id": "object"}),
    }
    if operation == "import":
        assert actions[operation]() is False
    else:
        with pytest.raises(KeyError):
            actions[operation]()
    assert store.get_page(page_id) is None
    assert state.get(f"paint_page_{page_id}") == {}
    assert all(meta["id"] != page_id for meta in store.list_pages()["order"])
