from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal

ConfigSource = Literal["default", "environment", "saved"]

_TRUE = {"1", "true", "yes", "on"}

# ── built-in defaults ────────────────────────────────────────────────────────

_PRINTER_DEFAULTS: dict = {
    "octoprint_url": "",
    "octoprint_api_key": "",
    "octoprint_verify_ssl": True,
    "serial_enabled": False,
    "serial_port": "/dev/ttyUSB0",
    "serial_baud": 115200,
    "default_backend": "",
}

_AI_DEFAULTS: dict = {
    "fake": False,
    "api_key": "",
    "model": "gpt-image-2",
    "api_mode": "image-api",
    "size": "1024x1024",
    "quality": "auto",
    "max_input_mb": 10,
    "timeout_seconds": 90,
}

_STORAGE_DEFAULTS: dict = {
    "data_dir": "data",
}

_AUTH_DEFAULTS: dict = {
    "session_ttl": 14 * 24 * 60 * 60,
    "cookie_secure": False,
}

_SERVER_DEFAULTS: dict = {
    "host": "0.0.0.0",
    "port": 8000,
    "redis_url": "redis://localhost:6379/0",
}

_GALLERY_DEFAULTS: dict = {
    "upload_enabled": False,
    "upload_secret": "",
}


# ── typed settings models ────────────────────────────────────────────────────


@dataclass(frozen=True)
class PrinterSettings:
    octoprint_url: str
    octoprint_api_key: str  # sensitive — never surfaced via API
    octoprint_verify_ssl: bool
    serial_enabled: bool
    serial_port: str
    serial_baud: int
    default_backend: str


@dataclass(frozen=True)
class AiSettings:
    enabled: bool
    fake: bool
    api_key: str  # sensitive — never surfaced via API
    model: str
    api_mode: str
    size: str
    quality: str
    max_input_mb: int
    timeout_seconds: int


@dataclass(frozen=True)
class StorageSettings:
    data_dir: str


@dataclass(frozen=True)
class AuthSettings:
    session_ttl: int
    cookie_secure: bool


@dataclass(frozen=True)
class ServerSettings:
    host: str
    port: int
    redis_url: str


@dataclass(frozen=True)
class GallerySettings:
    upload_enabled: bool
    upload_secret: str  # plain token embedded in share URL — not a password


@dataclass(frozen=True)
class AppSettings:
    printer: PrinterSettings
    ai: AiSettings
    storage: StorageSettings
    auth: AuthSettings
    server: ServerSettings
    gallery: GallerySettings

    def redact(self) -> dict:
        """Return an API-safe dict — secrets are replaced with presence flags."""
        return {
            "printer": {
                "octoprint_url": self.printer.octoprint_url,
                "octoprint_api_key_configured": bool(self.printer.octoprint_api_key),
                "octoprint_verify_ssl": self.printer.octoprint_verify_ssl,
                "serial_enabled": self.printer.serial_enabled,
                "serial_port": self.printer.serial_port,
                "serial_baud": self.printer.serial_baud,
                "default_backend": self.printer.default_backend,
            },
            "ai": {
                "enabled": self.ai.enabled,
                "fake": self.ai.fake,
                "api_key_configured": bool(self.ai.api_key),
                "model": self.ai.model,
                "api_mode": self.ai.api_mode,
                "size": self.ai.size,
                "quality": self.ai.quality,
                "max_input_mb": self.ai.max_input_mb,
                "timeout_seconds": self.ai.timeout_seconds,
            },
            "storage": {
                "data_dir": self.storage.data_dir,
            },
            "auth": {
                "session_ttl": self.auth.session_ttl,
                "cookie_secure": self.auth.cookie_secure,
            },
            "server": {
                "host": self.server.host,
                "port": self.server.port,
                "redis_url": self.server.redis_url,
            },
            "gallery": {
                "upload_enabled": self.gallery.upload_enabled,
                "upload_secret_configured": bool(self.gallery.upload_secret),
            },
        }


# ── source map ───────────────────────────────────────────────────────────────

SourceMap = dict[str, dict[str, ConfigSource]]


# ── per-type resolver helpers ─────────────────────────────────────────────────


