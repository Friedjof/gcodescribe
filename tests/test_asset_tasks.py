from __future__ import annotations

import json
import subprocess
import time

import pytest
from fastapi.testclient import TestClient

from plotter.core.document import DocumentStore, RevisionConflict
from plotter.core.state import FileStateStore
from plotter.services.asset_tasks import AssetTasks
from plotter.services.gallery import GalleryService
from plotter.services.profiles import ProfileService

SVG = (
    b'<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" '
    b'viewBox="0 0 100 50"><path d="M 10 10 L 90 10 L 50 40 Z" '
    b'fill="none" stroke="black"/></svg>'
)


@pytest.fixture
def tasks(workspace):
    documents = DocumentStore(FileStateStore(workspace / "state"))
    service = AssetTasks(workspace / "tasks", GalleryService(workspace / "gallery"), documents)
    yield service
    service.close()


def wait_done(tasks, task_id, timeout=20):
    until = time.monotonic() + timeout
    while time.monotonic() < until:
        task = tasks.get(task_id)
        if task["state"] in {"done", "failed", "cancelled", "interrupted"}:
            return task
        time.sleep(0.025)
    raise AssertionError(tasks.get(task_id))


def test_patch_revision_and_idempotency_preserve_geometry(tasks):
    docs = tasks.documents
    p = docs.create_page()
    obj = {"id": "a", "cachedPolylines": [[[1, 2], [3, 4]]], "transform": {"x": 0}}
    p = docs.save_page(p["id"], {"objects": [obj]})
    patch = {
        "revision": p["revision"],
        "mutation_id": "drag",
        "changes": [{"id": "a", "transform": {"x": 10}}],
        "removed": [],
    }
    result = docs.patch_objects(p["id"], **patch)
    assert docs.patch_objects(p["id"], **patch) == result
    assert docs.get_page(p["id"])["objects"] == [{**obj, "transform": {"x": 10}}]
    with pytest.raises(RevisionConflict):
        docs.patch_objects(p["id"], **{**patch, "mutation_id": "stale"})


def test_import_appends_to_original_page_once_without_activation(tasks):
    docs = tasks.documents
    p = docs.create_page("Original")
    snapshot = p["profileSnapshot"]
    profile = ProfileService().update(p["profileId"], calibration={"draw_feed": 17})
    assert snapshot["fingerprint"] != profile["fingerprint"]
    target = {
        "page_id": p["id"],
        "project_id": p["projectId"],
        "profile_id": profile["id"],
        "fingerprint": profile["fingerprint"],
        "width": 200,
        "height": 200,
        "x": 42,
        "y": 55,
    }
    task = tasks.submit(
        {
            "kind": "import",
            "filename": "drawing.svg",
            "mode": "vector",
            "detail": 2,
            "target": target,
        },
        SVG,
    )
    docs.save_page(p["id"], {"objects": [{"id": "edited-during-import", "type": "line"}]})
    other = docs.create_page("Other")
    result = wait_done(tasks, task["id"])
    assert result["state"] == "done", result
    assert result["attached"] is True
    assert docs.list_pages()["activeId"] == other["id"]
    objects = docs.get_page(p["id"])["objects"]
    assert [obj["id"] for obj in objects] == ["edited-during-import", task["id"]]
    assert objects[1]["transform"]["x"] == 82  # captured anchor + half the 80 mm image
    assert docs.append_import(p["id"], profile["id"], profile["fingerprint"], task["id"],
                              objects[1], project_id=p["projectId"])
    assert len(docs.get_page(p["id"])["objects"]) == 2
    assert docs.get_page(p["id"])["profileSnapshot"] == snapshot
    assert tasks.gallery.preview(result["item_id"])["polylines"]


def test_changed_or_missing_target_does_not_rebind(tasks):
    docs = tasks.documents
    p = docs.create_page()
    profile = ProfileService().get(p["profileId"])
    ProfileService().update(profile["id"], calibration={"origin_x": 15})
    assert not docs.append_import(p["id"], profile["id"], profile["fingerprint"],
                                  "job", {"id": "job"}, project_id=p["projectId"])
    docs.delete_page(p["id"])
    assert not docs.append_import(p["id"], profile["id"], profile["fingerprint"],
                                  "job", {"id": "job"}, project_id=p["projectId"])


def test_project_profile_changed_during_import_keeps_asset_without_attaching(tasks, monkeypatch):
    docs = tasks.documents
    page = docs.create_page("Ziel")
    profile = ProfileService().get(page["profileId"])
    start = tasks.start
    monkeypatch.setattr(tasks, "start", lambda: None)
    task = tasks.submit({
        "kind": "import", "filename": "drawing.svg", "mode": "vector", "detail": 2,
        "target": {"page_id": page["id"], "project_id": page["projectId"],
                   "profile_id": profile["id"], "fingerprint": profile["fingerprint"],
                   "width": 200, "height": 200, "x": 10, "y": 10},
    }, SVG)
    ProfileService().update(profile["id"], calibration={"origin_x": 15})
    monkeypatch.setattr(tasks, "start", start)
    tasks.start()
    tasks.wake.set()
    result = wait_done(tasks, task["id"])
    assert result["state"] == "done", result
    assert result["attached"] is False
    assert docs.get_page(page["id"])["objects"] == []
    assert docs.get_page(page["id"])["profileSnapshot"] == page["profileSnapshot"]
    assert tasks.gallery.preview(result["item_id"])["polylines"]


