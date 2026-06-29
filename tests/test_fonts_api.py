from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from plotter.web.app import create_app


@pytest.fixture
def client(workspace):
    return TestClient(create_app())


def _font_file() -> Path:
    return (
        Path(__file__).resolve().parents[1]
        / "plotter"
        / "fonts"
        / "ReliefSingleLineOTF-SVG-Regular.otf"
    )


def test_fonts_lists_builtin_fonts(client):
    r = client.get("/api/fonts")
    assert r.status_code == 200
    fonts = r.json()["fonts"]
    ids = {font["id"] for font in fonts}
    assert {"sans", "hand", "script", "block"}.issubset(ids)
    builtins = {"sans", "hand", "script", "block"}
    assert all(font["builtin"] for font in fonts if font["id"] in builtins)
    assert all(font["mode"] == "plotter" for font in fonts if font["id"] in builtins)


def test_upload_font_adds_custom_font(client):
    with _font_file().open("rb") as fh:
        r = client.post(
            "/api/fonts",
            data={"label": "My Font", "mode": "plotter"},
            files={"file": ("my-font.otf", fh, "font/otf")},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["font"]["label"] == "My Font"
    assert body["font"]["builtin"] is False
    assert body["font"]["mode"] == "plotter"
    assert body["font"]["id"] in {font["id"] for font in body["fonts"]}


def test_upload_font_accepts_normal_mode(client):
    with _font_file().open("rb") as fh:
        r = client.post(
            "/api/fonts",
            data={"label": "Normal Font", "mode": "normal"},
            files={"file": ("normal.otf", fh, "font/otf")},
        )
    assert r.status_code == 200
    assert r.json()["font"]["mode"] == "normal"


def test_upload_font_rejects_unknown_mode(client):
    with _font_file().open("rb") as fh:
        r = client.post(
            "/api/fonts",
            data={"label": "Bad Mode", "mode": "unknown"},
            files={"file": ("bad.otf", fh, "font/otf")},
        )
    assert r.status_code == 422


def test_uploaded_font_can_render_text(client):
    with _font_file().open("rb") as fh:
        font = client.post(
            "/api/fonts",
            data={"label": "Renderable"},
            files={"file": ("renderable.otf", fh, "font/otf")},
        ).json()["font"]

    r = client.post(
        "/api/paint/text-polylines",
        json={"text": "Hi", "font": font["id"], "size": 12},
    )
    assert r.status_code == 200
    assert r.json()["polylines"]


def test_plotter_mode_renders_differently_than_normal_mode(client):
    with _font_file().open("rb") as fh:
        plotter_font = client.post(
            "/api/fonts",
            data={"label": "Plotter", "mode": "plotter"},
            files={"file": ("plotter.otf", fh, "font/otf")},
        ).json()["font"]
    with _font_file().open("rb") as fh:
        normal_font = client.post(
            "/api/fonts",
            data={"label": "Normal", "mode": "normal"},
            files={"file": ("normal.otf", fh, "font/otf")},
        ).json()["font"]

    plotter = client.post(
        "/api/paint/text-polylines",
        json={"text": "O", "font": plotter_font["id"], "size": 12},
    ).json()["polylines"]
    normal = client.post(
        "/api/paint/text-polylines",
        json={"text": "O", "font": normal_font["id"], "size": 12},
    ).json()["polylines"]
    assert plotter
    assert normal
    assert plotter != normal


def test_plotter_mode_preserves_k_branches(client):
    with _font_file().open("rb") as fh:
        font = client.post(
            "/api/fonts",
            data={"label": "Plotter K", "mode": "plotter"},
            files={"file": ("plotter-k.otf", fh, "font/otf")},
        ).json()["font"]

    lines = client.post(
        "/api/paint/text-polylines",
        json={"text": "Kk", "font": font["id"], "size": 12},
    ).json()["polylines"]
    lengths = [
        sum(
            ((line[i][0] - line[i - 1][0]) ** 2 + (line[i][1] - line[i - 1][1]) ** 2) ** 0.5
            for i in range(1, len(line))
        )
        for line in lines
    ]
    assert len([length for length in lengths if length > 0.8]) >= 4


def test_plotter_mode_outputs_smoothed_centerlines(client):
    with _font_file().open("rb") as fh:
        font = client.post(
            "/api/fonts",
            data={"label": "Smooth", "mode": "plotter"},
            files={"file": ("smooth.otf", fh, "font/otf")},
        ).json()["font"]

    lines = client.post(
        "/api/paint/text-polylines",
        json={"text": "S", "font": font["id"], "size": 12},
    ).json()["polylines"]
    assert lines
    assert any(len(line) >= 4 for line in lines)
    assert any(
        abs(coord - round(coord)) > 0.001
        for line in lines
        for point in line
        for coord in point
    )


def test_delete_custom_font_removes_it(client):
    with _font_file().open("rb") as fh:
        created = client.post(
            "/api/fonts",
            data={"label": "Temp Font"},
            files={"file": ("temp.otf", fh, "font/otf")},
        ).json()["font"]

    r = client.delete(f"/api/fonts/{created['id']}")
    assert r.status_code == 200
    assert created["id"] not in {font["id"] for font in r.json()["fonts"]}


def test_delete_builtin_font_is_rejected(client):
    r = client.delete("/api/fonts/sans")
    assert r.status_code == 422
