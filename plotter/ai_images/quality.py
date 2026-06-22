from __future__ import annotations

import math
import statistics

# Plotter-economy thresholds (start values from the planning doc; calibrate on
# real images later). A short line costs a pen down/up for almost no ink, so a
# drawing made of many tiny segments plots slowly and looks like noise.
SHORT_LINE_MM = 2.0

GOOD_MAX_LINES = 400
GOOD_MAX_POINTS = 15000
GOOD_MAX_SHORT_RATIO = 0.15
GOOD_MIN_MEDIAN_MM = 5.0

MEDIUM_MAX_LINES = 1200
MEDIUM_MAX_POINTS = 40000
MEDIUM_MAX_SHORT_RATIO = 0.35

SMALL_FILL_RATIO = 0.15


def _length(polyline: list[list[float]]) -> float:
    total = 0.0
    for (x0, y0), (x1, y1) in zip(polyline, polyline[1:], strict=False):
        total += math.hypot(x1 - x0, y1 - y0)
    return total


def _fill_ratio(preview: dict) -> float | None:
    bounds = preview.get("bounds")
    width = preview.get("width") or 0
    height = preview.get("height") or 0
    if not bounds or width <= 0 or height <= 0:
        return None
    bw = max(bounds[2] - bounds[0], 0.0)
    bh = max(bounds[3] - bounds[1], 0.0)
    return round(min((bw * bh) / (width * height), 1.0), 3)


def assess(preview: dict) -> dict:
    """Plottability heuristic over the traced preview polylines.

    Returns counts, a median line length and a bounds fill ratio, a coarse
    ``complexity`` rating, human-readable warnings, and ready-to-use feedback
    suggestions paired with those warnings. Computed on the backend so the
    rating is reproducible and testable; the frontend only displays it.
    """
    polylines = preview.get("polylines") or []
    lengths = [_length(p) for p in polylines]
    line_count = len(polylines)
    point_count = sum(len(p) for p in polylines)
    short_line_count = sum(1 for length in lengths if length < SHORT_LINE_MM)
    short_ratio = round(short_line_count / line_count, 3) if line_count else 0.0
    median_length = round(statistics.median(lengths), 2) if lengths else 0.0
    fill_ratio = _fill_ratio(preview)

    warnings: list[str] = []
    suggestions: list[str] = []

    def flag(warning: str, suggestion: str) -> None:
        warnings.append(warning)
        suggestions.append(suggestion)

    if line_count == 0:
        flag(
            "Kaum Linien erkannt — stärkere schwarze Konturen oder anderen Render-Modus versuchen.",
            "Stärkere schwarze Konturen, klar vom Hintergrund getrennt.",
        )
    if line_count > MEDIUM_MAX_LINES:
        flag(
            f"Sehr viele Linien ({line_count}) — das Motiv ist wohl zu komplex.",
            "Weniger Details, nur die wichtigsten Konturen.",
        )
    if point_count > MEDIUM_MAX_POINTS:
        flag(
            f"Sehr viele Punkte ({point_count}) — große Datei und langsames Plotten.",
            "Keine Punkte, keine Textur, glatte Linien.",
        )
    if short_ratio > MEDIUM_MAX_SHORT_RATIO and short_line_count > 20:
        flag(
            f"Viele kurze Linien ({short_line_count}) — wirkt wie Textur oder Punkte.",
            "Längere zusammenhängende Linien, weniger kurze Striche.",
        )
    if fill_ratio is not None and fill_ratio < SMALL_FILL_RATIO and line_count > 0:
        flag(
            "Das Motiv nutzt nur wenig Fläche — größer und zentriert anfordern.",
            "Motiv größer und zentriert, Hintergrund leer lassen.",
        )

    complexity = _complexity(line_count, point_count, short_ratio, median_length)

    return {
        "lineCount": line_count,
        "pointCount": point_count,
        "shortLineCount": short_line_count,
        "shortLineRatio": short_ratio,
        "medianLineLength": median_length,
        "boundsFillRatio": fill_ratio,
        "complexity": complexity,
        "warnings": warnings,
        "feedbackSuggestions": suggestions,
    }


def _complexity(line_count: int, point_count: int, short_ratio: float, median_length: float) -> str:
    if line_count == 0:
        return "bad"
    if (
        line_count <= GOOD_MAX_LINES
        and point_count <= GOOD_MAX_POINTS
        and short_ratio <= GOOD_MAX_SHORT_RATIO
        and median_length >= GOOD_MIN_MEDIAN_MM
    ):
        return "good"
    if (
        line_count <= MEDIUM_MAX_LINES
        and point_count <= MEDIUM_MAX_POINTS
        and short_ratio <= MEDIUM_MAX_SHORT_RATIO
    ):
        return "medium"
    return "bad"
