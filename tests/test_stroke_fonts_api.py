from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from plotter.web.app import create_app


def _json_bytes(data: object) -> bytes:
    return json.dumps(data).encode("utf-8")


@pytest.fixture
def client(workspace):
    return TestClient(create_app())


def _create(client, label="My Handwriting") -> dict:
    r = client.post("/api/stroke-fonts", json={"label": label})
    assert r.status_code == 200, r.text
    return r.json()["strokeFont"]


def _glyph_a() -> dict:
    return {
        "key": "a",
        "type": "character",
        "variants": [
            {
                "weight": 1.0,
                "strokes": [
                    {
                        "rawPoints": [
                            {"x": 12.0, "y": 690.0, "t": 0, "pressure": 0.4, "pointerType": "pen"},
                            {"x": 18.5, "y": 672.0, "t": 8, "pressure": 0.47, "pointerType": "pen"},
                        ],
                        "points": [
                            {"x": 12.0, "y": 690.0, "t": 0, "speed": 0.0},
                            {"x": 18.5, "y": 672.0, "t": 8, "speed": 2.25},
                        ],
                        "processing": {"preset": "medium", "sigma": 1.8},
                    }
                ],
            }
        ],
    }


def test_create_stroke_font_returns_empty_document(client):
    doc = _create(client)
    assert doc["id"].startswith("stroke-")
    assert doc["label"] == "My Handwriting"
    assert doc["kind"] == "stroke"
    assert doc["schemaVersion"] == 1
    assert doc["glyphs"] == []
    assert doc["metrics"]["em"] == 1000


def test_create_requires_label(client):
    r = client.post("/api/stroke-fonts", json={"label": "   "})
    assert r.status_code == 422


def test_list_contains_created_font(client):
    doc = _create(client)
    r = client.get("/api/stroke-fonts")
    assert r.status_code == 200
    summaries = r.json()["strokeFonts"]
    assert doc["id"] in {s["id"] for s in summaries}
    summary = next(s for s in summaries if s["id"] == doc["id"])
    assert summary["glyphCount"] == 0


def test_get_unknown_font_is_404(client):
    assert client.get("/api/stroke-fonts/stroke-doesnotexist").status_code == 404


def test_get_rejects_malformed_id(client):
    # Path-traversal style id must not resolve to a file outside the store.
    assert client.get("/api/stroke-fonts/..%2F..%2Fetc").status_code == 404


def test_save_and_reload_round_trips_raw_and_processed(client):
    doc = _create(client)
    doc["glyphs"] = [_glyph_a()]
    r = client.put(f"/api/stroke-fonts/{doc['id']}", json=doc)
    assert r.status_code == 200, r.text
    saved = r.json()["strokeFont"]
    assert len(saved["glyphs"]) == 1

    reloaded = client.get(f"/api/stroke-fonts/{doc['id']}").json()["strokeFont"]
    stroke = reloaded["glyphs"][0]["variants"][0]["strokes"][0]
    assert len(stroke["rawPoints"]) == 2
    assert len(stroke["points"]) == 2
    assert stroke["rawPoints"][0]["pointerType"] == "pen"
    assert stroke["rawPoints"][0]["pressure"] == pytest.approx(0.4)
    assert stroke["points"][1]["speed"] == pytest.approx(2.25)
    assert stroke["processing"]["preset"] == "medium"


def test_save_preserves_created_at_and_bumps_updated_at(client):
    doc = _create(client)
    created_at = doc["createdAt"]
    doc["glyphs"] = [_glyph_a()]
    saved = client.put(f"/api/stroke-fonts/{doc['id']}", json=doc).json()["strokeFont"]
    assert saved["createdAt"] == created_at


def test_save_unknown_font_is_404(client):
    assert (
        client.put("/api/stroke-fonts/stroke-missing", json={"label": "x"}).status_code == 404
    )


def test_save_rejects_glyph_without_key(client):
    doc = _create(client)
    doc["glyphs"] = [{"variants": []}]
    assert client.put(f"/api/stroke-fonts/{doc['id']}", json=doc).status_code == 422


def test_save_rejects_too_many_points(client):
    doc = _create(client)
    huge = [{"x": float(i), "y": 0.0} for i in range(5000)]
    doc["glyphs"] = [
        {"key": "a", "variants": [{"strokes": [{"rawPoints": huge, "points": []}]}]}
    ]
    assert client.put(f"/api/stroke-fonts/{doc['id']}", json=doc).status_code == 413


def test_delete_removes_font(client):
    doc = _create(client)
    r = client.delete(f"/api/stroke-fonts/{doc['id']}")
    assert r.status_code == 200
    assert doc["id"] not in {s["id"] for s in r.json()["strokeFonts"]}
    assert client.get(f"/api/stroke-fonts/{doc['id']}").status_code == 404


