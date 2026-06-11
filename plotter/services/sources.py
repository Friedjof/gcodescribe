from __future__ import annotations

import json
import shutil
import tempfile
import time
import uuid
from pathlib import Path

import numpy as np

from ..calibration import Calibration, data_dir
from ..drawing import load_svg_drawing, placed_gcode
from ..pipeline import (
    OFFICE_EXTENSIONS,
    PlotterError,
    convert_office_to_pdf,
    convert_pdf_to_svg_files,
    pdf_page_count,
)
from ..storage import jobs_dir
from ..trace import IMAGE_DPI, TRACE_DPI, image_lines_to_svg, rasterize_pdf_page, trace_image_to_svg
from .errors import ServiceError

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}


class SourceService:
    """Uploaded documents converted to per-page SVGs for visual placement.

    Modes:
    - ``vector``: take the vector paths from the PDF/SVG (pdftocairo).
    - ``trace``: rasterise, grayscale, detect area borders (contours).
    - ``auto``: vector first; fall back to trace when the vector result has
      no plottable lines (e.g. PDFs that only contain images).
    """

    def __init__(self, root: Path | None = None):
        self.root = root or (data_dir() / "sources")
        self.root.mkdir(parents=True, exist_ok=True)

    # -- creation ------------------------------------------------------------

    def create(self, filename: str, data: bytes, *, mode: str = "auto", detail: int = 1) -> dict:
        if mode not in ("auto", "vector", "trace", "edges", "hatch", "lines", "dots"):
            raise ServiceError(f"unknown mode: {mode}")
        suffix = Path(filename).suffix.lower()
        source_id = uuid.uuid4().hex[:12]
        src_dir = self.root / source_id
        src_dir.mkdir(parents=True)
        original = src_dir / Path(filename).name
        original.write_bytes(data)

        try:
            pages, mode_used = self._build_pages(original, src_dir, suffix, mode, detail)
        except Exception:
            shutil.rmtree(src_dir, ignore_errors=True)
            raise

        meta = {
            "id": source_id,
            "name": Path(filename).name,
            "mode": mode_used,
            "detail": detail,
            "created": time.time(),
            "pages": pages,
        }
        (src_dir / "meta.json").write_text(json.dumps(meta, indent=2))
        return meta

    def _build_pages(
        self, original: Path, src_dir: Path, suffix: str, mode: str, detail: int
    ) -> tuple[list[dict], str]:
        if suffix in IMAGE_EXTENSIONS:
            svg = src_dir / "page-0001.svg"
            if mode in ("hatch", "lines", "dots"):
                w, h = image_lines_to_svg(original, svg, dpi=IMAGE_DPI, detail=detail, mode=mode)
                return [{"n": 1, "file": svg.name, "width": w, "height": h}], mode
            w, h = trace_image_to_svg(original, svg, dpi=IMAGE_DPI, detail=detail)
            kind = "edges" if mode == "edges" else "trace"
            return [{"n": 1, "file": svg.name, "width": w, "height": h}], kind

        if suffix == ".svg":
            return [self._page_info(original, 1)], "vector"

        pdf = original
        if suffix in OFFICE_EXTENSIONS:
            pdf = convert_office_to_pdf(original, src_dir)
        elif suffix != ".pdf":
            raise PlotterError(f"Unsupported input format: {suffix}")

        if mode in ("auto", "vector"):
            pages = self._vector_pages(pdf, src_dir)
            if pages is not None:
                return pages, "vector"
            if mode == "vector":
                raise PlotterError(
                    "Das PDF enthält keine plottbaren Vektorlinien — "
                    "bitte Modus „Nachzeichnen“ verwenden."
                )
        return self._trace_pages(pdf, src_dir, detail), "trace"

    def _vector_pages(self, pdf: Path, src_dir: Path) -> list[dict] | None:
        """Vector conversion; None when the result has no plottable lines."""
        with tempfile.TemporaryDirectory(prefix="plotter-vec-") as tmp:
            try:
                svgs = convert_pdf_to_svg_files(pdf, Path(tmp), None)
            except PlotterError:
                return None
            pages = []
            for n, svg in enumerate(svgs, start=1):
                target = src_dir / f"page-{n:04d}.svg"
                shutil.copy(svg, target)
                pages.append(self._page_info(target, n))
        if all(p["lines"] == 0 for p in pages):
            for p in pages:
                (src_dir / p["file"]).unlink(missing_ok=True)
            return None
        return pages

    def _trace_pages(self, pdf: Path, src_dir: Path, detail: int) -> list[dict]:
        pages = []
        with tempfile.TemporaryDirectory(prefix="plotter-trace-") as tmp:
            for n in range(1, pdf_page_count(pdf) + 1):
                png = rasterize_pdf_page(pdf, Path(tmp), n)
                svg = src_dir / f"page-{n:04d}.svg"
                trace_image_to_svg(png, svg, dpi=TRACE_DPI, detail=detail)
                pages.append(self._page_info(svg, n))
        return pages

    @staticmethod
    def _page_info(svg: Path, n: int) -> dict:
        drawing = load_svg_drawing(svg, quantization_mm=0.5)
        return {
            "n": n,
            "file": svg.name,
            "width": round(drawing.width, 3),
            "height": round(drawing.height, 3),
            "lines": len(drawing.polylines),
        }

    # -- queries ---------------------------------------------------------------

    def list(self) -> list[dict]:
        metas = []
        for meta_file in self.root.glob("*/meta.json"):
            try:
                metas.append(json.loads(meta_file.read_text()))
            except (OSError, json.JSONDecodeError):
                continue
        return sorted(metas, key=lambda m: m.get("created", 0), reverse=True)

    def get(self, source_id: str) -> dict:
        meta_file = self.root / source_id / "meta.json"
        if not meta_file.exists():
            raise ServiceError(f"source not found: {source_id}")
        return json.loads(meta_file.read_text())

    def delete(self, source_id: str) -> None:
        shutil.rmtree(self.root / source_id, ignore_errors=True)

    def _page_svg(self, source_id: str, page: int) -> Path:
        meta = self.get(source_id)
        for p in meta["pages"]:
            if p["n"] == page:
                return self.root / source_id / p["file"]
        raise ServiceError(f"page {page} not found in source {source_id}")

    def preview(self, source_id: str, page: int, *, max_points: int = 20000) -> dict:
        drawing = load_svg_drawing(self._page_svg(source_id, page), quantization_mm=0.5)
        if drawing.is_empty():
            return {"polylines": [], "bounds": None,
                    "width": drawing.width, "height": drawing.height}
        total = sum(len(line) for line in drawing.polylines)
        step = max(total // max_points, 1)
        polylines = []
        for line in drawing.polylines:
            pts = line[::step] if step > 1 else line
            if step > 1 and not np.isclose(pts[-1], line[-1]):
                pts = np.append(pts, line[-1])
            polylines.append([[round(p.real, 2), round(p.imag, 2)] for p in pts])
        b = drawing.bounds()
        return {
            "polylines": polylines,
            "bounds": [round(v, 3) for v in b],
            "width": round(drawing.width, 3),
            "height": round(drawing.height, 3),
        }

    # -- gcode generation --------------------------------------------------------

    def generate_gcode(
        self, source_id: str, page: int, *, x: float, y: float, width: float
    ) -> Path:
        meta = self.get(source_id)
        cal = Calibration.load()
        drawing = load_svg_drawing(self._page_svg(source_id, page), quantization_mm=0.15)
        stem = Path(meta["name"]).stem
        name = f"{stem}-p{page}-{int(time.time())}.gcode"
        gcode = placed_gcode(drawing, cal, x=x, y=y, width=width, name=name)
        out = jobs_dir() / name
        out.write_text(gcode)
        return out
