"""``.gcsfont`` export/import — a single self-describing JSON backup file.

The file wraps the full stroke-font document (metrics, glyphs, variants and every
stroke with its raw + processed points, timing, pressure and processing params)
so a backup round-trips losslessly. It is plain JSON with a ``format``/``version``
header, not a zip, so it stays a single human-inspectable file.
"""

from __future__ import annotations

from .model import _error, normalize_document, now_iso

EXPORT_FORMAT = "gcsfont"
EXPORT_VERSION = 1


def build_export(document: dict) -> dict:
    """Wrap a stored font document in the ``.gcsfont`` envelope."""
    return {
        "format": EXPORT_FORMAT,
        "version": EXPORT_VERSION,
        "exportedAt": now_iso(),
        "font": document,
    }


def parse_import(raw: object, *, font_id: str) -> dict:
    """Validate a ``.gcsfont`` payload and normalize its font for storage.

    ``font_id`` is the fresh id the import will live under (never the file's own
    id, so importing a backup never overwrites an existing font). The original
    ``createdAt`` is preserved by :func:`normalize_document`.
    """
    if not isinstance(raw, dict):
        raise _error("Ungültige .gcsfont-Datei")
    if raw.get("format") != EXPORT_FORMAT:
        raise _error("Datei ist keine .gcsfont-Schrift")
    version = raw.get("version")
    if not isinstance(version, int) or version > EXPORT_VERSION:
        raise _error("Diese .gcsfont-Version wird nicht unterstützt")
    font = raw.get("font")
    if not isinstance(font, dict):
        raise _error(".gcsfont-Datei enthält keine Schriftdaten")
    return normalize_document(font, font_id=font_id)