def _str(
    env: str,
    default: str,
    saved: object,
    sources: dict[str, ConfigSource],
    key: str,
) -> str:
    value: str = default
    src: ConfigSource = "default"
    raw = (os.environ.get(env) or "").strip()
    if raw:
        value, src = raw, "environment"
    if saved is not None:
        value, src = str(saved), "saved"
    sources[key] = src
    return value


def _bool(
    env: str,
    default: bool,
    saved: object,
    sources: dict[str, ConfigSource],
    key: str,
) -> bool:
    value: bool = default
    src: ConfigSource = "default"
    raw = (os.environ.get(env) or "").strip().lower()
    if raw:
        value, src = raw in _TRUE, "environment"
    if saved is not None:
        value, src = bool(saved), "saved"
    sources[key] = src
    return value


def _int(
    env: str,
    default: int,
    saved: object,
    sources: dict[str, ConfigSource],
    key: str,
) -> int:
    value: int = default
    src: ConfigSource = "default"
    raw = (os.environ.get(env) or "").strip()
    if raw:
        try:
            value, src = int(raw), "environment"
        except ValueError:
            pass
    if saved is not None:
        try:
            value, src = int(saved), "saved"  # type: ignore[arg-type]
        except (TypeError, ValueError):
            pass
    sources[key] = src
    return value


def _serial_enabled(
    saved: object,
    sources: dict[str, ConfigSource],
) -> bool:
    """Resolve serial_enabled, honouring the legacy PRINTER_USE_SERIAL alias."""
    value: bool = _PRINTER_DEFAULTS["serial_enabled"]
    src: ConfigSource = "default"
    for env_var in ("PRINTER_SERIAL_ENABLED", "PRINTER_USE_SERIAL"):
        raw = (os.environ.get(env_var) or "").strip().lower()
        if raw:
            value, src = raw in _TRUE, "environment"
            break
    if saved is not None:
        value, src = bool(saved), "saved"
    sources["serial_enabled"] = src
    return value


# ── public loader ─────────────────────────────────────────────────────────────


def load_settings(saved: dict | None = None) -> AppSettings:
    """Build ``AppSettings`` from: built-in defaults → env vars → *saved*.

    *saved* is a flat dict keyed by ``"section.field"``
    (e.g. ``{"printer.octoprint_url": "http://myprinter"}``).
    Phase 4 wires this to the persistence layer; pass ``None`` until then.
    """
    settings, _ = _load(saved)
    return settings


def load_settings_with_sources(saved: dict | None = None) -> tuple[AppSettings, SourceMap]:
    """Like ``load_settings`` but also returns a per-field source map."""
    return _load(saved)


# ── internal builder ──────────────────────────────────────────────────────────