@pytest.mark.parametrize("change", ["moved", "archived"])
def test_import_target_project_must_still_match(tasks, change):
    docs = tasks.documents
    page = docs.create_page("Ziel")
    profile = ProfileService().get(page["profileId"])
    if change == "moved":
        target = docs.create_project("Anderes Projekt")["project"]
        docs.move_page_to_project(page["id"], target["id"])
    else:
        docs.create_project("Anderes Projekt")
        docs.update_project(page["projectId"], archived=True)
    assert not docs.append_import(page["id"], profile["id"], profile["fingerprint"],
                                  "job", {"id": "job"}, project_id=page["projectId"])
    assert docs.get_page(page["id"])["objects"] == []


def test_rerender_keeps_old_preview_and_changes_generation(tasks):
    item = tasks.gallery.create("drawing.svg", SVG, uploader="admin")
    old = tasks.gallery.preview(item["id"])
    task = tasks.submit(
        {
            "kind": "render",
            "item_id": item["id"],
            "filename": item["filename"],
            "mode": "vector",
            "detail": 3,
            "expected_revision": item["created"],
        }
    )
    assert tasks.gallery.preview(item["id"]) == old
    result = wait_done(tasks, task["id"])
    assert result["state"] == "done", result
    new = tasks.gallery.get(item["id"])
    assert new["render_revision"] == task["id"]
    assert new["pages"][0]["file"].startswith("generations/")
    assert tasks.gallery.preview(item["id"]) == old
    assert tasks.gallery.original_path(item["id"])[0].read_bytes() == SVG
    assert tasks.gallery.thumbnail(item["id"])["polylines"]


def test_svg_handwriting_render_keeps_mode_after_publication(tasks):
    item = tasks.gallery.create("drawing.svg", SVG, uploader="admin")
    task = tasks.submit(
        {
            "kind": "render",
            "item_id": item["id"],
            "filename": item["filename"],
            "mode": "handwriting",
            "detail": 2,
            "expected_revision": item["created"],
        }
    )
    result = wait_done(tasks, task["id"])
    assert result["state"] == "done", result
    updated = tasks.gallery.get(item["id"])
    assert updated["mode"] == "handwriting"
    assert updated["pages"][0]["lines"] > 0
    assert tasks.gallery.preview(item["id"])["polylines"]


def test_failed_conversion_can_retry_without_partial_publication(tasks):
    task = tasks.submit(
        {"kind": "import", "filename": "broken.svg", "mode": "vector", "detail": 2}, b"not an svg"
    )
    assert wait_done(tasks, task["id"])["state"] == "failed"
    assert tasks.gallery.list() == []
    (tasks.root / task["id"] / "source").write_bytes(SVG)
    tasks.retry(task["id"])
    assert wait_done(tasks, task["id"])["state"] == "done"
    assert len(tasks.gallery.list()) == 1


def test_restart_marks_work_retryable_and_queued_cancel_never_publishes(tasks, monkeypatch):
    monkeypatch.setattr(tasks, "start", lambda: None)
    task = tasks.submit(
        {"kind": "import", "filename": "drawing.svg", "mode": "vector", "detail": 2}, SVG
    )
    restarted = AssetTasks(tasks.root, tasks.gallery, tasks.documents)
    assert restarted.get(task["id"])["state"] == "interrupted"
    restarted.retry(task["id"])
    assert wait_done(restarted, task["id"])["state"] == "done"
    restarted.close()
    second = tasks.submit(
        {"kind": "import", "filename": "drawing.svg", "mode": "vector", "detail": 2}, SVG
    )
    assert tasks.cancel(second["id"])["state"] == "cancelled"
    assert len(tasks.gallery.list()) == 1


def test_running_cancel_terminates_process_and_queue_is_serial(tasks, monkeypatch):
    real_popen = subprocess.Popen
    processes = []

    def slow_worker(*args, **kwargs):
        process = real_popen(["/bin/sleep", "30"], start_new_session=True)
        processes.append(process)
        return process

    monkeypatch.setattr("plotter.services.asset_tasks.subprocess.Popen", slow_worker)
    first = tasks.submit(
        {"kind": "import", "filename": "a.svg", "mode": "vector", "detail": 2}, SVG
    )
    second = tasks.submit(
        {"kind": "import", "filename": "b.svg", "mode": "vector", "detail": 2}, SVG
    )
    until = time.monotonic() + 3
    while not processes and time.monotonic() < until:
        time.sleep(0.01)
    assert len(processes) == 1
    assert tasks.get(second["id"])["state"] == "queued"
    tasks.cancel(second["id"])
    tasks.cancel(first["id"])
    assert processes[0].poll() is not None
    assert tasks.gallery.list() == []


