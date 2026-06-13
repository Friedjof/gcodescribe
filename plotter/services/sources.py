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
from ..trace import (
    IMAGE_DPI,
    TRACE_DPI,
    centerline_image_to_drawing,
    image_lines_to_drawing,
    rasterize_pdf_page,
    trace_image_to_drawing,
)
from .errors import ServiceError

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}

# Point caps for the cached views. PREVIEW_POINTS must match the placement
# canvas request and DESIGNER_POINTS the designer import, so both pre-rendered
# caches are hit on first use instead of re-parsing the (potentially huge) SVG.
PREVIEW_POINTS = 6000
DESIGNER_POINTS = 20000
THUMB_POINTS = 500


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
        valid_modes = ("auto", "vector", "trace", "edges", "hatch", "lines", "dots", "handwriting")
        if mode not in valid_modes:
            raise ServiceError(f"Unbekannter Modus: {mode}")
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
                drawing = image_lines_to_drawing(
                    original, svg, dpi=IMAGE_DPI, detail=detail, mode=mode
                )
                return [self._page_meta(svg, 1, src_dir, drawing=drawing)], mode
            if mode == "handwriting":
                # Centreline trace: follow the ink's medial axis so handwriting
                # is drawn as single strokes instead of doubled outlines.
                drawing = centerline_image_to_drawing(original, svg, dpi=IMAGE_DPI, detail=detail)
                return [self._page_meta(svg, 1, src_dir, drawing=drawing)], mode
            drawing = trace_image_to_drawing(original, svg, dpi=IMAGE_DPI, detail=detail)
            kind = "edges" if mode == "edges" else "trace"
            return [self._page_meta(svg, 1, src_dir, drawing=drawing)], kind

        if suffix == ".svg":
            return [self._page_meta(original, 1, src_dir)], "vector"

        pdf = original
        if suffix in OFFICE_EXTENSIONS:
            pdf = convert_office_to_pdf(original, src_dir)
        elif suffix != ".pdf":
            raise PlotterError(f"Nicht unterstütztes Eingabeformat: {suffix}")

        if mode in ("auto", "vector"):
            pages = self._vector_pages(pdf, src_dir)
            if pages is not None:
                return pages, "vector"
            if mode == "vector":
                raise PlotterError(
                    "Das PDF enthält keine plottbaren Vektorlinien — "
                    "bitte Modus „Nachzeichnen“ verwenden."
                )
        if mode == "handwriting":
            return self._trace_pages(pdf, src_dir, detail, centerline=True), "handwriting"
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
                pages.append(self._page_meta(target, n, src_dir))
        if all(p["lines"] == 0 for p in pages):
            for p in pages:
                (src_dir / p["file"]).unlink(missing_ok=True)
            return None
        return pages

    def _trace_pages(
        self, pdf: Path, src_dir: Path, detail: int, *, centerline: bool = False
    ) -> list[dict]:
        convert = centerline_image_to_drawing if centerline else trace_image_to_drawing
        pages = []
        with tempfile.TemporaryDirectory(prefix="plotter-trace-") as tmp:
            for n in range(1, pdf_page_count(pdf) + 1):
                png = rasterize_pdf_page(pdf, Path(tmp), n)
                svg = src_dir / f"page-{n:04d}.svg"
                drawing = convert(png, svg, dpi=TRACE_DPI, detail=detail)
                pages.append(self._page_meta(svg, n, src_dir, drawing=drawing))
        return pages

    def _page_meta(self, svg: Path, n: int, src_dir: Path, *, drawing=None) -> dict:
        """Parse a page once and derive everything from it: metadata, the rail
        thumbnail (page 1) and both preview caches. Avoids re-parsing the same
        SVG for the thumbnail and the first preview requests.

        Traced sources pass ``drawing`` (already in memory from the trace) so we
        skip the expensive vpype re-parse of what can be a multi-MB SVG."""
        if drawing is None:
            drawing = load_svg_drawing(svg, quantization_mm=0.5)
        meta = {
            "n": n,
            "file": svg.name,
            "width": round(drawing.width, 3),
            "height": round(drawing.height, 3),
            "lines": len(drawing.polylines),
        }
        # Cache both the placement-canvas (6000) and designer-import (20000)
        # previews so neither tab triggers a fresh parse on first selection.
        self._write_cache(src_dir / f"preview-p{n}-{PREVIEW_POINTS}.json",
                          self._render(drawing, PREVIEW_POINTS))
        self._write_cache(src_dir / f"preview-p{n}-{DESIGNER_POINTS}.json",
                          self._render(drawing, DESIGNER_POINTS))
        if n == 1:
            self._write_cache(src_dir / "thumb.json", self._render(drawing, THUMB_POINTS))
        return meta

    @staticmethod
    def _write_cache(path: Path, data: dict) -> None:
        try:
            path.write_text(json.dumps(data))
        except OSError:
            pass

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
            raise ServiceError(f"Quelle nicht gefunden: {source_id}")
        return json.loads(meta_file.read_text())

    def delete(self, source_id: str) -> None:
        shutil.rmtree(self.root / source_id, ignore_errors=True)

    def _page_svg(self, source_id: str, page: int) -> Path:
        meta = self.get(source_id)
        for p in meta["pages"]:
            if p["n"] == page:
                return self.root / source_id / p["file"]
        raise ServiceError(f"Seite {page} in Quelle {source_id} nicht gefunden")

    def preview(self, source_id: str, page: int, *, max_points: int = 20000) -> dict:
        cache = self.root / source_id / f"preview-p{page}-{max_points}.json"
        if cache.exists():
            try:
                return json.loads(cache.read_text())
            except (json.JSONDecodeError, OSError):
                pass
        drawing = load_svg_drawing(self._page_svg(source_id, page), quantization_mm=0.5)
        data = self._render(drawing, max_points)
        self._write_cache(cache, data)
        return data

    def thumbnails(self) -> dict:
        """All rail thumbnails in one shot (cached), so the rail loads with a
        single request instead of one round-trip per source."""
        out: dict[str, dict] = {}
        for meta in self.list():
            try:
                out[meta["id"]] = self.thumbnail(meta["id"])
            except (ServiceError, OSError):
                pass
        return out

    def thumbnail(self, source_id: str, *, max_points: int = THUMB_POINTS) -> dict:
        """Light, disk-cached preview of page 1 for the file rail. Normally
        pre-rendered at upload; this only re-parses for legacy sources."""
        cache = self.root / source_id / "thumb.json"
        if cache.exists():
            try:
                return json.loads(cache.read_text())
            except (json.JSONDecodeError, OSError):
                pass
        drawing = load_svg_drawing(self._page_svg(source_id, 1), quantization_mm=1.5)
        data = self._render(drawing, max_points)
        self._write_cache(cache, data)
        return data

    @staticmethod
    def _render(drawing, max_points: int) -> dict:
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
            # Round + serialise via numpy (C level) instead of a per-point
            # Python loop — the latter dominated render time for dense traces.
            xy = np.round(np.stack((pts.real, pts.imag), axis=1), 2)
            polylines.append(xy.tolist())
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
        from ..jobmeta import profile_comment, write_job_meta
        from .profiles import ProfileService, profile_meta

        profile = ProfileService().active()
        active_meta = profile_meta(profile)
        cal = Calibration().merged(profile["calibration"])
        drawing = load_svg_drawing(self._page_svg(source_id, page), quantization_mm=0.15)
        stem = Path(meta["name"]).stem
        name = f"{stem}-p{page}-{int(time.time())}.gcode"
        gcode = placed_gcode(drawing, cal, x=x, y=y, width=width, name=name)
        out = jobs_dir() / name
        out.write_text(profile_comment(active_meta) + gcode)
        write_job_meta(
            out,
            source={"kind": "source", "source_id": source_id, "page": page},
            profile=active_meta,
        )
        return out

    def score_placement(
        self, source_id: str, page: int, *, x: float, y: float, width: float
    ) -> dict:
        """Rate a placement the same way the gallery rates submissions, by
        generating its G-code in memory (no job file written)."""
        from ..gallery_metrics import evaluate_gcode
        from .profiles import ProfileService
        from .upload_validation import MAX_GCODE_BYTES

        profile = ProfileService().active()
        cal = Calibration().merged(profile["calibration"])
        drawing = load_svg_drawing(self._page_svg(source_id, page), quantization_mm=0.15)
        gcode = placed_gcode(drawing, cal, x=x, y=y, width=width, name="score")
        return evaluate_gcode(gcode, MAX_GCODE_BYTES)
