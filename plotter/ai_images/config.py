from __future__ import annotations

from dataclasses import dataclass

from .prompts import ASPECT_PROMPTS, EFFECT_PROMPTS, STYLE_PROMPTS, TEXT_PROMPTS

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
    provider: str = "api"

    def status(self) -> dict:
        """The safe subset exposed to the frontend for feature gating.

        Never leaks the API key. When disabled, returns only ``enabled: false``.
        """
        if not self.enabled:
            return {"enabled": False}
        status = {
            "enabled": True,
            "model": self.model,
            "apiMode": self.api_mode,
            "maxInputMb": self.max_input_mb,
            "size": self.size,
            "supportsFeedback": True,
            "supportsStreaming": False,
            # The per-mode base style prompts plus the optional effect/text
            # fragments, so the UI can preview exactly what gets sent for the
            # current selection before spending a call.
            "stylePrompts": STYLE_PROMPTS,
            "effectPrompts": EFFECT_PROMPTS,
            "textPrompts": TEXT_PROMPTS,
            "aspectPrompts": ASPECT_PROMPTS,
        }
        if self.provider == "codex" and not self.fake:
            from .codex import get_codex

            access = get_codex().status()
            status.update(
                provider="codex",
                model="Codex image generation",
                apiMode="codex",
                ready=bool(access.get("authenticated") and access.get("imageGeneration")),
            )
        return status


def load_config() -> AiImageConfig:
    """Read the same saved/environment settings as the settings UI.

    API access requires a configured key. Selecting Codex enables its sign-in
    flow; account readiness is checked separately. ``AI_IMAGE_FAKE`` selects
    the cost-free development/test client.
    """
    from plotter.core.config import load_settings
    from plotter.services.settings_store import load_saved

    ai = load_settings(load_saved()).ai
    return AiImageConfig(
        enabled=ai.enabled,
        fake=ai.fake,
        api_key=ai.api_key,
        provider=ai.provider,
        model=ai.model,
        api_mode="codex" if ai.provider == "codex" else ai.api_mode,
        size=ai.size,
        quality=ai.quality,
        max_input_mb=ai.max_input_mb,
        timeout_seconds=ai.timeout_seconds,
    )
