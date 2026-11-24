import importlib
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.staticfiles import StaticFiles

from plotter.web.frontend import FrontendFiles


def client_for(files, directory):
    app = FastAPI()
    app.mount("/", files(directory=directory, html=True))
    return TestClient(app)


def index_at_epoch(directory, asset):
    directory.mkdir(exist_ok=True)
    path = directory / "index.html"
    path.write_text(f'<script src="/assets/{asset}.js"></script>')
    os.utime(path, (0, 0))


def test_reproduces_flatpak_etag_collision_with_old_static_handler(tmp_path):
    index_at_epoch(tmp_path, "old11111")
    client = client_for(StaticFiles, tmp_path)
    first = client.get("/")
    index_at_epoch(tmp_path, "new22222")
    assert client.get("/", headers={"If-None-Match": first.headers["etag"]}).status_code == 304


@pytest.mark.parametrize("route", ["/", "/index.html"])
def test_updated_flatpak_html_is_returned_despite_identical_size_and_mtime(tmp_path, route):
    index_at_epoch(tmp_path, "old11111")
    client = client_for(FrontendFiles, tmp_path)
    first = client.get(route)
    index_at_epoch(tmp_path, "new22222")
    second = client.get(route, headers={
        "If-None-Match": first.headers["etag"],
        "If-Modified-Since": first.headers["last-modified"],
    })
    assert second.status_code == 200
    assert "new22222.js" in second.text
    assert second.headers["cache-control"] == "no-store"


def test_content_hashed_assets_keep_conditional_caching(tmp_path):
    (tmp_path / "app-a1b2c3d4.js").write_text("console.log('current')")
    client = client_for(FrontendFiles, tmp_path)
    first = client.get("/app-a1b2c3d4.js")
    assert client.get(
        "/app-a1b2c3d4.js", headers={"If-None-Match": first.headers["etag"]}
    ).status_code == 304


@pytest.mark.parametrize("route", ["/", "/index.html", "/live", "/upload"])
def test_all_application_entry_points_prevent_html_cache(workspace, monkeypatch, route):
    module = importlib.import_module("plotter.web.app")
    static = workspace / "static"
    index_at_epoch(static, "current1")
    monkeypatch.setattr(module, "__file__", str(workspace / "app.py"))
    response = TestClient(module.create_app()).get(route)
    assert response.status_code == 200
    assert "current1.js" in response.text
    assert response.headers["cache-control"] == "no-store"
