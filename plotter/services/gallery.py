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
from ..pipeline import PlotterError
from ..trace import IMAGE_DPI, trace_image_to_svg
from .errors import ServiceError
from .upload_validation import (
    MAX_GCODE_BYTES,
    MAX_UPLOAD_BYTES,
    UploadTooLarge,
    sniff_kind,
)

MAX_TITLE_LEN = 80
_SVG_FILE = "image.svg"
_GCODE_FILE = "job.gcode"


class GalleryService:
    """Event submissions: uploaded artwork scored for plottability.

    Every submission lives in ``data/gallery/<id>/`` with the original file,
    the derived SVG, the generated G-code and a ``meta.json``. Uploads that
    bust the size limits are deleted immediately and never listed.
    """

    def __init__(self, root: Path | None = None):
        self.root = root or (data_dir() / "gallery")
        self.root.mkdir(parents=True, exist_ok=True)

    # -- creation --------------------------------------------------------------

    def create(self, filename: str, data: bytes, title: str = "") -> dict:
        if len(data) > MAX_UPLOAD_BYTES:
            raise UploadTooLarge(
                f"Datei zu groß — maximal {MAX_UPLOAD_BYTES // (1024 * 1024)} MB."
            )
        kind = sniff_kind(Path(filename).name, data)
        title = title.strip()[:MAX_TITLE_LEN]

        item_id = uuid.uuid4().hex[:12]
        item_dir = self.root / item_id
        item_dir.mkdir(parents=True)
        try:
            meta = self._build(item_dir, Path(filename).name, data, kind, title, item_id)
        except Exception:
            shutil.rmtree(item_dir, ignore_errors=True)
            raise
        (item_dir / "meta.json").write_text(json.dumps(meta, indent=2))
        return meta

    def _build(
        self, item_dir: Path, filename: str, data: bytes, kind: str, title: str, item_id: str
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

        gcode = self._fitted_gcode(drawing, name=filename)
        if len(gcode.encode()) > MAX_GCODE_BYTES:
            raise UploadTooLarge(
                "Der erzeugte G-code überschreitet "
                f"{MAX_GCODE_BYTES // (1024 * 1024)} MB — das Motiv ist zu komplex."
            )
        (item_dir / _GCODE_FILE).write_text(gcode)

        return {
            "id": item_id,
            "title": title,
            "filename": filename,
            "kind": kind,
            "created": time.time(),
            "status": "active",
            "width": round(drawing.width, 3),
            "height": round(drawing.height, 3),
            "lines": len(drawing.polylines),
            **evaluate_gcode(gcode, MAX_GCODE_BYTES),
        }

    @staticmethod
    def _fitted_gcode(drawing, *, name: str) -> str:
        """G-code with the drawing scaled to fill the calibrated plot area."""
        cal = Calibration.load()
        bx0, by0, bx1, by1 = drawing.bounds()
        bw, bh = bx1 - bx0, by1 - by0
        if bw <= 0 or bh <= 0:
            raise PlotterError("Das Bild enthält keine plottbare Fläche.")
        scale = min(cal.plot_width / bw, cal.plot_height / bh)
        return placed_gcode(
            drawing, cal, x=cal.origin_x, y=cal.origin_y, width=bw * scale, name=name
        )

    # -- queries ---------------------------------------------------------------

    def list(self, *, include_archived: bool = True) -> list[dict]:
        metas = []
        for meta_file in self.root.glob("*/meta.json"):
            try:
                meta = json.loads(meta_file.read_text())
            except (OSError, json.JSONDecodeError):
                continue
            if include_archived or meta.get("status") != "archived":
                metas.append(meta)
        return sorted(metas, key=lambda m: m.get("created", 0), reverse=True)

    def get(self, item_id: str) -> dict:
        meta_file = self.root / item_id / "meta.json"
        if not meta_file.exists():
            raise ServiceError(f"Einreichung nicht gefunden: {item_id}")
        return json.loads(meta_file.read_text())

    def gcode_path(self, item_id: str) -> Path:
        path = self.root / item_id / _GCODE_FILE
        if not path.exists():
            raise ServiceError(f"Einreichung nicht gefunden: {item_id}")
        return path

    def svg_preview(self, item_id: str, *, max_points: int = 20000) -> dict:
        """Polylines of the derived SVG (mm, y down) for safe 2D rendering."""
        svg = self.root / item_id / _SVG_FILE
        if not svg.exists():
            raise ServiceError(f"Einreichung nicht gefunden: {item_id}")
        drawing = load_svg_drawing(svg, quantization_mm=0.5)
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
