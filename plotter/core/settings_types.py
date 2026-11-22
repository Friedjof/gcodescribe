"""Public settings payloads. Raw API keys belong only to the internal config."""

from typing import Literal, TypedDict

ConfigSource = Literal["default", "environment", "saved"]
ConfigSection = Literal["printer", "ai", "storage", "auth", "server", "gallery", "mcp"]
SourceMap = dict[ConfigSection, dict[str, ConfigSource]]


class PublicPrinterSettings(TypedDict):
    octoprint_url: str
    octoprint_api_key_configured: bool
    octoprint_verify_ssl: bool
    serial_enabled: bool
    serial_port: str
    serial_baud: int
    default_backend: str


class PublicAiSettings(TypedDict):
    provider: str
    enabled: bool
    fake: bool
    api_key_configured: bool
    model: str
    api_mode: str
    size: str
    quality: str
    max_input_mb: int
    timeout_seconds: int


class PublicStorageSettings(TypedDict):
    data_dir: str


class PublicAuthSettings(TypedDict):
    session_ttl: int
    cookie_secure: bool


class PublicServerSettings(TypedDict):
    host: str
    port: int
    redis_url: str


class PublicGallerySettings(TypedDict):
    upload_enabled: bool
    upload_secret_configured: bool


class PublicMcpSettings(TypedDict):
    enabled: bool
    token_configured: bool


class PublicSettings(TypedDict):
    printer: PublicPrinterSettings
    ai: PublicAiSettings
    storage: PublicStorageSettings
    auth: PublicAuthSettings
    server: PublicServerSettings
    gallery: PublicGallerySettings
    mcp: PublicMcpSettings


class EffectiveSettings(PublicSettings):
    sources: SourceMap
