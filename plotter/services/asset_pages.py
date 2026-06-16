"""Shared document → pages rendering core for uploaded assets.

Converts an uploaded file (image / SVG / PDF / Office) into one or more page
SVGs in a destination directory, with disk-cached previews and thumbnails. Used
by the source store today and, as the gallery absorbs sources (merge plan
stage 5), by the gallery store too — hence free functions rather than a base
class tied to either store.
"""
from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path

import numpy as np

from ..drawing import load_svg_drawing
from ..pipeline import (
    OFFICE_EXTENSIONS,
    PlotterError,
    convert_office_to_pdf,
    convert_pdf_to_svg_files,
    pdf_page_count,
)
from ..trace import (
    IMAGE_DPI,
    TRACE_DPI,
    centerline_image_to_drawing,
    image_lines_to_drawing,
    rasterize_pdf_page,
    trace_image_to_drawing,
)

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}
VALID_MODES = ("auto", "vector", "trace", "edges", "hatch", "lines", "dots", "handwriting")

# Point caps for the cached views. PREVIEW_POINTS must match the placement
# canvas request and DESIGNER_POINTS the designer import, so both pre-rendered
# caches are hit on first use instead of re-parsing the (potentially huge) SVG.
PREVIEW_POINTS = 6000
DESIGNER_POINTS = 20000
THUMB_POINTS = 500


