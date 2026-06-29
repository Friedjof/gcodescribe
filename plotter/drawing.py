from __future__ import annotations

import re
import tempfile
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from xml.etree.ElementTree import ParseError

import numpy as np
import vpype

from .calibration import Calibration
from .export import calibration_comment
from .linemerge import merge_polylines
from .oneline import continuous_path
from .pipeline import PlotterError
from .routing import route_travel
from .safety import GcodeSafetyChecker

PX_TO_MM = 25.4 / 96.0  # vpype works in CSS pixels

# Well-known namespace URIs, used to repair SVGs that reference a prefix
# (xlink:href, inkscape:*, …) without declaring the matching xmlns. Such files
# are technically invalid XML, but plenty of real exports ship them, so we patch
# the declarations back in rather than failing the whole upload.
_KNOWN_NS = {
    "xlink": "http://www.w3.org/1999/xlink",
    "inkscape": "http://www.inkscape.org/namespaces/inkscape",
    "sodipodi": "http://sodipodi.sourceforge.net/DTD/sodipodi-0.0.dtd",
    "dc": "http://purl.org/dc/elements/1.1/",
    "cc": "http://creativecommons.org/ns#",
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "svg": "http://www.w3.org/2000/svg",
    "xhtml": "http://www.w3.org/1999/xhtml",
}
_PLACEHOLDER_NS = "https://gcodescribe.local/ns/"
# Reserved prefixes that must never be (re)declared with xmlns:.
_RESERVED_PREFIXES = {"xml", "xmlns"}
# Used prefix as an element name (<inkscape:foo>) or attribute (xlink:href=…).
_PREFIX_USE = re.compile(r"</?\s*([A-Za-z_][\w.\-]*):|\s([A-Za-z_][\w.\-]*):[\w.\-]+\s*=")
_PREFIX_DECL = re.compile(r"xmlns:([A-Za-z_][\w.\-]*)\s*=")


def _repair_svg_namespaces(text: str) -> str | None:
    """Inject missing ``xmlns:`` declarations for prefixes the document uses but
    never declares. Returns the patched text, or ``None`` if nothing is missing
    or there is no ``<svg>`` root to patch. Extra (even unused) declarations are
    valid XML, so over-declaring is safe — we never remove anything."""
    declared = set(_PREFIX_DECL.findall(text)) | _RESERVED_PREFIXES
    used = {m.group(1) or m.group(2) for m in _PREFIX_USE.finditer(text)}
    missing = {p for p in used if p and p not in declared}
    if not missing:
        return None
    root = re.search(r"<svg\b", text)
    if not root:
        return None
    decls = "".join(
        f' xmlns:{p}="{_KNOWN_NS.get(p, _PLACEHOLDER_NS + p)}"' for p in sorted(missing)
    )
    return text[: root.end()] + decls + text[root.end():]


def _parse_svg(path: str, quantization: float):
    """vpype.read_svg with a one-shot retry that repairs undeclared namespace
    prefixes; a still-unparseable SVG becomes a friendly PlotterError (→ 422)
    instead of an unhandled 500."""
    try:
        return vpype.read_svg(path, quantization=quantization)
    except ParseError as exc:
        repaired = _repair_svg_namespaces(
            Path(path).read_text(encoding="utf-8", errors="replace")
        )
        if repaired is not None:
            with tempfile.NamedTemporaryFile(
                "w", suffix=".svg", delete=False, encoding="utf-8"
            ) as tmp:
                tmp.write(repaired)
                tmp_path = tmp.name
            try:
                return vpype.read_svg(tmp_path, quantization=quantization)
            except ParseError:
                pass
            finally:
                Path(tmp_path).unlink(missing_ok=True)
        raise PlotterError(
            "Die SVG-Datei konnte nicht gelesen werden (ungültiges XML)."
        ) from exc


@dataclass
class Drawing:
    """Polylines of a source page in mm, SVG coordinates (y pointing down)."""

    polylines: list[np.ndarray]  # complex arrays, mm
    width: float  # page width in mm
    height: float  # page height in mm

    def bounds(self) -> tuple[float, float, float, float]:
        xs = np.concatenate([line.real for line in self.polylines])
        ys = np.concatenate([line.imag for line in self.polylines])
        return float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max())

    def is_empty(self) -> bool:
        return not self.polylines


