"""Shared constants and file-level helpers of the gallery package."""

from __future__ import annotations

import mimetypes
import shutil
from pathlib import Path

from plotter.artwork.drawing import placed_gcode
from plotter.artwork.pipeline import PlotterError
from plotter.core.calibration import Calibration

MAX_TITLE_LEN = 80
SVG_FILE = "image.svg"
GCODE_FILE = "job.gcode"
SVG_PREVIEW_FILE = "preview-svg.json"
SVG_THUMB_FILE = "preview-thumb.json"
FULL_PREVIEW_POINTS = 20000
THUMB_PREVIEW_POINTS = 1200

_ORIGINAL_MIME = {
    "svg": "image/svg+xml",
    "png": "image/png",
    "jpeg": "image/jpeg",
    "jpg": "image/jpeg",
    "pdf": "application/pdf",
    "xopp": "application/x-xopp",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "stl": "model/stl",
}


def original_meta(filename: str, stored: str, kind: str, size: int) -> dict:
    mime = (
        _ORIGINAL_MIME.get(kind)
        or mimetypes.guess_type(filename)[0]
        or "application/octet-stream"
    )
    return {
        "filename": filename,
        "stored": stored,
        "kind": kind,
        "mime": mime,
        "size": size,
    }


def fitted_gcode(drawing, cal: Calibration, *, name: str, continuous: bool = True,
                 preserve_order: bool = False) -> str:
    """G-code with the drawing scaled to fill the calibrated plot area."""
    bx0, by0, bx1, by1 = drawing.bounds()
    bw, bh = bx1 - bx0, by1 - by0
    if bw <= 0 or bh <= 0:
        raise PlotterError("Das Bild enthält keine plottbare Fläche.")
    scale = min(cal.plot_width / bw, cal.plot_height / bh)
    return placed_gcode(
        drawing, cal, x=cal.origin_x, y=cal.origin_y, width=bw * scale,
        name=name, continuous=continuous, preserve_order=preserve_order,
    )


def clear_derived(item_dir: Path) -> None:
    """Remove every derived artifact, keeping the stored original untouched."""
    for pattern in (
        SVG_FILE,
        GCODE_FILE,
        SVG_PREVIEW_FILE,
        SVG_THUMB_FILE,
        "page-*.svg",
        "preview-p*.json",
        "thumb.json",
    ):
        for path in item_dir.glob(pattern):
            path.unlink(missing_ok=True)


def copy_preview_caches(src: Path, dst: Path) -> None:
    for pattern in ("preview-p*.json", "thumb.json"):
        for path in src.glob(pattern):
            shutil.copy(path, dst / path.name)
