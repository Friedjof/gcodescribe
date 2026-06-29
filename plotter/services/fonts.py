from __future__ import annotations

import json
import re
import shutil
from dataclasses import asdict, dataclass
from pathlib import Path
from uuid import uuid4

from fontTools.ttLib import TTFont

from ..calibration import data_dir
from . import ServiceError

FontMode = str
PLOTTER_MODE: FontMode = "plotter"
NORMAL_MODE: FontMode = "normal"
FONT_MODES = {PLOTTER_MODE, NORMAL_MODE}


FontKind = str
BUILTIN_KIND: FontKind = "builtin"
UPLOADED_KIND: FontKind = "uploaded"
STROKE_KIND: FontKind = "stroke"


@dataclass(frozen=True)
class FontItem:
    id: str
    label: str
    builtin: bool
    filename: str | None = None
    mode: FontMode = PLOTTER_MODE
    # ``kind`` distinguishes file-backed fonts from editable stroke fonts so
    # text rendering and the editor can branch without re-deriving the type.
    kind: FontKind = UPLOADED_KIND
    editable: bool = False
    glyph_count: int | None = None


BUILTIN_FONTS = [
    FontItem(id="sans", label="Sans", builtin=True, kind=BUILTIN_KIND),
    FontItem(id="hand", label="Handwriting", builtin=True, kind=BUILTIN_KIND),
    FontItem(id="script", label="Cursive", builtin=True, kind=BUILTIN_KIND),
    FontItem(id="block", label="Block", builtin=True, kind=BUILTIN_KIND),
]

_ALLOWED_EXT = {".otf", ".ttf"}
_SAFE_NAME_RE = re.compile(r"[^a-zA-Z0-9_.-]+")


def _error(message: str, status_code: int) -> ServiceError:
    err = ServiceError(message)
    err.status_code = status_code
    return err


def fonts_dir() -> Path:
    path = data_dir() / "fonts"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _index_path() -> Path:
    return fonts_dir() / "fonts.json"


def _load_user_fonts() -> list[FontItem]:
    path = _index_path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text())
    except Exception as exc:
        raise _error("Schriftarten konnten nicht gelesen werden", 500) from exc
    if not isinstance(data, list):
        return []
    fonts: list[FontItem] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        font_id = str(item.get("id") or "").strip()
        label = str(item.get("label") or "").strip()
        filename = str(item.get("filename") or "").strip()
        mode = str(item.get("mode") or PLOTTER_MODE).strip()
        if mode not in FONT_MODES:
            mode = PLOTTER_MODE
        if font_id and label and filename:
            fonts.append(
                FontItem(id=font_id, label=label, builtin=False, filename=filename, mode=mode)
            )
    return fonts


def _write_user_fonts(fonts: list[FontItem]) -> None:
    _index_path().write_text(json.dumps([asdict(f) for f in fonts], indent=2, ensure_ascii=False))


def _stroke_font_items() -> list[FontItem]:
    """Stroke fonts as selectable entries for the shared font list.

    Wrapped defensively: a broken stroke-font index must never take down the
    classic built-in/uploaded font listing.
    """
    try:
        from .stroke_fonts import StrokeFontService

        summaries = StrokeFontService().list()
    except Exception:
        return []
    return [
        FontItem(
            id=str(summary.get("id")),
            label=str(summary.get("label") or summary.get("id")),
            builtin=False,
            filename=None,
            mode=PLOTTER_MODE,
            kind=STROKE_KIND,
            editable=True,
            glyph_count=summary.get("glyphCount"),
        )
        for summary in summaries
        if summary.get("id")
    ]


def list_fonts() -> list[FontItem]:
    return [*BUILTIN_FONTS, *_load_user_fonts(), *_stroke_font_items()]


def user_font_path(font_id: str) -> Path | None:
    for font in _load_user_fonts():
        if font.id == font_id and font.filename:
            path = fonts_dir() / font.filename
            return path if path.exists() else None
    return None


def user_font_mode(font_id: str) -> FontMode | None:
    for font in _load_user_fonts():
        if font.id == font_id:
            return font.mode
    return None


def add_font(
    label: str, upload_filename: str, source_file, mode: FontMode = PLOTTER_MODE
) -> FontItem:
    label = label.strip()
    if not label:
        raise _error("Name der Schriftart fehlt", 422)
    if mode not in FONT_MODES:
        raise _error("Unbekannter Schriftarten-Modus", 422)
    ext = Path(upload_filename).suffix.lower()
    if ext not in _ALLOWED_EXT:
        raise _error("Nur .otf- und .ttf-Dateien sind erlaubt", 422)

    font_id = f"user-{uuid4().hex[:12]}"
    base_name = _SAFE_NAME_RE.sub("-", Path(upload_filename).stem).strip(".-") or "font"
    filename = f"{font_id}-{base_name}{ext}"
    dest = fonts_dir() / filename

    with dest.open("wb") as out:
        shutil.copyfileobj(source_file, out)

    try:
        TTFont(str(dest)).close()
    except Exception as exc:
        dest.unlink(missing_ok=True)
        raise _error("Die Datei ist keine lesbare Schriftart", 422) from exc

    fonts = _load_user_fonts()
    item = FontItem(id=font_id, label=label, builtin=False, filename=filename, mode=mode)
    fonts.append(item)
    _write_user_fonts(fonts)
    _clear_renderer_cache()
    return item


def delete_font(font_id: str) -> None:
    if any(font.id == font_id for font in BUILTIN_FONTS):
        raise _error("Standard-Schriftarten können nicht entfernt werden", 422)
    fonts = _load_user_fonts()
    keep = [font for font in fonts if font.id != font_id]
    removed = [font for font in fonts if font.id == font_id]
    if not removed:
        raise _error("Schriftart nicht gefunden", 404)
    for font in removed:
        if font.filename:
            (fonts_dir() / font.filename).unlink(missing_ok=True)
    _write_user_fonts(keep)
    _clear_renderer_cache()


def _clear_renderer_cache() -> None:
    try:
        from ..singleline import _glyph_centerline, _load_font
    except ImportError:
        return
    _load_font.cache_clear()
    _glyph_centerline.cache_clear()
