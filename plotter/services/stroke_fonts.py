"""Service facade for stroke fonts.

Thin layer the web routes talk to, keeping route handlers free of storage
details. Validation/normalization lives in ``plotter/stroke_fonts/model.py`` and
file access in ``plotter/stroke_fonts/storage.py``.
"""

from __future__ import annotations

from ..stroke_fonts import storage
from ..stroke_fonts.export import build_export, parse_import
from ..stroke_fonts.model import new_font_id
from ..stroke_fonts.render import StrokeRenderResult, render_text
from . import ServiceError


class StrokeFontService:
    def list(self) -> list[dict]:
        return storage.list_summaries()

    def create(self, label: str | None) -> dict:
        label = (label or "").strip()
        if not label:
            err = ServiceError("Name der Schrift fehlt")
            err.status_code = 422
            raise err
        return storage.create(label)

    def get(self, font_id: str) -> dict:
        return storage.get(font_id)

    def save(self, font_id: str, document: dict) -> dict:
        return storage.save(font_id, document)

    def delete(self, font_id: str) -> None:
        storage.delete(font_id)

    def render(
        self, font_id: str, text: str, size: float, *, seed: int = 0
    ) -> StrokeRenderResult:
        return render_text(storage.get(font_id), text, size, seed=seed)

    def export(self, font_id: str) -> dict:
        """The ``.gcsfont`` backup payload for a stored font."""
        return build_export(storage.get(font_id))

    def import_font(self, raw: object) -> dict:
        """Create a new editable stroke font from a ``.gcsfont`` payload."""
        document = parse_import(raw, font_id=new_font_id())
        return storage.create_from_document(document)

