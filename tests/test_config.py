from __future__ import annotations

from plotter.config import load_settings, load_settings_with_sources

# ── helpers ───────────────────────────────────────────────────────────────────


def _clean_env(monkeypatch):
    """Remove all config-related env vars so defaults are deterministic."""
    env_vars = [
        "OCTOPRINT_URL", "OCTOPRINT_API_KEY", "OCTOPRINT_VERIFY_SSL",
        "PRINTER_SERIAL_ENABLED", "PRINTER_USE_SERIAL", "PRINTER_SERIAL_PORT",
        "PRINTER_SERIAL_BAUD", "PRINTER_DEFAULT_BACKEND",
        "OPENAI_API_KEY", "AI_IMAGE_FAKE", "OPENAI_IMAGE_MODEL",
        "OPENAI_IMAGE_API_MODE", "AI_IMAGE_SIZE", "AI_IMAGE_QUALITY",
        "AI_IMAGE_MAX_INPUT_MB", "AI_IMAGE_TIMEOUT_SECONDS",
        "PLOTTER_DATA_DIR",
        "PLOTTER_AUTH_SESSION_TTL", "PLOTTER_AUTH_COOKIE_SECURE",
        "PLOTTER_HOST", "PLOTTER_PORT", "REDIS_URL",
    ]
    for var in env_vars:
        monkeypatch.delenv(var, raising=False)


# ── built-in defaults ─────────────────────────────────────────────────────────


def test_defaults_printer(monkeypatch):
    _clean_env(monkeypatch)
    cfg = load_settings()
    assert cfg.printer.octoprint_url == ""
    assert cfg.printer.octoprint_api_key == ""
    assert cfg.printer.octoprint_verify_ssl is True
    assert cfg.printer.serial_enabled is False
    assert cfg.printer.serial_port == "/dev/ttyUSB0"
    assert cfg.printer.serial_baud == 115200
    assert cfg.printer.default_backend == ""


def test_defaults_ai(monkeypatch):
    _clean_env(monkeypatch)
    cfg = load_settings()
    assert cfg.ai.enabled is False
    assert cfg.ai.fake is False
    assert cfg.ai.api_key == ""
    assert cfg.ai.model == "gpt-image-2"
    assert cfg.ai.api_mode == "image-api"
    assert cfg.ai.size == "1024x1024"
    assert cfg.ai.quality == "auto"
    assert cfg.ai.max_input_mb == 10
    assert cfg.ai.timeout_seconds == 90


def test_defaults_storage(monkeypatch):
    _clean_env(monkeypatch)
    cfg = load_settings()
    assert cfg.storage.data_dir == "data"


def test_defaults_auth(monkeypatch):
    _clean_env(monkeypatch)
    cfg = load_settings()
    assert cfg.auth.session_ttl == 14 * 24 * 60 * 60
    assert cfg.auth.cookie_secure is False


def test_defaults_server(monkeypatch):
    _clean_env(monkeypatch)
    cfg = load_settings()
    assert cfg.server.host == "0.0.0.0"
    assert cfg.server.port == 8000
    assert cfg.server.redis_url == "redis://localhost:6379/0"


# ── env overrides default ─────────────────────────────────────────────────────


def test_env_overrides_printer(monkeypatch):
    _clean_env(monkeypatch)
    monkeypatch.setenv("OCTOPRINT_URL", "http://octopi.local")
    monkeypatch.setenv("OCTOPRINT_API_KEY", "secret123")
    monkeypatch.setenv("OCTOPRINT_VERIFY_SSL", "false")
    monkeypatch.setenv("PRINTER_SERIAL_ENABLED", "true")
    monkeypatch.setenv("PRINTER_SERIAL_PORT", "/dev/ttyACM0")
    monkeypatch.setenv("PRINTER_SERIAL_BAUD", "9600")
    monkeypatch.setenv("PRINTER_DEFAULT_BACKEND", "octoprint")

    cfg = load_settings()
    assert cfg.printer.octoprint_url == "http://octopi.local"
    assert cfg.printer.octoprint_api_key == "secret123"
    assert cfg.printer.octoprint_verify_ssl is False
    assert cfg.printer.serial_enabled is True
    assert cfg.printer.serial_port == "/dev/ttyACM0"
    assert cfg.printer.serial_baud == 9600
    assert cfg.printer.default_backend == "octoprint"


