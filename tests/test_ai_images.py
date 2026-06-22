from __future__ import annotations

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from plotter.ai_images.config import load_config
from plotter.ai_images.errors import AiImageError
from plotter.ai_images.prompts import STYLE_PROMPT, compose_prompt
from plotter.ai_images.service import AiImageService
from plotter.services.gallery import GalleryService
from plotter.web.app import create_app


def _png_bytes(w=320, h=240) -> bytes:
    img = np.full((h, w), 255, np.uint8)
    cv2.rectangle(img, (40, 40), (260, 200), 0, 6)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return buf.tobytes()


# -- config / gating ----------------------------------------------------------


def test_status_disabled_without_key_or_fake(workspace, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("AI_IMAGE_FAKE", raising=False)
    assert load_config().status() == {"enabled": False}


def test_status_enabled_with_fake(workspace, monkeypatch):
    monkeypatch.setenv("AI_IMAGE_FAKE", "true")
    status = load_config().status()
    assert status["enabled"] is True
    assert status["model"]
    assert "OPENAI_API_KEY" not in status and "api_key" not in status


def test_status_enabled_with_real_key(workspace, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.delenv("AI_IMAGE_FAKE", raising=False)
    assert load_config().status()["enabled"] is True


# -- prompt -------------------------------------------------------------------


def test_compose_prompt_keeps_style_and_appends():
    out = compose_prompt("more contour", "less detail")
    assert STYLE_PROMPT in out
    assert "more contour" in out
    assert "less detail" in out


def test_compose_prompt_rejects_overlong_instructions():
    with pytest.raises(AiImageError):
        compose_prompt("x" * 5000)


# -- service end-to-end (fake) ------------------------------------------------


def test_generate_persists_gallery_item_with_ai_meta(workspace, monkeypatch):
    monkeypatch.setenv("AI_IMAGE_FAKE", "true")
    result = AiImageService(load_config()).generate(
        filename="photo.png", data=_png_bytes(), mime="image/png", title="My fox"
    )

    assert result["variantId"]
    assert result["imageUrl"].startswith("/api/gallery/")
    assert result["preview"]["polylines"]  # fake motif traced to real lines
    assert result["quality"]["lineCount"] >= 1

    item = result["galleryItem"]
    stored = GalleryService().get(item["id"])
    assert stored["uploader"] == "admin"
    assert stored["ai"]["provider"] == "fake"
    assert stored["ai"]["variantId"] == result["variantId"]
    assert stored["ai"]["renderMode"] == "edges"


def test_generate_rejects_non_image(workspace, monkeypatch):
    monkeypatch.setenv("AI_IMAGE_FAKE", "true")
    with pytest.raises(AiImageError) as exc:
        AiImageService(load_config()).generate(
            filename="note.svg", data=b"<svg></svg>", mime="image/svg+xml"
        )
    assert exc.value.category == "unsupported_file"


def test_generate_disabled_raises(workspace, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("AI_IMAGE_FAKE", raising=False)
    with pytest.raises(AiImageError) as exc:
        AiImageService(load_config()).generate(filename="p.png", data=_png_bytes())
    assert exc.value.category == "not_configured"


# -- routes -------------------------------------------------------------------


def test_route_status_and_generate(workspace, monkeypatch):
    monkeypatch.setenv("AI_IMAGE_FAKE", "true")
    client = TestClient(create_app())

    status = client.get("/api/ai-images/status")
    assert status.status_code == 200
    assert status.json()["enabled"] is True

    resp = client.post(
        "/api/ai-images/generate",
        files={"file": ("photo.png", _png_bytes(), "image/png")},
        data={"instructions": "simple", "render_mode": "edges", "detail": "2"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["galleryItem"]["uploader"] == "admin"
    assert body["quality"]["complexity"] in ("good", "medium", "bad")


def test_route_status_disabled(workspace, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("AI_IMAGE_FAKE", raising=False)
    client = TestClient(create_app())
    assert client.get("/api/ai-images/status").json() == {"enabled": False}
