"""Stroke-font schema, validation and normalization.

This module owns the shape of a stroke font on disk. It validates and normalizes
untrusted client input into a clean, bounded, export-capable document. It has no
knowledge of storage paths, HTTP or rendering — those live in sibling modules.

The document keeps both ``rawPoints`` (real pointer events) and ``points``
(smoothed/plotter-ready) so a stroke can later be re-stabilized with a different
preset without losing the original capture.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from ..services.errors import ServiceError

SCHEMA_VERSION = 1
TARGET_SET = "latin-basic-en-v1"

#: A glyph key is one of these conceptual kinds (see docs 03-stroke-data-model).
GLYPH_TYPES = {"character", "sequence", "ligature", "word", "symbol"}

# Size limits keep a single document bounded. Raw capture data can grow large,
# so these are enforced on every save rather than only warned about later.
MAX_GLYPHS = 2000
MAX_VARIANTS_PER_GLYPH = 16
MAX_STROKES_PER_VARIANT = 64
MAX_POINTS_PER_STROKE = 4000
MAX_KEY_LENGTH = 64
MAX_LABEL_LENGTH = 120

# Optional per-point fields preserved verbatim when present. ``x``/``y`` are
# always required; the rest are device-dependent (timing, pressure, computed
# speed, pointer type) and simply carried through if the client supplied them.
_POINT_NUMBER_FIELDS = ("t", "pressure", "speed")


@dataclass
class StrokeFontMetrics:
    """Vertical metrics in em units, y-up with the baseline at 0."""

    em: int = 1000
    baseline: int = 0
    xHeight: int = 460
    capHeight: int = 700
    ascender: int = 780
    descender: int = -230
    defaultAdvance: int = 560
    wordSpacing: int = 280


def _error(message: str, status_code: int = 422) -> ServiceError:
    err = ServiceError(message)
    err.status_code = status_code
    return err


def now_iso() -> str:
    """UTC timestamp, e.g. ``2026-06-29T12:00:00Z``."""
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def new_font_id() -> str:
    return f"stroke-{uuid4().hex[:12]}"


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _required_number(raw: dict, key: str) -> float:
    value = raw.get(key)
    if not _is_number(value):
        raise _error("Stroke-Punkt hat ungültige Koordinaten")
    return float(value)


def _normalize_point(raw: Any) -> dict:
    if not isinstance(raw, dict):
        raise _error("Stroke-Punkt hat ein ungültiges Format")
    point: dict[str, Any] = {"x": _required_number(raw, "x"), "y": _required_number(raw, "y")}
    for field in _POINT_NUMBER_FIELDS:
        value = raw.get(field)
        if _is_number(value):
            point[field] = float(value)
    pointer_type = raw.get("pointerType")
    if isinstance(pointer_type, str) and pointer_type:
        point["pointerType"] = pointer_type
    return point


def _normalize_stroke(raw: Any) -> dict:
    if not isinstance(raw, dict):
        raise _error("Stroke hat ein ungültiges Format")
    raw_points = raw.get("rawPoints") or []
    points = raw.get("points") or []
    if not isinstance(raw_points, list) or not isinstance(points, list):
        raise _error("Stroke-Punkte müssen Listen sein")
    if len(raw_points) > MAX_POINTS_PER_STROKE or len(points) > MAX_POINTS_PER_STROKE:
        raise _error("Stroke enthält zu viele Punkte", 413)
    stroke: dict[str, Any] = {
        "id": str(raw.get("id") or f"stroke-{uuid4().hex[:8]}"),
        "rawPoints": [_normalize_point(p) for p in raw_points],
        "points": [_normalize_point(p) for p in points],
    }
    # Processing/speed config are small dicts describing how ``points`` were
    # derived; carry them through so the capture stays reproducible.
    for opt in ("processing", "speedProfile"):
        if isinstance(raw.get(opt), dict):
            stroke[opt] = raw[opt]
    return stroke


def _normalize_variant(raw: Any) -> dict:
    if not isinstance(raw, dict):
        raise _error("Variante hat ein ungültiges Format")
    strokes = raw.get("strokes") or []
    if not isinstance(strokes, list):
        raise _error("Variante hat ein ungültiges Strokes-Feld")
    if len(strokes) > MAX_STROKES_PER_VARIANT:
        raise _error("Variante enthält zu viele Strokes", 413)
    weight = raw.get("weight", 1.0)
    variant: dict[str, Any] = {
        "id": str(raw.get("id") or f"var-{uuid4().hex[:8]}"),
        "weight": float(weight) if _is_number(weight) else 1.0,
        "strokes": [_normalize_stroke(s) for s in strokes],
    }
    # Side bearings are stored per variant, so alternates can have their own
    # width/lead-in. A glyph-level value (older fonts) acts as the fallback.
    advance = raw.get("advance")
    if _is_number(advance):
        variant["advance"] = float(advance)
    spacing_before = raw.get("spacingBefore")
    if _is_number(spacing_before):
        variant["spacingBefore"] = float(spacing_before)
    for opt in ("context", "bounds", "entryPoint", "exitPoint", "capture"):
        if isinstance(raw.get(opt), dict):
            variant[opt] = raw[opt]
    return variant


def _normalize_glyph(raw: Any) -> dict:
    if not isinstance(raw, dict):
        raise _error("Glyph hat ein ungültiges Format")
    key = str(raw.get("key") or "")
    if not key:
        raise _error("Glyph-Key fehlt")
    if len(key) > MAX_KEY_LENGTH:
        raise _error("Glyph-Key ist zu lang")
    glyph_type = str(raw.get("type") or "").strip()
    if glyph_type not in GLYPH_TYPES:
        glyph_type = "character" if len(key) == 1 else "sequence"
    variants = raw.get("variants") or []
    if not isinstance(variants, list):
        raise _error("Glyph hat ein ungültiges Varianten-Feld")
    if len(variants) > MAX_VARIANTS_PER_GLYPH:
        raise _error("Glyph hat zu viele Varianten", 413)
    tags = [str(t) for t in (raw.get("tags") or []) if isinstance(t, (str, int, float))]
    glyph: dict[str, Any] = {
        "key": key,
        "type": glyph_type,
        "label": str(raw.get("label") or key),
        "variants": [_normalize_variant(v) for v in variants],
        "tags": tags,
        "createdAt": str(raw.get("createdAt") or now_iso()),
        "updatedAt": now_iso(),
    }
    advance = raw.get("advance")
    if _is_number(advance):
        glyph["advance"] = float(advance)
    spacing_before = raw.get("spacingBefore")
    if _is_number(spacing_before):
        glyph["spacingBefore"] = float(spacing_before)
    return glyph


def _normalize_metrics(raw: Any) -> dict:
    metrics = StrokeFontMetrics()
    if isinstance(raw, dict):
        for field, default in asdict(metrics).items():
            value = raw.get(field)
            if _is_number(value):
                setattr(metrics, field, type(default)(value))
    return asdict(metrics)


def normalize_document(
    raw: Any,
    *,
    font_id: str,
    created_at: str | None = None,
) -> dict:
    """Validate and normalize ``raw`` into a clean stroke-font document.

    ``font_id`` is authoritative (taken from the storage layer / URL, never from
    client input). ``created_at`` is preserved across saves; ``updatedAt`` is
    always refreshed. Raises :class:`ServiceError` for malformed or oversized
    input or for an unsupported newer schema version.
    """
    if not isinstance(raw, dict):
        raise _error("Stroke-Font hat ein ungültiges Format")
    version = raw.get("schemaVersion", SCHEMA_VERSION)
    if not isinstance(version, int) or version > SCHEMA_VERSION:
        raise _error("Diese Stroke-Font-Version wird nicht unterstützt")
    label = str(raw.get("label") or "").strip()
    if not label:
        raise _error("Name der Schrift fehlt")
    if len(label) > MAX_LABEL_LENGTH:
        raise _error("Name der Schrift ist zu lang")
    glyphs = raw.get("glyphs") or []
    if not isinstance(glyphs, list):
        raise _error("Stroke-Font hat ein ungültiges Glyphen-Feld")
    if len(glyphs) > MAX_GLYPHS:
        raise _error("Stroke-Font hat zu viele Glyphen", 413)
    coverage = raw.get("coverage")
    target_set = TARGET_SET
    if isinstance(coverage, dict) and coverage.get("targetSet"):
        target_set = str(coverage["targetSet"])
    return {
        "schemaVersion": SCHEMA_VERSION,
        "id": font_id,
        "label": label,
        "kind": "stroke",
        "units": "em",
        "metrics": _normalize_metrics(raw.get("metrics")),
        "glyphs": [_normalize_glyph(g) for g in glyphs],
        "coverage": {"targetSet": target_set},
        "createdAt": str(created_at or raw.get("createdAt") or now_iso()),
        "updatedAt": now_iso(),
    }


def empty_document(label: str, *, font_id: str) -> dict:
    """A fresh, valid stroke-font document with no glyphs yet."""
    created = now_iso()
    return normalize_document(
        {"label": label, "glyphs": []}, font_id=font_id, created_at=created
    )


def summarize(document: dict) -> dict:
    """Lightweight metadata for listings (no glyph payload)."""
    return {
        "id": document["id"],
        "label": document["label"],
        "kind": "stroke",
        "glyphCount": len(document.get("glyphs", [])),
        "createdAt": document.get("createdAt"),
        "updatedAt": document.get("updatedAt"),
    }