def test_env_overrides_ai(monkeypatch):
    _clean_env(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("OPENAI_IMAGE_MODEL", "gpt-image-1")
    monkeypatch.setenv("AI_IMAGE_SIZE", "512x512")
    monkeypatch.setenv("AI_IMAGE_QUALITY", "high")
    monkeypatch.setenv("AI_IMAGE_MAX_INPUT_MB", "20")
    monkeypatch.setenv("AI_IMAGE_TIMEOUT_SECONDS", "120")

    cfg = load_settings()
    assert cfg.ai.enabled is True
    assert cfg.ai.api_key == "sk-test"
    assert cfg.ai.model == "gpt-image-1"
    assert cfg.ai.size == "512x512"
    assert cfg.ai.quality == "high"
    assert cfg.ai.max_input_mb == 20
    assert cfg.ai.timeout_seconds == 120


def test_env_overrides_server(monkeypatch):
    _clean_env(monkeypatch)
    monkeypatch.setenv("PLOTTER_HOST", "127.0.0.1")
    monkeypatch.setenv("PLOTTER_PORT", "9000")
    monkeypatch.setenv("REDIS_URL", "redis://redis:6379/1")

    cfg = load_settings()
    assert cfg.server.host == "127.0.0.1"
    assert cfg.server.port == 9000
    assert cfg.server.redis_url == "redis://redis:6379/1"


# ── saved overrides env ───────────────────────────────────────────────────────


def test_saved_overrides_env(monkeypatch):
    _clean_env(monkeypatch)
    monkeypatch.setenv("OCTOPRINT_URL", "http://env-value.local")

    cfg = load_settings(saved={"printer.octoprint_url": "http://saved-value.local"})
    assert cfg.printer.octoprint_url == "http://saved-value.local"


def test_saved_overrides_ai_model(monkeypatch):
    _clean_env(monkeypatch)
    monkeypatch.setenv("OPENAI_IMAGE_MODEL", "gpt-image-1")

    cfg = load_settings(saved={"ai.model": "gpt-image-2"})
    assert cfg.ai.model == "gpt-image-2"


def test_saved_overrides_server_port(monkeypatch):
    _clean_env(monkeypatch)
    monkeypatch.setenv("PLOTTER_PORT", "9000")

    cfg = load_settings(saved={"server.port": 8080})
    assert cfg.server.port == 8080


# ── ai enabled flag ───────────────────────────────────────────────────────────


def test_ai_enabled_by_api_key(monkeypatch):
    _clean_env(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-real")
    cfg = load_settings()
    assert cfg.ai.enabled is True
    assert cfg.ai.fake is False


def test_ai_enabled_by_fake(monkeypatch):
    _clean_env(monkeypatch)
    monkeypatch.setenv("AI_IMAGE_FAKE", "true")
    cfg = load_settings()
    assert cfg.ai.enabled is True
    assert cfg.ai.fake is True
    assert cfg.ai.api_key == ""


def test_ai_disabled_without_key_or_fake(monkeypatch):
    _clean_env(monkeypatch)
    cfg = load_settings()
    assert cfg.ai.enabled is False


# ── legacy PRINTER_USE_SERIAL alias ──────────────────────────────────────────


def test_printer_use_serial_alias(monkeypatch):
    _clean_env(monkeypatch)
    monkeypatch.setenv("PRINTER_USE_SERIAL", "true")
    cfg = load_settings()
    assert cfg.printer.serial_enabled is True


def test_printer_serial_enabled_takes_precedence_over_alias(monkeypatch):
    _clean_env(monkeypatch)
    monkeypatch.setenv("PRINTER_SERIAL_ENABLED", "false")
    monkeypatch.setenv("PRINTER_USE_SERIAL", "true")
    cfg = load_settings()
    assert cfg.printer.serial_enabled is False


# ── session_ttl minimum ───────────────────────────────────────────────────────


def test_session_ttl_minimum_enforced(monkeypatch):
    _clean_env(monkeypatch)
    monkeypatch.setenv("PLOTTER_AUTH_SESSION_TTL", "0")
    cfg = load_settings()
    assert cfg.auth.session_ttl == 60


def test_session_ttl_invalid_env_falls_back_to_default(monkeypatch):
    _clean_env(monkeypatch)
    monkeypatch.setenv("PLOTTER_AUTH_SESSION_TTL", "not-a-number")
    cfg = load_settings()
    assert cfg.auth.session_ttl == 14 * 24 * 60 * 60


# ── secret redaction ──────────────────────────────────────────────────────────


def test_redact_hides_octoprint_api_key(monkeypatch):
    _clean_env(monkeypatch)
    monkeypatch.setenv("OCTOPRINT_API_KEY", "super-secret")
    cfg = load_settings()
    d = cfg.redact()
    assert "octoprint_api_key" not in d["printer"]
    assert d["printer"]["octoprint_api_key_configured"] is True


def test_redact_hides_openai_api_key(monkeypatch):
    _clean_env(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-secret")
    cfg = load_settings()
    d = cfg.redact()
    assert "api_key" not in d["ai"]
    assert d["ai"]["api_key_configured"] is True


def test_redact_api_key_configured_false_when_absent(monkeypatch):
    _clean_env(monkeypatch)
    cfg = load_settings()
    d = cfg.redact()
    assert d["printer"]["octoprint_api_key_configured"] is False
    assert d["ai"]["api_key_configured"] is False


def test_redact_contains_all_expected_sections(monkeypatch):
    _clean_env(monkeypatch)
    cfg = load_settings()
    d = cfg.redact()
    assert set(d.keys()) == {"printer", "ai", "storage", "auth", "server", "gallery"}


# ── source tracking ───────────────────────────────────────────────────────────


def test_sources_all_default_when_env_clean(monkeypatch):
    _clean_env(monkeypatch)
    _, sources = load_settings_with_sources()
    for section in ("printer", "ai", "storage", "auth", "server", "gallery"):
        for key, src in sources[section].items():
            assert src == "default", f"{section}.{key} expected default, got {src}"


def test_sources_environment_when_env_set(monkeypatch):
    _clean_env(monkeypatch)
    monkeypatch.setenv("OCTOPRINT_URL", "http://octopi.local")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    _, sources = load_settings_with_sources()
    assert sources["printer"]["octoprint_url"] == "environment"
    assert sources["ai"]["api_key"] == "environment"
    assert sources["printer"]["serial_enabled"] == "default"


def test_sources_saved_overrides_env(monkeypatch):
    _clean_env(monkeypatch)
    monkeypatch.setenv("OCTOPRINT_URL", "http://env.local")
    _, sources = load_settings_with_sources(saved={"printer.octoprint_url": "http://saved.local"})
    assert sources["printer"]["octoprint_url"] == "saved"
    assert sources["printer"]["serial_enabled"] == "default"
