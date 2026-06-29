from __future__ import annotations

import re
import struct

from ..pipeline import OFFICE_EXTENSIONS
from .errors import ServiceError

MAX_UPLOAD_BYTES = 15 * 1024 * 1024
MAX_STL_BYTES = 20 * 1024 * 1024  # STL meshes are bulkier than 2D art
MAX_GCODE_BYTES = 25 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000  # decompression-bomb guard for PNG/JPEG

_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
_JPEG_MAGIC = b"\xff\xd8\xff"
_PDF_MAGIC = b"%PDF"
_ZIP_MAGIC = b"PK\x03\x04"  # docx/xlsx/pptx/odt… (OOXML / ODF are zip containers)
_OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"  # legacy doc/xls/ppt

# Document extensions the admin asset library accepts on top of images/SVG.
DOCUMENT_EXTENSIONS = {"pdf"} | {ext.lstrip(".") for ext in OFFICE_EXTENSIONS}
# Constructs we never accept in an SVG, even though previews are rendered
# from extracted polylines only (defence in depth against XXE / script).
# A bare `<!DOCTYPE svg PUBLIC ...>` (as emitted by Inkscape, city-roads, …) is
# harmless — only a DOCTYPE carrying an internal subset (`[ … ]`) can smuggle
# entities, and `<!ENTITY` is rejected outright regardless.
_SVG_FORBIDDEN = re.compile(
    rb"<!DOCTYPE[^>]*\[|<!ENTITY|<script|javascript:", re.IGNORECASE
)


class UploadTooLarge(ServiceError):
    status_code = 413


class UnsupportedUpload(ServiceError):
    status_code = 415


def sniff_kind(filename: str, data: bytes) -> str:
    """Validate extension *and* content; returns ``svg`` | ``png`` | ``jpeg``.

    The extension picks the expected format, the magic bytes must confirm it —
    a renamed file of another type is rejected.
    """
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext == "svg":
        _check_svg(data)
        return "svg"
    if ext == "png":
        if not data.startswith(_PNG_MAGIC):
            raise UnsupportedUpload("Die Datei ist kein gültiges PNG.")
        _check_pixels(_png_dimensions(data))
        return "png"
    if ext in ("jpg", "jpeg"):
        if not data.startswith(_JPEG_MAGIC):
            raise UnsupportedUpload("Die Datei ist kein gültiges JPEG.")
        _check_pixels(_jpeg_dimensions(data))
        return "jpeg"
    raise UnsupportedUpload("Nur SVG, PNG oder JPG werden akzeptiert.")


def sniff_asset_kind(filename: str, data: bytes) -> str:
    """Like :func:`sniff_kind` but also accepts PDF/Office documents.

    Used by the admin asset library (gallery), which holds general documents on
    top of the competition images. Returns ``svg`` | ``png`` | ``jpeg`` |
    ``pdf`` | an office extension (``docx``, ``ods``, …).
    """
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext in ("svg", "png", "jpg", "jpeg"):
        return sniff_kind(filename, data)
    if ext == "pdf":
        if not data.startswith(_PDF_MAGIC):
            raise UnsupportedUpload("Die Datei ist kein gültiges PDF.")
        return "pdf"
    if ext in DOCUMENT_EXTENSIONS:
        if not (data.startswith(_ZIP_MAGIC) or data.startswith(_OLE_MAGIC)):
            raise UnsupportedUpload(f"Die Datei ist kein gültiges {ext.upper()}-Dokument.")
        return ext
    raise UnsupportedUpload(
        "Nur Bilder (SVG/PNG/JPG), PDF oder Office-Dokumente werden akzeptiert."
    )


def check_stl(filename: str, data: bytes) -> None:
    """Validate an STL upload by extension *and* content (ASCII or binary).

    ASCII STL starts with ``solid`` and contains ``facet`` records; binary STL is
    an 80-byte header + uint32 triangle count + 50 bytes per triangle.
    """
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext != "stl":
        raise UnsupportedUpload("Nur STL-Dateien werden akzeptiert.")
    if data[:5].lower() == b"solid" and b"facet" in data[:2048].lower():
        return
    if len(data) >= 84:
        count = struct.unpack("<I", data[80:84])[0]
        if 84 + count * 50 == len(data):
            return
    raise UnsupportedUpload("Die Datei ist kein gültiges STL.")


def _check_svg(data: bytes) -> None:
    head = data[:4096]
    if _SVG_FORBIDDEN.search(data):
        raise UnsupportedUpload(
            "Das SVG enthält unzulässige Inhalte (Script, Entities oder DOCTYPE-Subset)."
        )
    if b"<svg" not in head:
        raise UnsupportedUpload("Die Datei ist kein gültiges SVG.")
    try:
        head.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise UnsupportedUpload("Das SVG ist nicht UTF-8-kodiert.") from exc


def _check_pixels(dims: tuple[int, int] | None) -> None:
    if dims is None:
        raise UnsupportedUpload("Die Bildgröße konnte nicht gelesen werden.")
    w, h = dims
    if w <= 0 or h <= 0 or w * h > MAX_IMAGE_PIXELS:
        raise UnsupportedUpload(f"Bildauflösung wird nicht unterstützt ({w}×{h}).")


def _png_dimensions(data: bytes) -> tuple[int, int] | None:
    # IHDR is always the first chunk: width/height at offsets 16/20.
    if len(data) < 24 or data[12:16] != b"IHDR":
        return None
    w, h = struct.unpack(">II", data[16:24])
    return w, h


def _jpeg_dimensions(data: bytes) -> tuple[int, int] | None:
    # Walk the segment list until a SOFn frame header carries the dimensions.
    i = 2
    while i + 9 < len(data):
        if data[i] != 0xFF:
            return None
        marker = data[i + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        length = struct.unpack(">H", data[i + 2 : i + 4])[0]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            h, w = struct.unpack(">HH", data[i + 5 : i + 9])
            return w, h
        i += 2 + length
    return None
