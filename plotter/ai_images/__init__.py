"""AI image designer: turn an uploaded reference image into a plotter-ready
line drawing, persisted as a normal admin gallery asset.

The package is intentionally small and layered so OpenAI-specific code never
leaks into routes, gallery or designer:

- :mod:`config`  — env evaluation and feature status (source of truth).
- :mod:`prompts` — default style prompt and prompt composition.
- :mod:`client`  — provider abstraction (``FakeAiImageClient`` for now).
- :mod:`quality` — line/point heuristics over the traced preview.
- :mod:`service` — the ``generate`` use case wiring it all to the gallery.
"""

from .config import AiImageConfig, load_config
from .errors import AiImageError

__all__ = ["AiImageConfig", "AiImageError", "load_config"]