def test_stroke_font_appears_in_fonts_list(client):
    doc = _create(client, label="Listed Hand")
    fonts = client.get("/api/fonts").json()["fonts"]
    entry = next((f for f in fonts if f["id"] == doc["id"]), None)
    assert entry is not None
    assert entry["kind"] == "stroke"
    assert entry["editable"] is True
    assert entry["builtin"] is False


def test_text_polylines_renders_stroke_font(client):
    doc = _create(client)
    doc["glyphs"] = [_glyph_a()]
    client.put(f"/api/stroke-fonts/{doc['id']}", json=doc)
    r = client.post(
        "/api/paint/text-polylines", json={"text": "a", "font": doc["id"], "size": 12}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["polylines"]
    assert body["missing"] == []
    assert body["feeds"]


def test_text_polylines_reports_missing_stroke_glyphs(client):
    doc = _create(client)
    doc["glyphs"] = [_glyph_a()]
    client.put(f"/api/stroke-fonts/{doc['id']}", json=doc)
    r = client.post(
        "/api/paint/text-polylines", json={"text": "abc", "font": doc["id"], "size": 12}
    )
    assert r.status_code == 200
    assert set(r.json()["missing"]) == {"b", "c"}


def test_text_polylines_classic_font_path_unchanged(client):
    r = client.post(
        "/api/paint/text-polylines", json={"text": "Hi", "font": "sans", "size": 12}
    )
    assert r.status_code == 200
    assert r.json()["polylines"]


def test_export_wraps_font_in_gcsfont_envelope(client):
    doc = _create(client, label="Export Me")
    doc["glyphs"] = [_glyph_a()]
    client.put(f"/api/stroke-fonts/{doc['id']}", json=doc)

    r = client.get(f"/api/stroke-fonts/{doc['id']}/export")
    assert r.status_code == 200, r.text
    assert 'filename="Export-Me.gcsfont"' in r.headers.get("content-disposition", "")
    body = r.json()
    assert body["format"] == "gcsfont"
    assert body["version"] == 1
    assert body["font"]["label"] == "Export Me"
    stroke = body["font"]["glyphs"][0]["variants"][0]["strokes"][0]
    # Raw + processed points (timing/pressure) are all in the backup.
    assert len(stroke["rawPoints"]) == 2
    assert len(stroke["points"]) == 2
    assert stroke["rawPoints"][0]["pressure"] == pytest.approx(0.4)


def test_export_import_round_trips_to_a_new_font(client):
    doc = _create(client, label="Round Trip")
    doc["glyphs"] = [_glyph_a()]
    client.put(f"/api/stroke-fonts/{doc['id']}", json=doc)
    payload = client.get(f"/api/stroke-fonts/{doc['id']}/export").json()

    files = {"file": ("backup.gcsfont", _json_bytes(payload), "application/json")}
    r = client.post("/api/stroke-fonts/import", files=files)
    assert r.status_code == 200, r.text
    imported = r.json()["strokeFont"]
    assert imported["id"] != doc["id"]  # fresh id, never overwrites
    assert imported["label"] == "Round Trip"
    stroke = imported["glyphs"][0]["variants"][0]["strokes"][0]
    assert stroke["rawPoints"][0]["pressure"] == pytest.approx(0.4)
    # Both fonts now exist and are listed.
    summaries = r.json()["strokeFonts"]
    ids = {s["id"] for s in summaries}
    assert {doc["id"], imported["id"]}.issubset(ids)


def test_imported_font_appears_in_fonts_list(client):
    doc = _create(client, label="Listed Import")
    payload = client.get(f"/api/stroke-fonts/{doc['id']}/export").json()
    imported = client.post(
        "/api/stroke-fonts/import",
        files={"file": ("b.gcsfont", _json_bytes(payload), "application/json")},
    ).json()["strokeFont"]
    fonts = client.get("/api/fonts").json()["fonts"]
    entry = next((f for f in fonts if f["id"] == imported["id"]), None)
    assert entry is not None
    assert entry["kind"] == "stroke"


def test_import_rejects_non_gcsfont_json(client):
    files = {"file": ("x.gcsfont", _json_bytes({"hello": "world"}), "application/json")}
    assert client.post("/api/stroke-fonts/import", files=files).status_code == 422


def test_import_rejects_invalid_json(client):
    files = {"file": ("x.gcsfont", b"not json{", "application/json")}
    assert client.post("/api/stroke-fonts/import", files=files).status_code == 422


def test_export_unknown_font_is_404(client):
    assert client.get("/api/stroke-fonts/stroke-missing/export").status_code == 404


def test_builtin_fonts_keep_kind_builtin(client):
    fonts = client.get("/api/fonts").json()["fonts"]
    builtins = {"sans", "hand", "script", "block"}
    for font in fonts:
        if font["id"] in builtins:
            assert font["kind"] == "builtin"
            assert font["editable"] is False