def test_task_routes_require_auth_and_validate_target(tasks, monkeypatch):
    from plotter.web.app import create_app

    monkeypatch.setattr("plotter.web.routes.asset_tasks.asset_tasks", lambda: tasks)
    client = TestClient(create_app())
    response = client.post(
        "/api/asset-tasks/import",
        files={"file": ("drawing.svg", SVG)},
        data={
            "target": json.dumps(
                {"page_id": "missing", "x": 1, "y": 1, "width": 200, "height": 200}
            )
        },
    )
    assert response.status_code == 404
    monkeypatch.delenv("PLOTTER_AUTH_TEST_BYPASS")
    monkeypatch.setenv("PLOTTER_AUTH_TEST_BYPASS", "false")
    assert client.get("/api/asset-tasks").status_code in (401, 403)


@pytest.mark.parametrize("explicit_profile", [False, True])
def test_import_route_resolves_current_project_instead_of_historical_slide(tasks, monkeypatch,
                                                                         explicit_profile):
    from plotter.web.app import create_app

    monkeypatch.setattr("plotter.web.routes.asset_tasks.asset_tasks", lambda: tasks)
    monkeypatch.setattr(tasks, "start", lambda: None)
    page = tasks.documents.create_page("Ziel")
    profile = ProfileService().update(page["profileId"], calibration={"draw_feed": 17})
    target = {"page_id": page["id"], "project_id": page["projectId"],
              "x": 10, "y": 10, "width": 200, "height": 200}
    if explicit_profile:
        target.update(profile_id=profile["id"], fingerprint=profile["fingerprint"])
    client = TestClient(create_app())
    response = client.post("/api/asset-tasks/import", files={"file": ("drawing.svg", SVG)},
                           data={"target": json.dumps(target)})
    assert response.status_code == 202, response.text
    captured = response.json()["target"]
    assert captured["project_id"] == page["projectId"]
    assert captured["profile_id"] == profile["id"]
    assert captured["fingerprint"] == profile["fingerprint"]
    assert captured["fingerprint"] != page["profileSnapshot"]["fingerprint"]


def test_import_route_rejects_already_changed_project_context(tasks, monkeypatch):
    from plotter.web.app import create_app

    monkeypatch.setattr("plotter.web.routes.asset_tasks.asset_tasks", lambda: tasks)
    page = tasks.documents.create_page("Ziel")
    profile = ProfileService().get(page["profileId"])
    ProfileService().update(profile["id"], calibration={"origin_x": 15})
    client = TestClient(create_app())
    response = client.post("/api/asset-tasks/import", files={"file": ("drawing.svg", SVG)}, data={
        "target": json.dumps({"page_id": page["id"], "project_id": page["projectId"],
                              "profile_id": profile["id"], "fingerprint": profile["fingerprint"],
                              "x": 10, "y": 10, "width": 200, "height": 200}),
    })
    assert response.status_code == 409, response.text
    assert tasks.list() == []


def test_health_and_page_api_remain_available_during_conversion(tasks, monkeypatch):
    from plotter.web.app import create_app

    monkeypatch.setattr("plotter.web.routes.asset_tasks.asset_tasks", lambda: tasks)
    client = TestClient(create_app())
    # A real converter child parses a substantial SVG, while the API remains responsive.
    drawing = (
        b'<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm">'
        + b'<path stroke="black" fill="none" d="M 1 1 L 99 99 L 1 99"/>' * 15000
        + b"</svg>"
    )
    response = client.post("/api/asset-tasks/import", files={"file": ("large.svg", drawing)})
    assert response.status_code == 202
    durations = []
    for _ in range(10):
        start = time.monotonic()
        assert client.get("/api/health").json()["ok"]
        assert client.get("/api/pages").status_code == 200
        durations.append(time.monotonic() - start)
    tasks.cancel(response.json()["id"])
    assert max(durations) < 1  # generous CI bound; typical local latency is milliseconds


def test_submission_token_is_idempotent_even_after_completion(tasks):
    request = {
        "id": "a" * 32,
        "kind": "import",
        "filename": "drawing.svg",
        "mode": "vector",
        "detail": 2,
    }
    first = tasks.submit(request, SVG)
    assert tasks.submit(request, SVG)["id"] == first["id"]
    assert wait_done(tasks, first["id"])["state"] == "done"
    assert tasks.submit(request, SVG)["state"] == "done"
    assert len(tasks.gallery.list()) == 1


def test_repeated_renders_do_not_copy_previous_generations_recursively(tasks):
    item = tasks.gallery.create("drawing.svg", SVG, uploader="admin")
    for detail in (1, 2, 3):
        task = tasks.submit(
            {
                "kind": "render",
                "item_id": item["id"],
                "filename": item["filename"],
                "mode": "vector",
                "detail": detail,
                "expected_revision": item.get("render_revision", item["created"]),
            }
        )
        assert wait_done(tasks, task["id"])["state"] == "done"
        item = tasks.gallery.get(item["id"])
        generation = tasks.gallery.root / item["id"] / item["derived_dir"]
        assert not (generation / "generations").exists()
    assert len(list((tasks.gallery.root / item["id"] / "generations").iterdir())) == 2
