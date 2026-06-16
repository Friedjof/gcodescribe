from __future__ import annotations

import json
import shutil
import time
import uuid
from pathlib import Path

import numpy as np

from ..calibration import Calibration, data_dir
from ..drawing import load_svg_drawing, placed_gcode
from ..gallery_metrics import evaluate_gcode
from ..jobmeta import profile_comment
from ..pipeline import PlotterError
from ..trace import IMAGE_DPI, trace_image_to_svg
from .asset_pages import (
    DESIGNER_POINTS,
    VALID_MODES,
    build_pages,
    preview_for,
    thumbnail_for,
)
from .errors import ServiceError
from .profiles import ProfileService, profile_meta
from .upload_validation import (
    MAX_GCODE_BYTES,
    MAX_UPLOAD_BYTES,
    UploadTooLarge,
    sniff_asset_kind,
    sniff_kind,
)

MAX_TITLE_LEN = 80
_SVG_FILE = "image.svg"
_GCODE_FILE = "job.gcode"
_SVG_PREVIEW_FILE = "preview-svg.json"
_SVG_THUMB_FILE = "preview-thumb.json"
_FULL_PREVIEW_POINTS = 20000
_THUMB_PREVIEW_POINTS = 1200


class GalleryService:
    """The unified asset library.

    Two kinds of upload share ``data/gallery/<id>/``:

    - **Public submissions** (``/upload`` competition, ``uploader="public"``):
      a single image/SVG, traced, fitted and **scored** for plottability —
      stored as ``image.svg`` + ``job.gcode`` (the original behaviour).
    - **Admin assets** (``uploader="admin"``): general documents (PDF/Office)
      and images rendered to one or more page SVGs via the shared
      :mod:`asset_pages` core, with **on-demand** previews and **no** upfront
      score (placement is scored later via ``pageScore``).

    Every item carries a unified ``pages`` list; uploads that bust the size
    limits are deleted immediately and never listed.
    """

    def __init__(self, root: Path | None = None):
        self.root = root or (data_dir() / "gallery")
        self.root.mkdir(parents=True, exist_ok=True)

    # -- creation --------------------------------------------------------------

    def create(
        self,
        filename: str,
        data: bytes,
        title: str = "",
        uploader: str = "public",
        *,
        mode: str = "auto",
        detail: int = 2,
    ) -> dict:
        if len(data) > MAX_UPLOAD_BYTES:
            raise UploadTooLarge(
                f"Datei zu groß — maximal {MAX_UPLOAD_BYTES // (1024 * 1024)} MB."
            )
        uploader = uploader if uploader in ("admin", "public") else "public"
        name = Path(filename).name
        title = title.strip()[:MAX_TITLE_LEN]
        # Public uploads are scored single-image competition entries; only the
        # admin library accepts documents and uses the multi-page asset path.
        if uploader == "admin":
            if mode not in VALID_MODES:
                raise ServiceError(f"Unbekannter Modus: {mode}")
            kind = sniff_asset_kind(name, data)
        else:
            kind = sniff_kind(name, data)

        item_id = uuid.uuid4().hex[:12]
        item_dir = self.root / item_id
        item_dir.mkdir(parents=True)
        try:
            if uploader == "admin":
                meta = self._build_asset(item_dir, name, data, kind, title, item_id, mode, detail)
            else:
                meta = self._build_submission(item_dir, name, data, kind, title, item_id)
        except Exception:
            shutil.rmtree(item_dir, ignore_errors=True)
            raise
        (item_dir / "meta.json").write_text(json.dumps(meta, indent=2))
        return meta

    def _build_asset(
        self, item_dir: Path, filename: str, data: bytes, kind: str, title: str,
        item_id: str, mode: str, detail: int,
    ) -> dict:
        """Admin document/image → page SVGs (no upfront score)."""
        suffix = Path(filename).suffix.lower()
        original = item_dir / f"original{suffix}"
        original.write_bytes(data)
        pages, mode_used = build_pages(original, item_dir, suffix, mode, detail)
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
            "pages": pages,
            "width": first["width"],
            "height": first["height"],
            "lines": first["lines"],
        }

    def _build_submission(
        self, item_dir: Path, filename: str, data: bytes, kind: str, title: str,
        item_id: str,
    ) -> dict:
        original = item_dir / f"original.{kind if kind != 'jpeg' else 'jpg'}"
        original.write_bytes(data)

        svg = item_dir / _SVG_FILE
        if kind == "svg":
            svg.write_bytes(data)
        else:
            trace_image_to_svg(original, svg, dpi=IMAGE_DPI, detail=2)

        drawing = load_svg_drawing(svg, quantization_mm=0.25)
        if drawing.is_empty():
            raise PlotterError("Das Bild enthält keine plottbaren Linien.")
        self._write_preview_cache(item_dir, drawing)

        profile = ProfileService().active()
        active_meta = profile_meta(profile)
        cal = Calibration().merged(profile["calibration"])
        gcode = profile_comment(active_meta) + self._fitted_gcode(drawing, cal, name=filename)
        if len(gcode.encode()) > MAX_GCODE_BYTES:
            raise UploadTooLarge(
                "Der erzeugte G-code überschreitet "
                f"{MAX_GCODE_BYTES // (1024 * 1024)} MB — das Motiv ist zu komplex."
            )
        (item_dir / _GCODE_FILE).write_text(gcode)

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
            "pages": [
                {"n": 1, "file": _SVG_FILE, "width": width, "height": height, "lines": lines}
            ],
            "width": width,
            "height": height,
            "lines": lines,
            "profile": active_meta,
            **evaluate_gcode(gcode, MAX_GCODE_BYTES),
        }

    @staticmethod
    def _fitted_gcode(drawing, cal: Calibration, *, name: str) -> str:
        """G-code with the drawing scaled to fill the calibrated plot area."""
        bx0, by0, bx1, by1 = drawing.bounds()
        bw, bh = bx1 - bx0, by1 - by0
        if bw <= 0 or bh <= 0:
            raise PlotterError("Das Bild enthält keine plottbare Fläche.")
        scale = min(cal.plot_width / bw, cal.plot_height / bh)
        return placed_gcode(
            drawing, cal, x=cal.origin_x, y=cal.origin_y, width=bw * scale, name=name
        )

    # -- queries ---------------------------------------------------------------

    def list(self, *, include_archived: bool = True, uploader: str | None = None) -> list[dict]:
        metas = []
        for meta_file in self.root.glob("*/meta.json"):
            try:
                meta = json.loads(meta_file.read_text())
            except (OSError, json.JSONDecodeError):
                continue
            self._normalize(meta)
            if not include_archived and meta.get("status") == "archived":
                continue
            if uploader and meta.get("uploader") != uploader:
                continue
            metas.append(meta)
        return sorted(metas, key=lambda m: m.get("created", 0), reverse=True)

    def get(self, item_id: str) -> dict:
        meta_file = self.root / item_id / "meta.json"
        if not meta_file.exists():
            raise ServiceError(f"Einreichung nicht gefunden: {item_id}")
        meta = json.loads(meta_file.read_text())
        self._normalize(meta)
        return meta

    @staticmethod
    def _normalize(meta: dict) -> None:
        """Backfill fields added after an item was written (items uploaded before
        the uploader tag existed came from the public /upload page; items from
        before the unified asset model lack ``pages``/``mode``/``detail``)."""
        meta.setdefault("uploader", "public")
        if "pages" not in meta:
            meta["pages"] = [{
                "n": 1, "file": _SVG_FILE,
                "width": meta.get("width"), "height": meta.get("height"),
                "lines": meta.get("lines"),
            }]
        meta.setdefault("mode", "vector" if meta.get("kind") == "svg" else "trace")
        meta.setdefault("detail", 2)

    @staticmethod
    def _page_entry(meta: dict, page: int) -> dict:
        for p in meta.get("pages", []):
            if p["n"] == page:
                return p
        raise ServiceError(f"Seite {page} in Galerie-Eintrag {meta['id']} nicht gefunden")

    def gcode_path(self, item_id: str) -> Path:
        path = self.root / item_id / _GCODE_FILE
        if not path.exists():
            raise ServiceError(f"Einreichung nicht gefunden: {item_id}")
        return path

    def svg_preview(self, item_id: str, *, max_points: int = _FULL_PREVIEW_POINTS) -> dict:
        """Polylines of the derived SVG (mm, y down) for safe 2D rendering."""
        item_dir = self.root / item_id
        cache = item_dir / (
            _SVG_THUMB_FILE if max_points <= _THUMB_PREVIEW_POINTS else _SVG_PREVIEW_FILE
        )
        if cache.exists():
            try:
                return json.loads(cache.read_text())
            except (OSError, json.JSONDecodeError):
                cache.unlink(missing_ok=True)

        svg = self.root / item_id / _SVG_FILE
        if not svg.exists():
            raise ServiceError(f"Einreichung nicht gefunden: {item_id}")
        drawing = load_svg_drawing(svg, quantization_mm=0.5)
        preview = self._preview_from_drawing(drawing, max_points=max_points)
        cache.write_text(json.dumps(preview))
        return preview

    def svg_thumbnail(self, item_id: str) -> dict:
        return self.svg_preview(item_id, max_points=_THUMB_PREVIEW_POINTS)

    def preview(self, item_id: str, page: int = 1, *, max_points: int = DESIGNER_POINTS) -> dict:
        """On-demand downsampled preview of one page, for any item type.

        Single-image submissions keep their ``image.svg`` cache; multi-page
        admin assets go through the shared :mod:`asset_pages` page cache.
        """
        meta = self.get(item_id)
        entry = self._page_entry(meta, page)
        if entry["file"] == _SVG_FILE:
            return self.svg_preview(item_id, max_points=max_points)
        return preview_for(self.root / item_id, entry["file"], page, max_points)

    def thumbnail(self, item_id: str) -> dict:
        """Page-1 grid thumbnail for any item type."""
        meta = self.get(item_id)
        entry = self._page_entry(meta, 1)
        if entry["file"] == _SVG_FILE:
            return self.svg_thumbnail(item_id)
        return thumbnail_for(self.root / item_id, entry["file"])

    def svg_thumbnails(self) -> dict:
        """All grid thumbnails in one shot (disk-cached), so the gallery loads
        with a single request instead of one round-trip per card."""
        out: dict[str, dict] = {}
        for meta in self.list(include_archived=True):
            try:
                out[meta["id"]] = self.thumbnail(meta["id"])
            except (ServiceError, OSError):
                pass
        return out

    def _write_preview_cache(self, item_dir: Path, drawing) -> None:
        (item_dir / _SVG_PREVIEW_FILE).write_text(
            json.dumps(self._preview_from_drawing(drawing, max_points=_FULL_PREVIEW_POINTS))
        )
        (item_dir / _SVG_THUMB_FILE).write_text(
            json.dumps(self._preview_from_drawing(drawing, max_points=_THUMB_PREVIEW_POINTS))
        )

    @staticmethod
    def _preview_from_drawing(drawing, *, max_points: int) -> dict:
        total = sum(len(line) for line in drawing.polylines)
        step = max(total // max_points, 1)
        polylines = []
        for line in drawing.polylines:
            pts = line[::step] if step > 1 else line
            if step > 1 and not np.isclose(pts[-1], line[-1]):
                pts = np.append(pts, line[-1])
            polylines.append([[round(p.real, 2), round(p.imag, 2)] for p in pts])
        return {
            "polylines": polylines,
            "width": round(drawing.width, 3),
            "height": round(drawing.height, 3),
        }

    # -- mutation ----------------------------------------------------------------

    def set_status(self, item_id: str, status: str) -> dict:
        if status not in ("active", "archived"):
            raise ServiceError(f"Unbekannter Status: {status}")
        return self._update_meta(item_id, status=status)

    def set_title(self, item_id: str, title: str) -> dict:
        return self._update_meta(item_id, title=title.strip()[:MAX_TITLE_LEN])

    def _update_meta(self, item_id: str, **fields) -> dict:
        meta = self.get(item_id)
        meta.update(fields)
        (self.root / item_id / "meta.json").write_text(json.dumps(meta, indent=2))
        return meta

    def delete(self, item_id: str) -> None:
        shutil.rmtree(self.root / item_id, ignore_errors=True)
