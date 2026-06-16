from __future__ import annotations

import json
import shutil
import time
import uuid
from pathlib import Path

from ..calibration import Calibration, data_dir
from ..drawing import load_svg_drawing, placed_gcode
from ..storage import jobs_dir
from .asset_pages import THUMB_POINTS, VALID_MODES, build_pages, preview_for, thumbnail_for
from .errors import ServiceError


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
        if mode not in VALID_MODES:
            raise ServiceError(f"Unbekannter Modus: {mode}")
        suffix = Path(filename).suffix.lower()
        source_id = uuid.uuid4().hex[:12]
        src_dir = self.root / source_id
        src_dir.mkdir(parents=True)
        original = src_dir / Path(filename).name
        original.write_bytes(data)

        try:
            pages, mode_used = build_pages(original, src_dir, suffix, mode, detail)
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
        svg = self._page_svg(source_id, page)
        return preview_for(svg.parent, svg.name, page, max_points)

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
        svg = self._page_svg(source_id, 1)
        return thumbnail_for(svg.parent, svg.name, max_points)

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
