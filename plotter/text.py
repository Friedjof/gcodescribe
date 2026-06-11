from __future__ import annotations

import subprocess
from functools import lru_cache
from pathlib import Path

from fontTools.pens.recordingPen import RecordingPen
from fontTools.ttLib import TTFont

from .pipeline import PlotterError

Point = tuple[float, float]
Polyline = list[Point]

FONT_MATCHES = {
    "pdf-serif": "Tinos",
    "pdf-sans": "Noto Sans",
    "pdf-script": "Z003",
    "pdf-times": "Times New Roman",
}


def _font_file(font: str) -> Path:
    query = FONT_MATCHES.get(font, FONT_MATCHES["pdf-serif"])
    try:
        out = subprocess.check_output(
            ["fc-match", "-f", "%{file}", query], text=True, timeout=2
        ).strip()
    except Exception as exc:
        raise PlotterError("Systemschrift konnte nicht gefunden werden.") from exc
    path = Path(out)
    if not path.exists():
        raise PlotterError(f"Systemschrift nicht gefunden: {query}")
    return path


@lru_cache(maxsize=8)
def _load_font(font: str) -> TTFont:
    return TTFont(str(_font_file(font)))


def _quad(a: Point, b: Point, c: Point, steps: int = 10) -> Polyline:
    pts: Polyline = []
    for i in range(1, steps + 1):
        t = i / steps
        mt = 1 - t
        pts.append((
            mt * mt * a[0] + 2 * mt * t * b[0] + t * t * c[0],
            mt * mt * a[1] + 2 * mt * t * b[1] + t * t * c[1],
        ))
    return pts


def _cubic(a: Point, b: Point, c: Point, d: Point, steps: int = 14) -> Polyline:
    pts: Polyline = []
    for i in range(1, steps + 1):
        t = i / steps
        mt = 1 - t
        pts.append((
            mt ** 3 * a[0] + 3 * mt * mt * t * b[0] + 3 * mt * t * t * c[0] + t ** 3 * d[0],
            mt ** 3 * a[1] + 3 * mt * mt * t * b[1] + 3 * mt * t * t * c[1] + t ** 3 * d[1],
        ))
    return pts


def _recording_to_lines(recording: list[tuple[str, tuple]]) -> list[list[tuple[float, float]]]:
    lines: list[list[tuple[float, float]]] = []
    current: Point = (0.0, 0.0)
    start: Point | None = None
    line: Polyline = []

    def finish() -> None:
        nonlocal line
        if len(line) > 1:
            lines.append(line)
        line = []

    for op, args in recording:
        if op == "moveTo":
            finish()
            current = tuple(args[0])  # type: ignore[assignment]
            start = current
            line = [current]
        elif op == "lineTo":
            current = tuple(args[0])  # type: ignore[assignment]
            line.append(current)
        elif op == "qCurveTo":
            points = [tuple(p) for p in args]
            for i in range(len(points) - 1):
                ctrl = points[i]
                end = points[i + 1]
                line.extend(_quad(current, ctrl, end))
                current = end
        elif op == "curveTo":
            p1, p2, p3 = (tuple(p) for p in args)
            line.extend(_cubic(current, p1, p2, p3))
            current = p3
        elif op == "closePath":
            if start and current != start:
                line.append(start)
            finish()
            start = None
        elif op == "endPath":
            finish()
            start = None
    finish()
    return lines


def text_polylines(
    text: str, *, font: str = "pdf-serif", size: float = 12.0
) -> list[list[list[float]]]:
    if not text:
        text = "Text"
    if size <= 0:
        raise PlotterError("Schriftgröße muss größer als 0 sein.")

    tt = _load_font(font)
    cmap = tt.getBestCmap() or {}
    glyph_set = tt.getGlyphSet()
    units = float(tt["head"].unitsPerEm)
    scale = size / units
    hhea = tt["hhea"]
    ascent = float(hhea.ascent)
    descent = float(hhea.descent)
    line_height = (ascent - descent) * scale * 1.18
    baseline = ascent * scale
    cursor = 0.0
    lines: list[Polyline] = []

    for ch in text:
        if ch == "\n":
            cursor = 0.0
            baseline += line_height
            continue
        glyph_name = cmap.get(ord(ch))
        if glyph_name is None:
            cursor += size * 0.35
            continue
        glyph = glyph_set[glyph_name]
        pen = RecordingPen()
        glyph.draw(pen)
        for raw in _recording_to_lines(pen.value):
            line = [[cursor + x * scale, baseline - y * scale] for x, y in raw]
            if len(line) > 1:
                lines.append(line)  # type: ignore[arg-type]
        cursor += glyph.width * scale

    if not lines:
        raise PlotterError("Text enthält keine plottbaren Glyphen.")
    return [[[round(x, 3), round(y, 3)] for x, y in line] for line in lines]
