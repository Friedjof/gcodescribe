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


def make_client(config: AiImageConfig) -> AiImageClient:
    """Pick the client for the active configuration.

    The real OpenAI Image API client arrives in a later phase; until then a
    real key without fake mode reports a clear, machine-readable error.
    """
    if config.fake:
        return FakeAiImageClient()
    raise AiImageError(
        "not_configured",
        "Die echte OpenAI-Anbindung ist noch nicht aktiviert. "
        "Setze AI_IMAGE_FAKE=true zum Testen.",
    )
