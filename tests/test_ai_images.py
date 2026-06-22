from __future__ import annotations

import base64
import types

import cv2
import httpx
import numpy as np
import openai
import pytest
from fastapi.testclient import TestClient

from plotter.ai_images import client as ai_client
from plotter.ai_images.client import OpenAiImageApiClient
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


def _stub_sdk(edit):
    """A minimal stand-in for the OpenAI SDK client exposing images.edit."""
    return types.SimpleNamespace(images=types.SimpleNamespace(edit=edit))


def _ok_edit(**_kwargs):
    b64 = base64.b64encode(_png_bytes()).decode()
    return types.SimpleNamespace(
        id="img_resp_1", data=[types.SimpleNamespace(b64_json=b64)]
    )


def _status_error(cls, code: int, message: str):
    req = httpx.Request("POST", "https://api.openai.com/v1/images/edits")
    return cls(message, response=httpx.Response(code, request=req), body=None)


# -- quality heuristic --------------------------------------------------------


def test_quality_empty_is_bad():
    from plotter.ai_images.quality import assess

    q = assess({"polylines": [], "width": 100, "height": 100})
    assert q["complexity"] == "bad"
    assert q["lineCount"] == 0
    assert q["warnings"] and q["feedbackSuggestions"]


def test_quality_long_clean_lines_are_good():
    from plotter.ai_images.quality import assess

    preview = {"polylines": [[[0, 0], [50, 0]], [[0, 10], [50, 10]]], "width": 100, "height": 100}
    q = assess(preview)
    assert q["complexity"] == "good"
    assert q["warnings"] == []
    assert q["medianLineLength"] >= 5


def test_quality_many_short_lines_warns_and_is_bad():
    from plotter.ai_images.quality import assess

    preview = {"polylines": [[[0, 0], [1, 0]] for _ in range(30)], "width": 100, "height": 100}
    q = assess(preview)
    assert q["complexity"] == "bad"
    assert q["shortLineCount"] == 30
    assert any("kurze" in w for w in q["warnings"])


def test_quality_small_motif_warns_via_bounds():
    from plotter.ai_images.quality import assess

    preview = {
        "polylines": [[[0, 0], [5, 0]]],
        "bounds": [0, 0, 5, 1],
        "width": 100,
        "height": 100,
    }
    q = assess(preview)
    assert q["boundsFillRatio"] is not None and q["boundsFillRatio"] < 0.15
    assert any("Fläche" in w for w in q["warnings"])


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


def test_generate_includes_feedback_suggestions(workspace, monkeypatch):
    monkeypatch.setenv("AI_IMAGE_FAKE", "true")
    result = AiImageService(load_config()).generate(
        filename="photo.png", data=_png_bytes(), mime="image/png"
    )
    assert "feedbackSuggestions" in result["quality"]
    assert isinstance(result["quality"]["feedbackSuggestions"], list)


def test_feedback_variant_chains_to_parent_without_reupload(workspace, monkeypatch):
    monkeypatch.setenv("AI_IMAGE_FAKE", "true")
    service = AiImageService(load_config())
    v1 = service.generate(filename="photo.png", data=_png_bytes(), mime="image/png")

    # No file this time: the feedback request iterates on the parent variant.
    v2 = service.generate(
        feedback="less detail", base_variant_id=v1["variantId"]
    )
    assert v2["parentVariantId"] == v1["variantId"]
    assert v2["variantId"] != v1["variantId"]
    stored = GalleryService().get(v2["galleryItem"]["id"])
    assert stored["ai"]["feedback"] == "less detail"
    assert stored["ai"]["parentVariantId"] == v1["variantId"]


def test_feedback_unknown_parent_raises(workspace, monkeypatch):
    monkeypatch.setenv("AI_IMAGE_FAKE", "true")
    with pytest.raises(AiImageError) as exc:
        AiImageService(load_config()).generate(
            feedback="more contour", base_variant_id="doesnotexist"
        )
    assert exc.value.category == "bad_response"


def test_generate_without_image_or_parent_raises(workspace, monkeypatch):
    monkeypatch.setenv("AI_IMAGE_FAKE", "true")
    with pytest.raises(AiImageError) as exc:
        AiImageService(load_config()).generate(feedback="hi")
    assert exc.value.category == "unsupported_file"


def test_rerender_variant_changes_mode_keeps_identity(workspace, monkeypatch):
    monkeypatch.setenv("AI_IMAGE_FAKE", "true")
    service = AiImageService(load_config())
    v1 = service.generate(filename="photo.png", data=_png_bytes(), mime="image/png")

    updated = service.rerender_variant(
        v1["galleryItem"]["id"], render_mode="handwriting", detail=3
    )
    assert updated["variantId"] == v1["variantId"]
    assert updated["galleryItem"]["mode"] == "handwriting"
    assert updated["galleryItem"]["detail"] == 3
    assert "complexity" in updated["quality"]