@lru_cache(maxsize=6)
def _read_svg_drawing(path: str, mtime_ns: int, quantization_mm: float) -> Drawing:
    lc, width_px, height_px = _parse_svg(path, quantization=quantization_mm / PX_TO_MM)
    lc.merge(tolerance=0.05 / PX_TO_MM)
    polylines = [np.asarray(line) * PX_TO_MM for line in lc.lines if len(line) > 1]
    return Drawing(polylines, width_px * PX_TO_MM, height_px * PX_TO_MM)


def load_svg_drawing(path: Path, *, quantization_mm: float = 0.25) -> Drawing:
    """Parse an SVG into a Drawing (mm). Cached by path+mtime+quantization, so
    repeated parses of the same page (e.g. live placement scoring, then G-code)
    don't re-run the costly vpype parse — which can take tens of seconds for a
    detailed trace. Callers treat the result as read-only."""
    try:
        mtime_ns = path.stat().st_mtime_ns
    except OSError:
        mtime_ns = 0
    return _read_svg_drawing(str(path), mtime_ns, quantization_mm)


_TWO_OPT_MAX = 600  # 2-opt is O(passes·n²); cap n to keep it snappy
_TWO_OPT_PASSES = 6


def _sorted_for_travel(polylines: list[np.ndarray]) -> list[np.ndarray]:
    """Order strokes (and choose direction) to minimise invisible pen-up travel.
    This never changes the drawing: pen-up moves leave no ink, so the shape is
    preserved exactly. Small inputs use an O(n²) greedy pass refined by 2-opt;
    large inputs (e.g. a whole-city map plotted without the one-stroke pass) use
    a KD-tree greedy so travel is still minimised instead of left unordered."""
    if len(polylines) <= 1:
        return list(polylines)
    if len(polylines) > 4000:
        return _sorted_for_travel_large(polylines)
    remaining = list(polylines)
    ordered: list[np.ndarray] = []
    cursor = 0 + 0j
    while remaining:
        best_i, best_rev, best_d = 0, False, float("inf")
        for i, line in enumerate(remaining):
            d_start = abs(line[0] - cursor)
            d_end = abs(line[-1] - cursor)
            if d_start < best_d:
                best_i, best_rev, best_d = i, False, d_start
            if d_end < best_d:
                best_i, best_rev, best_d = i, True, d_end
        line = remaining.pop(best_i)
        if best_rev:
            line = line[::-1]
        ordered.append(line)
        cursor = line[-1]
    return _two_opt_travel(ordered, 0 + 0j)


