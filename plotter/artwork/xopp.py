"""Read Xournal++ pen trajectories directly from its native .xopp document."""

from __future__ import annotations

import gzip
import math
from pathlib import Path
from xml.etree import ElementTree as ET

import numpy as np

from plotter.artwork.drawing import Drawing
from plotter.artwork.pipeline import PlotterError

PT_TO_MM = 25.4 / 72.0
MAX_XML_BYTES = 64 * 1024 * 1024
MAX_POINTS = 1_000_000


def _parse_xopp(data: bytes) -> ET.Element:
    try:
        from io import BytesIO
        with gzip.GzipFile(fileobj=BytesIO(data)) as stream:
            xml = stream.read(MAX_XML_BYTES + 1)
        if len(xml) > MAX_XML_BYTES:
            raise PlotterError("Die Xournal++-Datei ist entpackt zu groß.")
        if b"<!DOCTYPE" in xml.upper() or b"<!ENTITY" in xml.upper():
            raise PlotterError("Die Xournal++-Datei enthält unzulässige XML-Deklarationen.")
        root = ET.fromstring(xml)
    except (OSError, EOFError, ET.ParseError) as exc:
        raise PlotterError("Die Xournal++-Datei ist beschädigt oder ungültig.") from exc
    if root.tag != "xournal":
        raise PlotterError("Die Datei ist kein Xournal++-Dokument.")
    return root


def read_xopp(path: Path) -> list[Drawing]:
    """Keep native trajectories and optional relative segment pressure."""
    return read_xopp_bytes(path.read_bytes())


def _segment_pressures(stroke: ET.Element, point_count: int) -> list[float] | None:
    """Xournal stores base width, then the effective width of each segment.

    Widths are relative to the stroke's configured pen width, not a physical
    force. Keep that reference across strokes instead of stretching each one
    to the whole available pressure range. Broken width metadata must never
    discard an otherwise valid trajectory.
    """
    tokens = stroke.get("width", "").split()
    if point_count < 2 or len(tokens) != point_count:
        return None
    try:
        values = [float(token) for token in tokens]
    except ValueError:
        return None
    base, *widths = values
    if (not all(math.isfinite(value) for value in values)
            or base <= 0 or any(value < 0 for value in widths)):
        return None
    return [min(1.0, value / base) for value in widths]


def read_xopp_bytes(data: bytes) -> list[Drawing]:
    root = _parse_xopp(data)

    pages: list[Drawing] = []
    point_count = 0
    for page in root.findall("page"):
        try:
            width = float(page.attrib["width"]) * PT_TO_MM
            height = float(page.attrib["height"]) * PT_TO_MM
            if not all(math.isfinite(v) and v > 0 for v in (width, height)):
                raise ValueError("invalid page size")
            strokes: list[np.ndarray] = []
            pressures: list[list[float] | None] = []
            for layer in page.findall("layer"):
                for stroke in layer.findall("stroke"):
                    if stroke.get("tool") not in ("pen", "highlighter"):
                        continue
                    tokens = (stroke.text or "").split()
                    if point_count + len(tokens) // 2 > MAX_POINTS:
                        raise PlotterError("Die Xournal++-Datei enthält zu viele Stiftpunkte.")
                    values = [float(v) for v in tokens]
                    if len(values) % 2 or not all(math.isfinite(v) for v in values):
                        raise ValueError("invalid stroke coordinates")
                    point_count += len(values) // 2
                    if len(values) >= 2:
                        xy = np.asarray(values, dtype=np.float64).reshape(-1, 2) * PT_TO_MM
                        pressure = _segment_pressures(stroke, len(xy))
                        if len(xy) == 1:
                            xy = np.repeat(xy, 2, axis=0)  # a pen tap is a dot
                        strokes.append(xy[:, 0] + 1j * xy[:, 1])
                        pressures.append(pressure)
        except (KeyError, ValueError) as exc:
            raise PlotterError(
                "Die Xournal++-Datei enthält ungültige Seiten oder Stiftzüge."
            ) from exc
        pages.append(Drawing(strokes, width, height, segment_pressures=pressures))
    if not pages or not any(page.polylines for page in pages):
        raise PlotterError("Die Xournal++-Datei enthält keine plottbaren Stiftzüge.")
    return pages


def select_xopp_page(data: bytes, page_number: int) -> bytes:
    """Return a valid one-page .xopp for one independent gallery item."""
    root = _parse_xopp(data)
    pages = root.findall("page")
    if page_number < 1 or page_number > len(pages):
        raise PlotterError("Die gewählte Xournal++-Seite existiert nicht.")
    selected = pages[page_number - 1]
    for page in pages:
        if page is not selected:
            root.remove(page)
    return gzip.compress(ET.tostring(root, encoding="utf-8", xml_declaration=True))


def write_stroke_svg(path: Path, drawing: Drawing) -> None:
    """Preview artifact only; plot jobs use the native coordinates above."""
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{drawing.width}mm" '
        f'height="{drawing.height}mm" viewBox="0 0 {drawing.width} {drawing.height}">'
    ]
    for line in drawing.polylines:
        coords = " ".join(f"{point.real},{point.imag}" for point in line)
        parts.append(f'<polyline points="{coords}" fill="none" stroke="black" stroke-width="0.2"/>')
    parts.append("</svg>")
    path.write_text("\n".join(parts))