def test_route_rerender(workspace, monkeypatch):
    monkeypatch.setenv("AI_IMAGE_FAKE", "true")
    client = TestClient(create_app())
    gen = client.post(
        "/api/ai-images/generate",
        files={"file": ("photo.png", _png_bytes(), "image/png")},
        data={"render_mode": "edges"},
    )
    item_id = gen.json()["galleryItem"]["id"]
    resp = client.post(
        f"/api/ai-images/{item_id}/rerender",
        json={"render_mode": "trace", "detail": 2},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["galleryItem"]["mode"] == "trace"


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


def test_route_feedback_without_file(workspace, monkeypatch):
    monkeypatch.setenv("AI_IMAGE_FAKE", "true")
    client = TestClient(create_app())
    first = client.post(
        "/api/ai-images/generate",
        files={"file": ("photo.png", _png_bytes(), "image/png")},
        data={"render_mode": "edges"},
    )
    assert first.status_code == 200, first.text
    variant_id = first.json()["variantId"]

    second = client.post(
        "/api/ai-images/generate",
        data={"feedback": "fewer lines", "base_variant_id": variant_id},
    )
    assert second.status_code == 200, second.text
    assert second.json()["parentVariantId"] == variant_id


def test_route_generate_requires_image_or_parent(workspace, monkeypatch):
    monkeypatch.setenv("AI_IMAGE_FAKE", "true")
    client = TestClient(create_app())
    resp = client.post("/api/ai-images/generate", data={"feedback": "hi"})
    assert resp.status_code == 400


def test_route_status_disabled(workspace, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("AI_IMAGE_FAKE", raising=False)
    client = TestClient(create_app())
    assert client.get("/api/ai-images/status").json() == {"enabled": False}


# -- real OpenAI client (mocked SDK) ------------------------------------------


def _real_config(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.delenv("AI_IMAGE_FAKE", raising=False)
    return load_config()


def test_make_client_picks_openai_with_real_key(workspace, monkeypatch):
    cfg = _real_config(monkeypatch)
    assert isinstance(ai_client.make_client(cfg), OpenAiImageApiClient)


def test_openai_client_decodes_b64(workspace, monkeypatch):
    cfg = _real_config(monkeypatch)
    client = OpenAiImageApiClient(cfg)
    monkeypatch.setattr(client, "_client", lambda: _stub_sdk(_ok_edit))

    out = client.generate_plotter_image(
        ai_client.AiImageRequest(
            image_bytes=_png_bytes(), filename="p.png", mime="image/png", prompt="draw"
        )
    )
    assert out.image_bytes.startswith(b"\x89PNG")
    assert out.model == cfg.model
    assert out.provider_response_id == "img_resp_1"


def _raiser(exc):
    def _edit(**_kwargs):
        raise exc

    return _edit


@pytest.mark.parametrize(
    "error, category",
    [
        (_status_error(openai.AuthenticationError, 401, "bad"), "auth_failed"),
        (_status_error(openai.RateLimitError, 429, "slow down"), "rate_limited"),
        (_status_error(openai.BadRequestError, 400, "safety system rejected"), "policy_rejected"),
        (_status_error(openai.BadRequestError, 400, "bad size"), "bad_response"),
    ],
)
def test_openai_client_error_translation(workspace, monkeypatch, error, category):
    cfg = _real_config(monkeypatch)
    client = OpenAiImageApiClient(cfg)
    monkeypatch.setattr(client, "_client", lambda: _stub_sdk(_raiser(error)))
    with pytest.raises(AiImageError) as exc:
        client.generate_plotter_image(
            ai_client.AiImageRequest(
                image_bytes=_png_bytes(), filename="p.png", mime="image/png", prompt="draw"
            )
        )
    assert exc.value.category == category


def test_openai_client_empty_response_is_bad(workspace, monkeypatch):
    cfg = _real_config(monkeypatch)
    client = OpenAiImageApiClient(cfg)
    monkeypatch.setattr(
        client, "_client", lambda: _stub_sdk(lambda **k: types.SimpleNamespace(id="x", data=[]))
    )
    with pytest.raises(AiImageError) as exc:
        client.generate_plotter_image(
            ai_client.AiImageRequest(
                image_bytes=_png_bytes(), filename="p.png", mime="image/png", prompt="draw"
            )
        )
    assert exc.value.category == "bad_response"


def test_service_real_path_persists_openai_provenance(workspace, monkeypatch):
    cfg = _real_config(monkeypatch)
    monkeypatch.setattr(OpenAiImageApiClient, "_client", lambda self: _stub_sdk(_ok_edit))

    result = AiImageService(cfg).generate(
        filename="cat.png", data=_png_bytes(), mime="image/png", render_mode="edges"
    )
    stored = GalleryService().get(result["galleryItem"]["id"])
    assert stored["ai"]["provider"] == "openai"
    assert stored["ai"]["model"] == cfg.model
    assert stored["ai"]["providerResponseId"] == "img_resp_1"
