"""Single-line font registry and loading.

Fonts are vendored under ``plotter/fonts/`` and loaded by path (no system font
lookup) so rendering is deterministic across machines.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from fontTools.ttLib import TTFont

from plotter.artwork.pipeline import PlotterError
from plotter.text.humanize import Humanize, Warp, WordJitter

_FONT_DIR = Path(__file__).resolve().parent.parent / "fonts"


# Registry: font key -> file under plotter/fonts/. Caveat is a filled TTF;
# its centreline is extracted for plotting. The other files are single-line OTFs.
FONT_FILES = {
    "sans": "ReliefSingleLineOTF-SVG-Regular.otf",
    "hand": "ReliefSingleLineOTF-SVG-Regular.otf",
    "script": "MistralSingleLine-Regular.otf",
    "lotti": "Caveat-Static600.ttf",
    "pippa": "MistralSingleLine-Regular.otf",
    "milo": "ReliefSingleLineOTF-SVG-Regular.otf",
    "nelly": "MistralSingleLine-Regular.otf",
    "theo": "ReliefSingleLineOTF-SVG-Regular.otf",
}

# Fonts that apply hand-printed humanization on top of their base file.
FONT_HUMANIZE = {
    "hand": Humanize(),
    "lotti": Humanize(rotate_deg=2, scale_var=0.04, baseline=0.018, advance=0.02),
    "pippa": Humanize(rotate_deg=3, scale_var=0.05, baseline=0.02, advance=0.02),
    "milo": Humanize(rotate_deg=5, scale_var=0.08, baseline=0.035, advance=0.01),
    "nelly": Humanize(rotate_deg=1.5, scale_var=0.03, baseline=0.012, advance=0.03),
    "theo": Humanize(rotate_deg=0.8, scale_var=0.015, baseline=0.006, advance=0.04),
}

# Cursive fonts: join consecutive letters of a word into one continuous path so
# each word plots as a single pen-down (huge pen-lift reduction). We chain each
# letter's main stroke through a curved Bézier connector; dots/accents/crossbars
# are collected as separate "marks" plotted after the main paths.
FONT_CONNECT = {"script", "pippa", "nelly"}

# Fonts whose true single-line geometry lives in the OpenType SVG table (one open
# <path> per glyph) rather than the CFF/glyf outline. The CFF in these fonts is a
# *doubled* thin outline; the SVG table is the genuine single centreline.
FONT_SVG = {"sans", "hand", "script", "pippa", "milo", "nelly", "theo"}

FONT_CENTERLINE = {"lotti"}


# Cursive fonts get per-word humanization keyed here.
FONT_WORD_JITTER = {
    "script": WordJitter(),
    "pippa": WordJitter(rotate_deg=3, scale=0.05, baseline=0.02),
    "nelly": WordJitter(rotate_deg=1.5, scale=0.03, baseline=0.012),
}


FONT_WARP = {"script": Warp(), "pippa": Warp(), "nelly": Warp(y=0.012, x=0.005)}

def font_path(font: str) -> Path:
    name = FONT_FILES.get(font)
    if name is None:
        # Lazy import: plotter.services.fonts imports back into plotter.text.
        from plotter.services.fonts import user_font_path

        path = user_font_path(font)
        if path is None:
            raise PlotterError(f"Unbekannte Schrift: {font}")
        return path
    path = _FONT_DIR / name
    if not path.exists():
        raise PlotterError(f"Schriftdatei fehlt: {name}")
    return path


@lru_cache(maxsize=8)
def load_font(font: str) -> TTFont:
    return TTFont(str(font_path(font)))


def use_centerline(font: str) -> bool:
    if font in FONT_CENTERLINE:
        return True
    if font in FONT_FILES:
        return False
    try:
        from plotter.services.fonts import PLOTTER_MODE, user_font_mode
    except ImportError:
        return False
    return user_font_mode(font) == PLOTTER_MODE