def _load(saved: dict | None) -> tuple[AppSettings, SourceMap]:
    s = saved or {}
    p_src: dict[str, ConfigSource] = {}
    ai_src: dict[str, ConfigSource] = {}
    st_src: dict[str, ConfigSource] = {}
    au_src: dict[str, ConfigSource] = {}
    sv_src: dict[str, ConfigSource] = {}
    g_src: dict[str, ConfigSource] = {}

    printer = PrinterSettings(
        octoprint_url=_str(
            "OCTOPRINT_URL", _PRINTER_DEFAULTS["octoprint_url"],
            s.get("printer.octoprint_url"), p_src, "octoprint_url",
        ),
        octoprint_api_key=_str(
            "OCTOPRINT_API_KEY", _PRINTER_DEFAULTS["octoprint_api_key"],
            s.get("printer.octoprint_api_key"), p_src, "octoprint_api_key",
        ),
        octoprint_verify_ssl=_bool(
            "OCTOPRINT_VERIFY_SSL", _PRINTER_DEFAULTS["octoprint_verify_ssl"],
            s.get("printer.octoprint_verify_ssl"), p_src, "octoprint_verify_ssl",
        ),
        serial_enabled=_serial_enabled(s.get("printer.serial_enabled"), p_src),
        serial_port=_str(
            "PRINTER_SERIAL_PORT", _PRINTER_DEFAULTS["serial_port"],
            s.get("printer.serial_port"), p_src, "serial_port",
        ),
        serial_baud=_int(
            "PRINTER_SERIAL_BAUD", _PRINTER_DEFAULTS["serial_baud"],
            s.get("printer.serial_baud"), p_src, "serial_baud",
        ),
        default_backend=_str(
            "PRINTER_DEFAULT_BACKEND", _PRINTER_DEFAULTS["default_backend"],
            s.get("printer.default_backend"), p_src, "default_backend",
        ),
    )

    api_key = _str(
        "OPENAI_API_KEY", _AI_DEFAULTS["api_key"],
        s.get("ai.api_key"), ai_src, "api_key",
    )
    fake = _bool(
        "AI_IMAGE_FAKE", _AI_DEFAULTS["fake"],
        s.get("ai.fake"), ai_src, "fake",
    )
    ai = AiSettings(
        enabled=bool(api_key) or fake,
        fake=fake,
        api_key=api_key,
        model=_str(
            "OPENAI_IMAGE_MODEL", _AI_DEFAULTS["model"],
            s.get("ai.model"), ai_src, "model",
        ),
        api_mode=_str(
            "OPENAI_IMAGE_API_MODE", _AI_DEFAULTS["api_mode"],
            s.get("ai.api_mode"), ai_src, "api_mode",
        ),
        size=_str(
            "AI_IMAGE_SIZE", _AI_DEFAULTS["size"],
            s.get("ai.size"), ai_src, "size",
        ),
        quality=_str(
            "AI_IMAGE_QUALITY", _AI_DEFAULTS["quality"],
            s.get("ai.quality"), ai_src, "quality",
        ),
        max_input_mb=_int(
            "AI_IMAGE_MAX_INPUT_MB", _AI_DEFAULTS["max_input_mb"],
            s.get("ai.max_input_mb"), ai_src, "max_input_mb",
        ),
        timeout_seconds=_int(
            "AI_IMAGE_TIMEOUT_SECONDS", _AI_DEFAULTS["timeout_seconds"],
            s.get("ai.timeout_seconds"), ai_src, "timeout_seconds",
        ),
    )

    storage = StorageSettings(
        data_dir=_str(
            "PLOTTER_DATA_DIR", _STORAGE_DEFAULTS["data_dir"],
            s.get("storage.data_dir"), st_src, "data_dir",
        ),
    )

    raw_ttl = _int(
        "PLOTTER_AUTH_SESSION_TTL", _AUTH_DEFAULTS["session_ttl"],
        s.get("auth.session_ttl"), au_src, "session_ttl",
    )
    auth = AuthSettings(
        session_ttl=max(60, raw_ttl),
        cookie_secure=_bool(
            "PLOTTER_AUTH_COOKIE_SECURE", _AUTH_DEFAULTS["cookie_secure"],
            s.get("auth.cookie_secure"), au_src, "cookie_secure",
        ),
    )

    server = ServerSettings(
        host=_str(
            "PLOTTER_HOST", _SERVER_DEFAULTS["host"],
            s.get("server.host"), sv_src, "host",
        ),
        port=_int(
            "PLOTTER_PORT", _SERVER_DEFAULTS["port"],
            s.get("server.port"), sv_src, "port",
        ),
        redis_url=_str(
            "REDIS_URL", _SERVER_DEFAULTS["redis_url"],
            s.get("server.redis_url"), sv_src, "redis_url",
        ),
    )

    gallery = GallerySettings(
        upload_enabled=_bool(
            "GALLERY_UPLOAD_ENABLED", _GALLERY_DEFAULTS["upload_enabled"],
            s.get("gallery.upload_enabled"), g_src, "upload_enabled",
        ),
        upload_secret=_str(
            "GALLERY_UPLOAD_SECRET", _GALLERY_DEFAULTS["upload_secret"],
            s.get("gallery.upload_secret"), g_src, "upload_secret",
        ),
    )

    settings = AppSettings(
        printer=printer, ai=ai, storage=storage, auth=auth, server=server, gallery=gallery,
    )
    sources: SourceMap = {
        "printer": p_src,
        "ai": ai_src,
        "storage": st_src,
        "auth": au_src,
        "server": sv_src,
        "gallery": g_src,
    }
    return settings, sources
