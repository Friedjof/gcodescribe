from __future__ import annotations

import math

# Plotter-economy thresholds. A short line costs a pen down/up for almost no
# ink, so a drawing made of many tiny segments plots slowly and looks noisy.
SHORT_LINE_MM = 3.0
MANY_LINES = 400
MANY_SHORT_FRACTION = 0.4


def _length(polyline: list[list[float]]) -> float:
    total = 0.0
    for (x0, y0), (x1, y1) in zip(polyline, polyline[1:], strict=False):
        total += math.hypot(x1 - x0, y1 - y0)
    return total


def assess(preview: dict) -> dict:
    """Cheap plottability heuristic over the traced preview polylines.

    Returns counts plus a coarse ``complexity`` rating and human-readable
    warnings. Intentionally small for the MVP; richer feedback chips build on
    these same fields in a later phase.
    """
    polylines = preview.get("polylines") or []
    line_count = len(polylines)
    point_count = sum(len(p) for p in polylines)
    short_line_count = sum(1 for p in polylines if _length(p) < SHORT_LINE_MM)

    warnings: list[str] = []
    short_fraction = short_line_count / line_count if line_count else 0.0
    if line_count >= MANY_LINES:
        warnings.append(f"Sehr viele Linien ({line_count}) — der Plot dauert lange.")
    if short_fraction >= MANY_SHORT_FRACTION and short_line_count > 20:
        warnings.append(
            f"Viele kurze Linien ({short_line_count}) — wirkt wie Punkte/Textur."
        )

    if line_count == 0:
        complexity = "bad"
    elif warnings:
        complexity = "medium"
    else:
        complexity = "good"

    return {
        "lineCount": line_count,
        "pointCount": point_count,
        "shortLineCount": short_line_count,
        "complexity": complexity,
        "warnings": warnings,
    }
