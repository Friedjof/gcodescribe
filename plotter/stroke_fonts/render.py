"""Render a stroke-font document + text to plottable polylines.

Output is in millimetres, y-down (the same editor space the file-font renderer in
``plotter/singleline.py`` produces), so the result drops straight into the
existing scene/plot pipeline. Kept separate from ``singleline.py`` on purpose —
stroke fonts have their own data and geometry.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field

from .matching import missing_characters, tokenize
from .model import _error
from .speed import feed_scales


@dataclass
class StrokeRenderResult:
    polylines: list[list[list[float]]] = field(default_factory=list)
    # Per-polyline feed *scales* (relative to the draw feed), one per point. The
    # plotter turns these into safe absolute feedrates at G-code time.
    feeds: list[list[float]] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)


def _choose_variant(glyph: dict, rng: random.Random) -> dict | None:
    variants = glyph.get("variants") or []
    if not variants:
        return None
    weights = [max(float(v.get("weight", 1.0)), 0.0) for v in variants]
    total = sum(weights)
    if total <= 0:
        return variants[0]
    r = rng.random() * total
    acc = 0.0
    for variant, weight in zip(variants, weights, strict=True):
        acc += weight
        if r <= acc:
            return variant
    return variants[-1]


def render_text(
    document: dict,
    text: str,
    size: float,
    *,
    seed: int = 0,
) -> StrokeRenderResult:
    if size <= 0:
        raise _error("Schriftgröße muss größer als 0 sein")
    result = StrokeRenderResult()
    if not text:
        return result

    metrics = document.get("metrics") or {}
    em = float(metrics.get("em") or 1000)
    scale = size / em
    ascender = float(metrics.get("ascender", em * 0.78))
    descender = float(metrics.get("descender", -em * 0.23))
    default_advance = float(metrics.get("defaultAdvance", em * 0.56))
    word_spacing = float(metrics.get("wordSpacing", default_advance * 0.5))
    line_height = (ascender - descender) * scale * 1.25

    glyph_map = {g["key"]: g for g in document.get("glyphs", [])}
    tokens = tokenize(text, glyph_map.keys())
    result.missing = missing_characters(tokens)
    rng = random.Random(seed)

    cursor_x = 0.0  # advance position in em
    line_top = 0.0  # y-down mm offset of the current line

    def to_mm(px: float, py: float) -> list[float]:
        # em y-up → editor y-down: baseline sits at ascender*scale below the top.
        return [(cursor_x + px) * scale, line_top + (ascender - py) * scale]

    for token in tokens:
        if token.kind == "newline":
            cursor_x = 0.0
            line_top += line_height
            continue
        if token.kind == "space":
            cursor_x += word_spacing
            continue
        if token.kind == "missing":
            cursor_x += default_advance
            continue

        glyph = glyph_map[token.value]
        variant = _choose_variant(glyph, rng)
        # Side bearings come from the chosen variant, falling back to a
        # glyph-level value (older fonts) and finally the metric defaults.
        spacing_before = None
        advance_val = None
        if variant is not None:
            if variant.get("spacingBefore") is not None:
                spacing_before = variant["spacingBefore"]
            if variant.get("advance") is not None:
                advance_val = variant["advance"]
        if spacing_before is None:
            spacing_before = glyph.get("spacingBefore") or 0.0
        if advance_val is None:
            advance_val = glyph.get("advance") or default_advance
        cursor_x += float(spacing_before)
        advance = float(advance_val)
        if variant is not None:
            for stroke in variant.get("strokes") or []:
                pts = stroke.get("points") or stroke.get("rawPoints") or []
                if not pts:
                    continue
                polyline = [to_mm(p.get("x", 0.0), p.get("y", 0.0)) for p in pts]
                result.polylines.append(polyline)
                result.feeds.append(feed_scales(pts))
        cursor_x += advance

    return result
