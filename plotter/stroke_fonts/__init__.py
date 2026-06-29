"""Stroke fonts: user-drawn handwriting stored as plottable stroke data.

Unlike classic ``.otf/.ttf`` fonts (handled in ``plotter/services/fonts.py`` and
``plotter/singleline.py``), stroke fonts keep the actual writing movement —
stroke order, points, timing, pressure — so the plotter can reproduce how the
text was written. The modules here stay deliberately separate from the file-font
code so neither side destabilizes the other.
"""

from __future__ import annotations

from .model import (
    SCHEMA_VERSION,
    StrokeFontMetrics,
    normalize_document,
    summarize,
)

__all__ = [
    "SCHEMA_VERSION",
    "StrokeFontMetrics",
    "normalize_document",
    "summarize",
]