def render_drawing(drawing, max_points: int) -> dict:
    """Downsample a parsed drawing to <= max_points and serialise to polylines."""
    if drawing.is_empty():
        return {"polylines": [], "bounds": None,
                "width": drawing.width, "height": drawing.height}
    total = sum(len(line) for line in drawing.polylines)
    step = max(total // max_points, 1)
    polylines = []
    for line in drawing.polylines:
        pts = line[::step] if step > 1 else line
        if step > 1 and pts[-1] != line[-1]:
            pts = np.append(pts, line[-1])
        # Round + serialise via numpy (C level) instead of a per-point Python
        # loop — the latter dominated render time for dense traces.
        xy = np.round(np.stack((pts.real, pts.imag), axis=1), 2)
        polylines.append(xy.tolist())
    b = drawing.bounds()
    return {
        "polylines": polylines,
        "bounds": [round(v, 3) for v in b],
        "width": round(drawing.width, 3),
        "height": round(drawing.height, 3),
    }


def write_cache(path: Path, data: dict) -> None:
    try:
        path.write_text(json.dumps(data))
    except OSError:
        pass


def page_meta(svg: Path, n: int, dst_dir: Path, *, drawing=None) -> dict:
    """Parse a page once and derive everything: metadata, the rail thumbnail
    (page 1) and both preview caches — so the thumbnail and first preview
    requests never re-parse the same (possibly multi-MB) SVG.

    Traced pages pass ``drawing`` (already in memory) to skip the vpype re-parse.
    """
    if drawing is None:
        drawing = load_svg_drawing(svg, quantization_mm=0.5)
    meta = {
        "n": n,
        "file": svg.name,
        "width": round(drawing.width, 3),
        "height": round(drawing.height, 3),
        "lines": len(drawing.polylines),
    }
    write_cache(
        dst_dir / f"preview-p{n}-{PREVIEW_POINTS}.json", render_drawing(drawing, PREVIEW_POINTS)
    )
    write_cache(
        dst_dir / f"preview-p{n}-{DESIGNER_POINTS}.json", render_drawing(drawing, DESIGNER_POINTS)
    )
    if n == 1:
        write_cache(dst_dir / "thumb.json", render_drawing(drawing, THUMB_POINTS))
    return meta


def _vector_pages(pdf: Path, dst_dir: Path) -> list[dict] | None:
    """Vector conversion; None when the result has no plottable lines."""
    with tempfile.TemporaryDirectory(prefix="plotter-vec-") as tmp:
        try:
            svgs = convert_pdf_to_svg_files(pdf, Path(tmp), None)
        except PlotterError:
            return None
        pages = []
        for n, svg in enumerate(svgs, start=1):
            target = dst_dir / f"page-{n:04d}.svg"
            shutil.copy(svg, target)
            pages.append(page_meta(target, n, dst_dir))
    if all(p["lines"] == 0 for p in pages):
        for p in pages:
            (dst_dir / p["file"]).unlink(missing_ok=True)
        return None
    return pages


def _trace_pages(pdf: Path, dst_dir: Path, detail: int, *, centerline: bool = False) -> list[dict]:
    convert = centerline_image_to_drawing if centerline else trace_image_to_drawing
    pages = []
    with tempfile.TemporaryDirectory(prefix="plotter-trace-") as tmp:
        for n in range(1, pdf_page_count(pdf) + 1):
            png = rasterize_pdf_page(pdf, Path(tmp), n)
            svg = dst_dir / f"page-{n:04d}.svg"
            drawing = convert(png, svg, dpi=TRACE_DPI, detail=detail)
            pages.append(page_meta(svg, n, dst_dir, drawing=drawing))
    return pages


def build_pages(
    original: Path, dst_dir: Path, suffix: str, mode: str, detail: int
) -> tuple[list[dict], str]:
    """Convert an uploaded file into page SVGs under dst_dir; returns the page
    metas and the mode actually used. ``mode`` is assumed valid (see VALID_MODES)."""
    if suffix in IMAGE_EXTENSIONS:
        svg = dst_dir / "page-0001.svg"
        if mode in ("hatch", "lines", "dots"):
            drawing = image_lines_to_drawing(original, svg, dpi=IMAGE_DPI, detail=detail, mode=mode)
            return [page_meta(svg, 1, dst_dir, drawing=drawing)], mode
        if mode == "handwriting":
            # Centreline trace: follow the ink's medial axis so handwriting is
            # drawn as single strokes instead of doubled outlines.
            drawing = centerline_image_to_drawing(original, svg, dpi=IMAGE_DPI, detail=detail)
            return [page_meta(svg, 1, dst_dir, drawing=drawing)], mode
        drawing = trace_image_to_drawing(original, svg, dpi=IMAGE_DPI, detail=detail)
        kind = "edges" if mode == "edges" else "trace"
        return [page_meta(svg, 1, dst_dir, drawing=drawing)], kind

    if suffix == ".svg":
        return [page_meta(original, 1, dst_dir)], "vector"

    pdf = original
    if suffix in OFFICE_EXTENSIONS:
        pdf = convert_office_to_pdf(original, dst_dir)
    elif suffix != ".pdf":
        raise PlotterError(f"Nicht unterstütztes Eingabeformat: {suffix}")

    if mode in ("auto", "vector"):
        pages = _vector_pages(pdf, dst_dir)
        if pages is not None:
            return pages, "vector"
        if mode == "vector":
            raise PlotterError(
                "Das PDF enthält keine plottbaren Vektorlinien — "
                "bitte Modus „Nachzeichnen“ verwenden."
            )
    if mode == "handwriting":
        return _trace_pages(pdf, dst_dir, detail, centerline=True), "handwriting"
    return _trace_pages(pdf, dst_dir, detail), "trace"


def preview_for(dst_dir: Path, page_file: str, page: int, max_points: int) -> dict:
    """Cached downsampled preview of one page (renders + caches on miss)."""
    cache = dst_dir / f"preview-p{page}-{max_points}.json"
    if cache.exists():
        try:
            return json.loads(cache.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    drawing = load_svg_drawing(dst_dir / page_file, quantization_mm=0.5)
    data = render_drawing(drawing, max_points)
    write_cache(cache, data)
    return data


def thumbnail_for(dst_dir: Path, page_file: str, max_points: int = THUMB_POINTS) -> dict:
    """Cached light preview of page 1 for rails/grids (legacy re-parse on miss)."""
    cache = dst_dir / "thumb.json"
    if cache.exists():
        try:
            return json.loads(cache.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    drawing = load_svg_drawing(dst_dir / page_file, quantization_mm=1.5)
    data = render_drawing(drawing, max_points)
    write_cache(cache, data)
    return data
