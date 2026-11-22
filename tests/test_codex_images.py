from __future__ import annotations

import base64
from dataclasses import replace
from unittest.mock import Mock

import pytest

from plotter.ai_images.client import AiImageRequest, CodexImageClient, make_client
from plotter.ai_images.codex import CodexBridge
from plotter.ai_images.config import load_config
from plotter.ai_images.errors import AiImageError
from plotter.services.settings_store import patch_saved


def request(image=None):
    return AiImageRequest(image, "source.png", "image/png", "Improve this drawing")


def test_saved_api_settings_and_provider_are_resolved_together(workspace, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("AI_IMAGE_FAKE", raising=False)
    patch_saved({"ai.api_key": "saved-only-key", "ai.provider": "api"})
    assert load_config().api_key == "saved-only-key"
    assert load_config().enabled
    patch_saved({"ai.provider": "codex"})
    assert load_config().provider == "codex"
    assert load_config().api_key == "saved-only-key"
    assert isinstance(make_client(load_config()), CodexImageClient)


def test_codex_limits_never_fall_back_to_api_billing(workspace, monkeypatch):
    bridge = Mock()
    bridge.generate.side_effect = AiImageError("rate_limited", "Codex limit reached")
    monkeypatch.setattr("plotter.ai_images.codex.get_codex", lambda: bridge)
    api = Mock(side_effect=AssertionError("API must not be called"))
    monkeypatch.setattr("plotter.ai_images.client.OpenAiImageApiClient", api)
    config = replace(load_config(), enabled=True, fake=False, provider="codex", api_key="kept-key")
    image = request(b"reference bytes")
    with pytest.raises(AiImageError, match="Codex limit"):
        make_client(config).generate_plotter_image(image)
    bridge.generate.assert_called_once_with(image, config.timeout_seconds)
    api.assert_not_called()


def test_unknown_provider_never_uses_a_saved_api_key(workspace):
    config = replace(load_config(), enabled=False, fake=False, provider="typo", api_key="kept-key")
    with pytest.raises(AiImageError):
        make_client(config)


def test_codex_status_exposes_account_but_never_credentials(tmp_path, monkeypatch):
    monkeypatch.setattr("shutil.which", lambda _: "/fake/codex")
    bridge = CodexBridge(tmp_path)
    bridge._rpc = Mock(
        side_effect=[
            {
                "account": {
                    "type": "chatgpt",
                    "email": "user@example.test",
                    "planType": "plus",
                    "accessToken": "private-token",
                }
            },
            {"imageGeneration": True},
        ]
    )
    status = bridge.status()
    assert status == {
        "available": True,
        "authenticated": True,
        "email": "user@example.test",
        "plan": "plus",
        "imageGeneration": True,
    }
    assert "private-token" not in str(status)


@pytest.mark.parametrize("url", ["http://auth.openai.com/codex/device", "https://evil.test/login"])
def test_device_login_requires_the_official_https_page(tmp_path, url):
    bridge = CodexBridge(tmp_path)
    bridge._rpc = Mock(
        return_value={"loginId": "login", "verificationUrl": url, "userCode": "ABCD"}
    )
    with pytest.raises(AiImageError):
        bridge.login()


def test_login_uses_managed_device_auth_and_exposes_only_the_one_time_code(tmp_path):
    bridge = CodexBridge(tmp_path)
    bridge._rpc = Mock(
        return_value={
            "loginId": "login",
            "verificationUrl": "https://auth.openai.com/codex/device",
            "userCode": "ABCD-1234",
            "token": "private",
        }
    )
    login = bridge.login()
    bridge._rpc.assert_called_once_with("account/login/start", {"type": "chatgptDeviceCode"})
    assert login["userCode"] == "ABCD-1234"
    assert "private" not in str(login)


def test_generation_attaches_reference_and_receives_the_builtin_image_result(tmp_path):
    bridge = CodexBridge(tmp_path)
    bridge.status = lambda: {"authenticated": True, "imageGeneration": True}
    calls = []
    image = b"\x89PNG\r\n\x1a\nimage bytes"

    def rpc(method, params=None, **kwargs):
        calls.append((method, params))
        if method == "thread/start":
            assert params["approvalPolicy"] == "never"
            assert params["sandbox"] == "read-only"
            assert params["ephemeral"] is True
            return {"thread": {"id": "thread"}}
        if method == "turn/start":
            from pathlib import Path

            reference = params["input"][0]
            assert reference["type"] == "localImage"
            assert Path(reference["path"]).read_bytes() == b"reference"
            bridge._events.put(
                {
                    "method": "item/completed",
                    "params": {
                        "threadId": "thread",
                        "item": {
                            "type": "imageGeneration",
                            "status": "completed",
                            "result": base64.b64encode(image).decode(),
                        },
                    },
                }
            )
            bridge._events.put(
                {
                    "method": "turn/completed",
                    "params": {
                        "threadId": "thread",
                        "turn": {"id": "turn", "status": "completed", "items": []},
                    },
                }
            )
            return {"turn": {"id": "turn"}}
        return {}

    bridge._rpc = rpc
    output = bridge.generate(request(b"reference"), 90)
    assert output.image_bytes == image and output.mime == "image/png"
    assert output.provider_response_id == "turn"
    assert [method for method, _ in calls] == ["thread/start", "turn/start", "turn/interrupt"]
    assert list(tmp_path.iterdir()) == []


def test_generated_files_cannot_escape_the_isolated_codex_directory(tmp_path):
    root = tmp_path / "codex"
    root.mkdir()
    work = root / "image"
    work.mkdir()
    outside = tmp_path / "credentials.json"
    outside.write_bytes(b"private")
    bridge = CodexBridge(root)
    link = work / "image.png"
    link.symlink_to(outside)
    for path in (outside, link):
        with pytest.raises(AiImageError):
            bridge._image_bytes({"savedPath": str(path)}, work)
    image = work / "generated.png"
    image.write_bytes(b"image")
    assert bridge._image_bytes({"savedPath": str(image)}, work) == b"image"