def _sorted_for_travel_large(polylines: list[np.ndarray]) -> list[np.ndarray]:
    """KD-tree greedy nearest-neighbour ordering for large stroke counts."""
    from scipy.spatial import cKDTree

    n = len(polylines)
    pts = np.empty((2 * n, 2))
    for i, line in enumerate(polylines):
        pts[2 * i] = (line[0].real, line[0].imag)
        pts[2 * i + 1] = (line[-1].real, line[-1].imag)
    tree = cKDTree(pts)
    used = bytearray(n)
    ordered: list[np.ndarray] = []
    cursor = np.array([0.0, 0.0])
    for _ in range(n):
        found = -1
        kk = 8
        while found < 0:
            kk = min(2 * n, kk)
            _, idx = tree.query(cursor, k=kk)
            for ix in np.atleast_1d(idx):
                if not used[ix // 2]:
                    found = int(ix)
                    break
            if found < 0:
                if kk >= 2 * n:
                    break
                kk *= 2
        if found < 0:
            break
        pi = found // 2
        used[pi] = 1
        line = polylines[pi]
        if found % 2 == 1:
            line = line[::-1]
        ordered.append(line)
        cursor = np.array([line[-1].real, line[-1].imag])
    return ordered


def _two_opt_travel(ordered: list[np.ndarray], start: complex) -> list[np.ndarray]:
    """2-opt refinement of the stroke order: reverse a sub-sequence (flipping
    each stroke) whenever that shortens the total pen-up travel."""
    n = len(ordered)
    if n < 3 or n > _TWO_OPT_MAX:
        return ordered
    starts = [o[0] for o in ordered]
    ends = [o[-1] for o in ordered]
    for _ in range(_TWO_OPT_PASSES):
        improved = False
        for i in range(n):
            prev_end = start if i == 0 else ends[i - 1]
            for j in range(i + 1, n):
                tail = starts[j + 1] if j + 1 < n else None
                tail_before = abs(ends[j] - tail) if tail is not None else 0.0
                tail_after = abs(starts[i] - tail) if tail is not None else 0.0
                before = abs(prev_end - starts[i]) + tail_before
                after = abs(prev_end - ends[j]) + tail_after
                if after + 1e-9 < before:
                    ordered[i:j + 1] = [o[::-1] for o in reversed(ordered[i:j + 1])]
                    starts[i:j + 1] = [o[0] for o in ordered[i:j + 1]]
                    ends[i:j + 1] = [o[-1] for o in ordered[i:j + 1]]
                    improved = True
        if not improved:
            break
    return ordered


def placed_gcode(
    drawing: Drawing,
    cal: Calibration,
    *,
    x: float,
    y: float,
    width: float,
    name: str = "placement",
    continuous: bool = True,
) -> str:
    """G-code for the drawing scaled to ``width`` mm with its lower-left
    corner at printer position (``x``, ``y``).

    The SVG y-axis (down) is flipped into printer space (up). The result is
    validated by the safety checker, so it can never leave the plot area or
    the calibrated pen heights.

    With ``continuous=True`` the whole drawing is collapsed into a single
    pen-down stroke (see :func:`plotter.oneline.continuous_path`) so the pen
    never lifts between the first and last point.
    """
    if drawing.is_empty():
        raise PlotterError("Die Zeichnung enthält keine Linien.")
    if width <= 0:
        raise PlotterError("Breite muss größer als 0 sein.")
    bx0, by0, bx1, by1 = drawing.bounds()
    bw = bx1 - bx0
    if bw <= 0:
        raise PlotterError("Zeichnung hat keine Breite.")
    scale = width / bw

    def tx(p: complex) -> tuple[float, float]:
        return (x + (p.real - bx0) * scale, y + (by1 - p.imag) * scale)

    pen_up = f"G0 Z{cal.pen_up_z:.3f} F{cal.z_feed:.0f}"
    pen_down = f"G1 Z{cal.pen_down_z:.3f} F{cal.z_feed:.0f}"
    lines = ["G21", "G90", pen_up]
    raw_pl = [[(float(p.real), float(p.imag)) for p in arr] for arr in drawing.polylines]
    merged_pl = merge_polylines(raw_pl, tol=cal.merge_tolerance)
    merged_arrays = [np.array([complex(x, y) for x, y in pl]) for pl in merged_pl]
    if continuous:
        merged_arrays = continuous_path(merged_arrays, tol=cal.merge_tolerance)

    obstacles = cal.obstacles or []
    cursor: tuple[float, float] = (0.0, 0.0)
    for poly in _sorted_for_travel(merged_arrays):
        px, py = tx(poly[0])
        for wx, wy in route_travel(cursor, (px, py), obstacles):
            lines.append(f"G0 X{wx:.3f} Y{wy:.3f} F{cal.travel_feed:.0f}")
        lines.append(pen_down)
        for point in poly[1:]:
            px, py = tx(point)
            lines.append(f"G1 X{px:.3f} Y{py:.3f} F{cal.draw_feed:.0f}")
        lines.append(pen_up)
        cursor = tx(poly[-1])
    if cal.park_after_plot:
        park: tuple[float, float] = (cal.bed_width / 2, cal.bed_height)
        for wx, wy in route_travel(cursor, park, obstacles):
            lines.append(f"G0 X{wx:.3f} Y{wy:.3f} F{cal.travel_feed:.0f}")
    lines.append("M2")
    gcode = "\n".join(lines) + "\n"

    GcodeSafetyChecker(cal).check(gcode, name=name)
    return calibration_comment(cal) + gcode
