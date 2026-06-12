from __future__ import annotations

from .types import Polyline

_SEGMENTS = {
    "0": "abcfed",
    "1": "bc",
    "2": "abged",
    "3": "abgcd",
    "4": "fgbc",
    "5": "afgcd",
    "6": "afgecd",
    "7": "abc",
    "8": "abcdefg",
    "9": "abfgcd",
    "-": "g",
}


def seed_label_lines(seed: int | str, width_mm: float, height_mm: float, margin_mm: float) -> list[Polyline]:
    text = str(seed)[:16]
    scale = 3.0
    char_w = scale * 1.25
    gap = scale * 0.45
    total_w = len(text) * char_w + max(0, len(text) - 1) * gap
    x = max(margin_mm, width_mm - margin_mm - total_w)
    y = max(margin_mm, height_mm - margin_mm - scale * 2.1)
    lines: list[Polyline] = []
    for ch in text:
        lines.extend(_char_lines(ch, x, y, scale))
        x += char_w + gap
    return lines


def _char_lines(ch: str, x: float, y: float, s: float) -> list[Polyline]:
    segs = _SEGMENTS.get(ch.upper())
    if not segs:
        return _fallback_char(x, y, s)
    x0, x1 = x, x + s
    y0, y1, y2 = y, y + s, y + s * 2
    lookup = {
        "a": [(x0, y0), (x1, y0)],
        "b": [(x1, y0), (x1, y1)],
        "c": [(x1, y1), (x1, y2)],
        "d": [(x0, y2), (x1, y2)],
        "e": [(x0, y1), (x0, y2)],
        "f": [(x0, y0), (x0, y1)],
        "g": [(x0, y1), (x1, y1)],
    }
    return [lookup[seg] for seg in segs]


def _fallback_char(x: float, y: float, s: float) -> list[Polyline]:
    return [
        [(x, y), (x + s, y), (x + s, y + s * 2), (x, y + s * 2), (x, y)],
        [(x, y), (x + s, y + s * 2)],
    ]
