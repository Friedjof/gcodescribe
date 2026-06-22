from __future__ import annotations

import os
from dataclasses import dataclass

from .prompts import STYLE_PROMPT

# `gpt-image-2` is the newest image model and the configured default; the real
# model is whatever OPENAI_IMAGE_MODEL names. Only the Image API ("image-api")
# path is wired for the MVP; the Responses path is reserved for later.
DEFAULT_MODEL = "gpt-image-2"
DEFAULT_API_MODE = "image-api"
DEFAULT_SIZE = "1024x1024"
DEFAULT_QUALITY = "auto"
DEFAULT_MAX_INPUT_MB = 10
DEFAULT_TIMEOUT_SECONDS = 90

# Render modes the AI tab may request for the gallery trace. A subset of the
# gallery's VALID_MODES that make sense for a generated line image.
ALLOWED_RENDER_MODES = ("edges", "handwriting", "trace")
DEFAULT_RENDER_MODE = "edges"

_TRUE = {"1", "true", "yes", "on"}


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or "").strip() or default


def _int_env(name: str, default: int) -> int:
    raw = _env(name)
    if not raw:
        return default
    try:
        return max(1, int(raw))
    except ValueError:
        return default


@dataclass(frozen=True)
class AiImageConfig:
    enabled: bool
    fake: bool
    api_key: str
    model: str
    api_mode: str
    size: str
    quality: str
    max_input_mb: int
    timeout_seconds: int

    def status(self) -> dict:
        """The safe subset exposed to the frontend for feature gating.

        Never leaks the API key. When disabled, returns only ``enabled: false``.
        """
        if not self.enabled:
            return {"enabled": False}
        return {
            "enabled": True,
            "model": self.model,
            "apiMode": self.api_mode,
            "maxInputMb": self.max_input_mb,
            "size": self.size,
            "supportsFeedback": True,
            "supportsStreaming": False,
            # The base style prompt every generation starts from, so the UI can
            # preview exactly what gets sent before spending a call.
            "stylePrompt": STYLE_PROMPT,
        }


def load_config() -> AiImageConfig:
    """Read the AI-designer configuration from the environment.

    The feature is enabled when a real ``OPENAI_API_KEY`` is present, or when
    ``AI_IMAGE_FAKE`` is set — the latter drives the cost-free fake client used
    for local development and tests.
    """
    api_key = _env("OPENAI_API_KEY")
    fake = _env("AI_IMAGE_FAKE").lower() in _TRUE
    return AiImageConfig(
        enabled=bool(api_key) or fake,
        fake=fake,
        api_key=api_key,
        model=_env("OPENAI_IMAGE_MODEL", DEFAULT_MODEL),
        api_mode=_env("OPENAI_IMAGE_API_MODE", DEFAULT_API_MODE),
        size=_env("AI_IMAGE_SIZE", DEFAULT_SIZE),
        quality=_env("AI_IMAGE_QUALITY", DEFAULT_QUALITY),
        max_input_mb=_int_env("AI_IMAGE_MAX_INPUT_MB", DEFAULT_MAX_INPUT_MB),
        timeout_seconds=_int_env("AI_IMAGE_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS),
    )
