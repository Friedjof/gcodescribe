"""Building and rebuilding gallery items from uploads.

Admin assets render documents to page SVGs without an upfront score; public
submissions are traced, fitted and scored against the active profile.
"""

from __future__ import annotations

import shutil
import time
from pathlib import Path

from plotter.artwork.drawing import load_svg_drawing
from plotter.artwork.pipeline import PlotterError
from plotter.artwork.trace import IMAGE_DPI, trace_image_to_svg
from plotter.core.calibration import Calibration
from plotter.core.jobmeta import profile_comment
from plotter.gcode.metrics import evaluate_gcode
from plotter.services.asset_pages import build_pages
from plotter.services.gallery.common import (
    GCODE_FILE,
    SVG_FILE,
    clear_derived,
    copy_preview_caches,
    fitted_gcode,
    original_meta,
)
from plotter.services.gallery.previews import write_preview_cache
from plotter.services.profiles import ProfileService, profile_meta
from plotter.services.upload_validation import MAX_GCODE_BYTES, UploadTooLarge


def build_asset(
    item_dir: Path, filename: str, data: bytes, kind: str, title: str,
    item_id: str, mode: str, detail: int,
) -> dict:
    """Admin document/image → page SVGs (no upfront score)."""
    suffix = Path(filename).suffix.lower()
    original = item_dir / f"original{suffix}"
    original.write_bytes(data)
    pages, mode_used = build_pages(original, item_dir, suffix, mode, detail)
    if kind == "xopp" and len(pages) != 1:
        raise PlotterError("Bitte Xournal++-Seiten vor dem Import auswählen.")
    first = pages[0]
    return {
        "id": item_id,
        "title": title,
        "filename": filename,
        "kind": kind,
        "uploader": "admin",
        "created": time.time(),
        "status": "active",
        "mode": mode_used,
        "detail": detail,
        "continuous": kind != "xopp",
        "pages": pages,
        "width": first["width"],
        "height": first["height"],
        "lines": first["lines"],
        "original": original_meta(filename, original.name, kind, len(data)),
    }


def build_submission(
    item_dir: Path, filename: str, data: bytes, kind: str, title: str, item_id: str,
) -> dict:
    original = item_dir / f"original.{kind if kind != 'jpeg' else 'jpg'}"
    original.write_bytes(data)

    svg = item_dir / SVG_FILE
    if kind == "svg":
        svg.write_bytes(data)
    else:
        trace_image_to_svg(original, svg, dpi=IMAGE_DPI, detail=2)

    drawing = load_svg_drawing(svg, quantization_mm=0.25)
    if drawing.is_empty():
        raise PlotterError("Das Bild enthält keine plottbaren Linien.")
    write_preview_cache(item_dir, drawing)

    profile = ProfileService().active()
    active_meta = profile_meta(profile)
    cal = Calibration.from_dict(profile["calibration"])
    gcode = profile_comment(active_meta) + fitted_gcode(drawing, cal, name=filename)
    if len(gcode.encode()) > MAX_GCODE_BYTES:
        raise UploadTooLarge(
            "Der erzeugte G-code überschreitet "
            f"{MAX_GCODE_BYTES // (1024 * 1024)} MB — das Motiv ist zu komplex."
        )
    (item_dir / GCODE_FILE).write_text(gcode)

    width = round(drawing.width, 3)
    height = round(drawing.height, 3)
    lines = len(drawing.polylines)
    return {
        "id": item_id,
        "title": title,
        "filename": filename,
        "kind": kind,
        "uploader": "public",
        "created": time.time(),
        "status": "active",
        "mode": "vector" if kind == "svg" else "trace",
        "detail": 2,
        "continuous": True,
        "pages": [
            {"n": 1, "file": SVG_FILE, "width": width, "height": height, "lines": lines}
        ],
        "width": width,
        "height": height,
        "lines": lines,
        "original": original_meta(filename, original.name, kind, len(data)),
        "profile": active_meta,
        **evaluate_gcode(gcode, MAX_GCODE_BYTES),
    }


def rerender_asset(
    meta: dict,
    item_dir: Path,
    tmp: Path,
    pages: list[dict],
    mode: str,
    detail: int,
    continuous: bool = True,
) -> dict:
    clear_derived(item_dir)
    for page in pages:
        src = tmp / page["file"]
        dst = item_dir / page["file"]
        if src.resolve() != dst.resolve():
            shutil.copy(src, dst)
    copy_preview_caches(tmp, item_dir)
    first = pages[0]
    updated = dict(meta)
    for key in ("score", "metrics", "profile"):
        updated.pop(key, None)
    updated.update(
        {
            "mode": mode,
            "detail": detail,
            "continuous": continuous,
            "pages": pages,
            "width": first["width"],
            "height": first["height"],
            "lines": first["lines"],
        }
    )
    return updated


def rerender_submission(
    meta: dict,
    item_dir: Path,
    tmp: Path,
    pages: list[dict],
    mode: str,
    detail: int,
    continuous: bool = True,
) -> dict:
    page = pages[0]
    rendered = tmp / page["file"]
    drawing = load_svg_drawing(rendered, quantization_mm=0.25)
    if drawing.is_empty():
        raise PlotterError("Das Bild enthält keine plottbaren Linien.")

    profile = ProfileService().active()
    active_meta = profile_meta(profile)
    cal = Calibration.from_dict(profile["calibration"])
    gcode = profile_comment(active_meta) + fitted_gcode(
        drawing, cal, name=meta.get("filename") or meta["id"], continuous=continuous
    )
    if len(gcode.encode()) > MAX_GCODE_BYTES:
        raise UploadTooLarge(
            "Der erzeugte G-code überschreitet "
            f"{MAX_GCODE_BYTES // (1024 * 1024)} MB — das Motiv ist zu komplex."
        )

    clear_derived(item_dir)
    shutil.copy(rendered, item_dir / SVG_FILE)
    write_preview_cache(item_dir, drawing)
    (item_dir / GCODE_FILE).write_text(gcode)
    width = round(drawing.width, 3)
    height = round(drawing.height, 3)
    lines = len(drawing.polylines)
    updated = dict(meta)
    updated.update(
        {
            "mode": mode,
            "detail": detail,
            "continuous": continuous,
            "pages": [
                {"n": 1, "file": SVG_FILE, "width": width, "height": height, "lines": lines}
            ],
            "width": width,
            "height": height,
            "lines": lines,
            "profile": active_meta,
            **evaluate_gcode(gcode, MAX_GCODE_BYTES),
        }
    )
    return updated
