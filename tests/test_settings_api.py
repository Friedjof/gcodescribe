from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from plotter.web.app import create_app


@pytest.fixture
def client(workspace):
    return TestClient(create_app())


# ── GET /api/settings ─────────────────────────────────────────────────────────


def test_settings_returns_200(client):
    r = client.get("/api/settings")
    assert r.status_code == 200


def test_settings_has_all_sections(client):
    d = client.get("/api/settings").json()
    assert set(d.keys()) == {"printer", "ai", "storage", "auth", "server"}


def test_settings_no_raw_secrets(client, monkeypatch):
    monkeypatch.setenv("OCTOPRINT_API_KEY", "super-secret")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-secret")
    d = client.get("/api/settings").json()
    assert "super-secret" not in str(d)
    assert "sk-secret" not in str(d)


def test_settings_api_key_configured_flag(client, monkeypatch):
    monkeypatch.setenv("OCTOPRINT_API_KEY", "key123")
    d = client.get("/api/settings").json()
    assert d["printer"]["octoprint_api_key_configured"] is True


def test_settings_api_key_not_configured_when_absent(client, monkeypatch):
    monkeypatch.delenv("OCTOPRINT_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    d = client.get("/api/settings").json()
    assert d["printer"]["octoprint_api_key_configured"] is False
    assert d["ai"]["api_key_configured"] is False


def test_settings_no_sources_key(client):
    d = client.get("/api/settings").json()
    assert "sources" not in d


def test_settings_reflects_env(client, monkeypatch):
    monkeypatch.setenv("OCTOPRINT_URL", "http://octopi.local")
    monkeypatch.setenv("PRINTER_SERIAL_BAUD", "9600")
    d = client.get("/api/settings").json()
    assert d["printer"]["octoprint_url"] == "http://octopi.local"
    assert d["printer"]["serial_baud"] == 9600


# ── GET /api/settings/effective ──────────────────────────────────────────────


def test_effective_returns_200(client):
    r = client.get("/api/settings/effective")
    assert r.status_code == 200


def test_effective_has_sources_key(client):
    d = client.get("/api/settings/effective").json()
    assert "sources" in d


def test_effective_sources_has_all_sections(client):
    d = client.get("/api/settings/effective").json()
    assert set(d["sources"].keys()) == {"printer", "ai", "storage", "auth", "server"}


def test_effective_sources_all_default_on_clean_env(client, monkeypatch):
    for var in (
        "OCTOPRINT_URL", "OCTOPRINT_API_KEY", "OCTOPRINT_VERIFY_SSL",
        "PRINTER_SERIAL_ENABLED", "PRINTER_USE_SERIAL", "PRINTER_SERIAL_PORT",
        "PRINTER_SERIAL_BAUD", "PRINTER_DEFAULT_BACKEND",
        "OPENAI_API_KEY", "AI_IMAGE_FAKE", "OPENAI_IMAGE_MODEL",
        "AI_IMAGE_SIZE", "AI_IMAGE_QUALITY",
    ):
        monkeypatch.delenv(var, raising=False)

    d = client.get("/api/settings/effective").json()
    assert d["sources"]["printer"]["octoprint_url"] == "default"
    assert d["sources"]["ai"]["model"] == "default"


def test_effective_sources_environment_when_env_set(client, monkeypatch):
    monkeypatch.setenv("OCTOPRINT_URL", "http://octopi.local")
    monkeypatch.setenv("OPENAI_IMAGE_MODEL", "gpt-image-1")
    d = client.get("/api/settings/effective").json()
    assert d["sources"]["printer"]["octoprint_url"] == "environment"
    assert d["sources"]["ai"]["model"] == "environment"


def test_effective_values_and_sources_consistent(client, monkeypatch):
    monkeypatch.setenv("PRINTER_SERIAL_BAUD", "9600")
    d = client.get("/api/settings/effective").json()
    assert d["printer"]["serial_baud"] == 9600
    assert d["sources"]["printer"]["serial_baud"] == "environment"


def test_effective_no_raw_secrets(client, monkeypatch):
    monkeypatch.setenv("OCTOPRINT_API_KEY", "top-secret")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-secret")
    d = client.get("/api/settings/effective").json()
    assert "top-secret" not in str(d)
    assert "sk-secret" not in str(d)


# ── auth required ─────────────────────────────────────────────────────────────


def test_settings_requires_auth(workspace):
    # Create a client without the test auth bypass.
    import os
    from unittest.mock import patch

    env = {**os.environ, "PLOTTER_AUTH_TEST_BYPASS": "false"}
    with patch.dict(os.environ, env, clear=False):
        c = TestClient(create_app())
        assert c.get("/api/settings").status_code == 401
        assert c.get("/api/settings/effective").status_code == 401


# ── PATCH /api/settings ───────────────────────────────────────────────────────


def test_patch_settings_persists_value(client):
    r = client.patch("/api/settings", json={"settings": {"printer.octoprint_url": "http://saved.local"}})
    assert r.status_code == 200
    d = r.json()
    assert d["printer"]["octoprint_url"] == "http://saved.local"


def test_patch_settings_source_becomes_saved(client):
    client.patch("/api/settings", json={"settings": {"printer.octoprint_url": "http://saved.local"}})
    d = client.get("/api/settings/effective").json()
    assert d["sources"]["printer"]["octoprint_url"] == "saved"


def test_patch_settings_survives_re_read(client):
    client.patch("/api/settings", json={"settings": {"server.port": 9999}})
    d = client.get("/api/settings").json()
    assert d["server"]["port"] == 9999


def test_patch_settings_ignores_computed_flags(client):
    r = client.patch(
        "/api/settings",
        json={"settings": {"ai.enabled": True, "ai.api_key_configured": True}},
    )
    assert r.status_code == 200
    d = client.get("/api/settings/effective").json()
    # ai.enabled must remain false (no real key set)
    assert d["ai"]["enabled"] is False


def test_patch_settings_rejects_invalid_key_format(client):
    r = client.patch("/api/settings", json={"settings": {"notavalidkey": "val"}})
    assert r.status_code == 422


def test_patch_settings_accepts_api_key_but_does_not_return_it(client):
    r = client.patch("/api/settings", json={"settings": {"ai.api_key": "sk-saved"}})
    assert r.status_code == 200
    d = r.json()
    assert "sk-saved" not in str(d)
    assert d["ai"]["api_key_configured"] is True


def test_patch_settings_multiple_fields(client):
    r = client.patch("/api/settings", json={"settings": {
        "printer.serial_enabled": True,
        "printer.serial_baud": 9600,
        "ai.model": "gpt-image-1",
    }})
    assert r.status_code == 200
    d = r.json()
    assert d["printer"]["serial_enabled"] is True
    assert d["printer"]["serial_baud"] == 9600
    assert d["ai"]["model"] == "gpt-image-1"


# ── DELETE /api/settings/{section}/{field} ────────────────────────────────────


def test_reset_field_removes_saved_override(client):
    client.patch("/api/settings", json={"settings": {"printer.octoprint_url": "http://saved.local"}})
    client.delete("/api/settings/printer/octoprint_url")
    d = client.get("/api/settings/effective").json()
    assert d["printer"]["octoprint_url"] == ""
    assert d["sources"]["printer"]["octoprint_url"] in ("default", "environment")


def test_reset_field_returns_updated_effective(client):
    client.patch("/api/settings", json={"settings": {"ai.model": "gpt-image-1"}})
    r = client.delete("/api/settings/ai/model")
    assert r.status_code == 200
    assert r.json()["ai"]["model"] == "gpt-image-2"  # back to default


def test_reset_unknown_field_is_noop(client):
    r = client.delete("/api/settings/printer/nonexistent_field")
    assert r.status_code == 200
