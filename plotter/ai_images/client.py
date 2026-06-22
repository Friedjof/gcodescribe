from __future__ import annotations

import hashlib
import io
import math
from dataclasses import dataclass
from typing import Protocol

from .config import AiImageConfig
from .errors import AiImageError


@dataclass
class AiImageRequest:
    image_bytes: bytes
    filename: str
    mime: str
    prompt: str
    size: str = "1024x1024"
    user_instructions: str = ""
    feedback: str = ""
    parent_variant_id: str | None = None


@dataclass
class AiImageOutput:
    image_bytes: bytes
    mime: str
    model: str
    provider_response_id: str | None = None


class AiImageClient(Protocol):
    """Provider abstraction so the API strategy can change without touching
    routes, gallery or designer. ``OpenAiImageApiClient`` lands in a later
    phase; only the fake is wired today."""

    def generate_plotter_image(self, request: AiImageRequest) -> AiImageOutput: ...


def _parse_size(size: str) -> tuple[int, int]:
    try:
        w, h = size.lower().split("x")
        return max(64, int(w)), max(64, int(h))
    except (ValueError, AttributeError):
        return 1024, 1024


class FakeAiImageClient:
    """Cost-free client that synthesizes a deterministic plotter-style line
    drawing. Used for local development and tests (``AI_IMAGE_FAKE=true``).

    The motif is seeded from the prompt so feedback variants visibly differ,
    and it draws long black strokes on white — exactly what the gallery trace
    pipeline is meant to vectorize.
    """

    model = "fake-plotter-1"

    def generate_plotter_image(self, request: AiImageRequest) -> AiImageOutput:
        from PIL import Image, ImageDraw

        width, height = _parse_size(request.size)
        seed = int(hashlib.sha256(request.prompt.encode()).hexdigest(), 16)
        rng = _Lcg(seed)

        img = Image.new("RGB", (width, height), "white")
        draw = ImageDraw.Draw(img)
        stroke = max(3, width // 256)
        cx, cy = width / 2, height / 2

        # A few concentric arcs plus radiating long strokes — clean contours
        # with few pen lifts, varying smoothly with the seed.
        rings = 3 + rng.below(3)
        for i in range(rings):
            r = (0.18 + 0.22 * i + 0.05 * rng.unit()) * min(width, height)
            box = (cx - r, cy - r, cx + r, cy + r)
            start = rng.below(360)
            draw.arc(box, start, start + 200 + rng.below(140), fill="black", width=stroke)

        spokes = 5 + rng.below(4)
        for i in range(spokes):
            ang = (2 * math.pi * i / spokes) + rng.unit() * 0.4
            r0 = 0.12 * min(width, height)
            r1 = (0.36 + 0.10 * rng.unit()) * min(width, height)
            draw.line(
                (cx + r0 * math.cos(ang), cy + r0 * math.sin(ang),
                 cx + r1 * math.cos(ang), cy + r1 * math.sin(ang)),
                fill="black", width=stroke,
            )

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return AiImageOutput(
            image_bytes=buf.getvalue(),
            mime="image/png",
            model=self.model,
            provider_response_id=f"fake-{seed % 1_000_000:06d}",
        )


class _Lcg:
    """Tiny deterministic PRNG (no global state), so the fake motif is stable
    for a given prompt without touching Python's shared random module."""

    def __init__(self, seed: int):
        self._s = seed % (2**32) or 1

    def _next(self) -> int:
        self._s = (1103515245 * self._s + 12345) % (2**31)
        return self._s

    def unit(self) -> float:
        return self._next() / (2**31)

    def below(self, n: int) -> int:
        return self._next() % max(1, n)


class OpenAiImageApiClient:
    """Real client backed by the OpenAI Image API ``edit`` endpoint.

    The reference image plus the composed plotter prompt go to ``images.edit``;
    the model returns a base64 PNG which we decode to bytes. SDK exceptions are
    translated to stable :class:`AiImageError` categories so the frontend never
    sees a raw provider error. The API key stays here, never in the response.
    """

    def __init__(self, config: AiImageConfig):
        self.config = config
        self._sdk = None

    def _client(self):
        if self._sdk is None:
            from openai import OpenAI

            self._sdk = OpenAI(
                api_key=self.config.api_key, timeout=float(self.config.timeout_seconds)
            )
        return self._sdk

    def generate_plotter_image(self, request: AiImageRequest) -> AiImageOutput:
        import base64

        import openai

        client = self._client()
        image_arg = (
            request.filename or "input.png",
            request.image_bytes,
            request.mime or "image/png",
        )
        kwargs: dict = {
            "model": self.config.model,
            "image": image_arg,
            "prompt": request.prompt,
            "size": self.config.size,
            "n": 1,
        }
        # gpt-image-1 takes a named quality; "auto" is the model default, so we
        # only forward an explicit choice. response_format must not be sent —
        # the model always returns b64_json.
        if self.config.quality and self.config.quality != "auto":
            kwargs["quality"] = self.config.quality

        try:
            resp = client.images.edit(**kwargs)
        except openai.AuthenticationError as exc:
            raise AiImageError(
                "auth_failed", "OpenAI-Schlüssel ungültig oder ohne Berechtigung."
            ) from exc
        except openai.PermissionDeniedError as exc:
            raise AiImageError("auth_failed", "OpenAI hat den Zugriff verweigert.") from exc
        except openai.RateLimitError as exc:
            raise AiImageError(
                "rate_limited", "OpenAI Rate Limit erreicht — bitte später erneut versuchen."
            ) from exc
        except openai.APITimeoutError as exc:
            raise AiImageError("timeout", "OpenAI hat zu lange gebraucht.") from exc
        except openai.BadRequestError as exc:
            message = str(exc).lower()
            if any(w in message for w in ("safety", "policy", "moderation", "rejected")):
                raise AiImageError(
                    "policy_rejected", "Bild oder Prompt wurde vom OpenAI-Filter abgelehnt."
                ) from exc
            raise AiImageError("bad_response", "OpenAI lehnte die Anfrage ab.") from exc
        except (openai.APIConnectionError, openai.APIError) as exc:
            raise AiImageError("bad_response", "OpenAI-Anfrage fehlgeschlagen.") from exc

        data = getattr(resp, "data", None) or []
        b64 = getattr(data[0], "b64_json", None) if data else None
        if not b64:
            raise AiImageError("bad_response", "OpenAI-Antwort enthielt kein Bild.")

        return AiImageOutput(
            image_bytes=base64.b64decode(b64),
            mime="image/png",
            model=self.config.model,
            provider_response_id=getattr(resp, "id", None),
        )


def make_client(config: AiImageConfig) -> AiImageClient:
    """Pick the client for the active configuration: fake when AI_IMAGE_FAKE is
    set, otherwise the real OpenAI client when a key is present."""
    if config.fake:
        return FakeAiImageClient()
    if config.api_key:
        return OpenAiImageApiClient(config)
    raise AiImageError("not_configured", "AI Designer ist nicht konfiguriert.")
