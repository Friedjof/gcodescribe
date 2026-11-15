from __future__ import annotations

import re
import tempfile
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from xml.etree import ElementTree as ET
from xml.etree.ElementTree import ParseError

import numpy as np
import vpype

from plotter.artwork.export import calibration_comment
from plotter.artwork.pipeline import PlotterError
from plotter.core.calibration import Calibration, feed_word, z_max_feedrate_line
from plotter.gcode.safety import GcodeSafetyChecker
from plotter.geometry.linemerge import merge_polylines
from plotter.geometry.oneline import continuous_path
from plotter.geometry.routing import route_travel
from plotter.geometry.travel import sort_for_travel_complex

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
_SVG_NS = "{http://www.w3.org/2000/svg}"
_XLINK_HREF = "{http://www.w3.org/1999/xlink}href"
_TRANSLATE = re.compile(r"^translate\(\s*([+-]?[\d.]+)\s*,\s*([+-]?[\d.]+)\s*\)$")


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
        result = vpype.read_svg(path, quantization=quantization)
        if result[0].lines:
            return result
        recovered = _cairo_composited_paths(path)
        if recovered is not None:
            with tempfile.NamedTemporaryFile(
                "wb", suffix=".svg", delete=False
            ) as tmp:
                tmp.write(recovered)
                tmp_path = tmp.name
            try:
                return vpype.read_svg(tmp_path, quantization=quantization)
            finally:
                Path(tmp_path).unlink(missing_ok=True)
        return result
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


def _cairo_composited_paths(path: str, *, filled: bool = False) -> bytes | None:
    """Recover outlines from Cairo SVGs whose *only* visible element is a
    filtered rectangle. Cairo puts each path in a referenced compositing group;
    vpype cannot evaluate the filter and otherwise reports an empty drawing.

    This deliberately accepts only the known layout where every path's group
    translation cancels the top-level translation. Other filter layouts need a
    real SVG renderer, so guessing at their hidden definitions would be wrong.
    """
    try:
        root = ET.parse(path).getroot()
    except (OSError, ParseError):
        return None
    if root.tag != _SVG_NS + "svg":
        return None
    children = list(root)
    if len(children) != 2 or children[0].tag != _SVG_NS + "defs":
        return None
    defs, visible = children
    if visible.tag != _SVG_NS + "g" or not visible.get("filter", "").startswith("url(#filter-"):
        return None
    if len(visible) != 1 or visible[0].tag != _SVG_NS + "rect":
        return None
    outer = _TRANSLATE.fullmatch(visible.get("transform", ""))
    if outer is None:
        return None
    offset = tuple(float(v) for v in outer.groups())
    if not any(node.tag == _SVG_NS + "feImage" for node in defs.iter()):
        return None

    referenced = {
        node.get(_XLINK_HREF, "")[1:]
        for node in defs.iter()
        if node.tag == _SVG_NS + "use" and node.get(_XLINK_HREF, "").startswith("#")
    }
    paths = list(defs.iter(_SVG_NS + "path"))
    if not paths:
        return None
    parents = {child: parent for parent in defs.iter() for child in parent}
    recovered = ET.Element(_SVG_NS + "svg", {
        key: value for key, value in root.attrib.items()
        if key in ("width", "height", "viewBox", "preserveAspectRatio")
    })
    for source in paths:
        group = parents[source]
        if (group.tag != _SVG_NS + "g"
                or not re.fullmatch(r"compositing-group-\d+", group.get("id", ""))
                or group.get("id") not in referenced):
            return None
        inner = _TRANSLATE.fullmatch(group.get("transform", ""))
        if inner is None or any(
            abs(float(value) + outer_value) > 1e-5
            for value, outer_value in zip(inner.groups(), offset, strict=True)
        ):
            return None
        if (len(group) != 2 or group[0].tag != _SVG_NS + "rect"
                or group[0].get("fill-opacity") != "0"
                or group[1] is not source or not source.get("d")):
            return None
        attributes = {"d": source.get("d", "")}
        if filled:
            attributes.update({"fill": "black", "fill-rule": source.get("fill-rule", "nonzero")})
        else:
            attributes.update({"fill": "none", "stroke": "black"})
        ET.SubElement(recovered, _SVG_NS + "path", attributes)
    return ET.tostring(recovered, encoding="utf-8", xml_declaration=True)


def svg_raster_source(path: Path) -> bytes:
    """Use the visible filled paths for Cairo's filter-composited SVG export."""
    return _cairo_composited_paths(str(path), filled=True) or path.read_bytes()


@dataclass
class Drawing:
    """Polylines of a source page in mm, SVG coordinates (y pointing down)."""

    polylines: list[np.ndarray]  # complex arrays, mm
    width: float  # page width in mm
    height: float  # page height in mm
    # Relative pressure per segment, parallel to polylines. A stroke with N
    # points has N - 1 values; None keeps the ordinary constant pen height.
    segment_pressures: list[list[float] | None] | None = None

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


def placed_gcode(
    drawing: Drawing,
    cal: Calibration,
    *,
    x: float,
    y: float,
    width: float,
    name: str = "placement",
    continuous: bool = True,
    preserve_order: bool = False,
) -> str:
    """G-code for the drawing scaled to ``width`` mm with its lower-left
    corner at printer position (``x``, ``y``).

    The SVG y-axis (down) is flipped into printer space (up). The result is
    validated by the safety checker, so it can never leave the plot area or
    the calibrated pen heights.

    With ``continuous=True`` the whole drawing is collapsed into a single
    pen-down stroke (see :func:`plotter.geometry.oneline.continuous_path`) so the pen
    never lifts between the first and last point.
    """
    if drawing.is_empty():
        raise PlotterError("Die Zeichnung enthält keine Linien.")
    if width <= 0:
        raise PlotterError("Breite muss größer als 0 sein.")
    bx0, by0, bx1, by1 = drawing.bounds()
    bw = bx1 - bx0
    span = bw if bw > 0 else (by1 - by0 if by1 > by0 else 1.0)
    scale = width / span

    def tx(p: complex) -> tuple[float, float]:
        return (x + (p.real - bx0) * scale, y + (by1 - p.imag) * scale)

    pen_up = f"G0 Z{cal.pen_up_z:.3f} {feed_word(cal.z_feed)}"
    pen_down = f"G1 Z{cal.pen_down_z:.3f} {feed_word(cal.z_feed)}"
    lines = ["G21", "G90", z_max_feedrate_line(cal), pen_up]
    if preserve_order:
        plot_lines = drawing.polylines
    else:
        raw_pl = [[(float(p.real), float(p.imag)) for p in arr] for arr in drawing.polylines]
        merged_pl = merge_polylines(raw_pl, tol=cal.merge_tolerance)
        merged_arrays = [np.array([complex(x, y) for x, y in pl]) for pl in merged_pl]
        if continuous:
            merged_arrays = continuous_path(merged_arrays, tol=cal.merge_tolerance)
        plot_lines = sort_for_travel_complex(merged_arrays)

    obstacles = cal.obstacles or []
    cursor: tuple[float, float] = (0.0, 0.0)
    for poly in plot_lines:
        px, py = tx(poly[0])
        for wx, wy in route_travel(cursor, (px, py), obstacles):
            lines.append(f"G0 X{wx:.3f} Y{wy:.3f} {feed_word(cal.travel_feed)}")
        lines.append(pen_down)
        for point in poly[1:]:
            px, py = tx(point)
            lines.append(f"G1 X{px:.3f} Y{py:.3f} {feed_word(cal.draw_feed)}")
        lines.append(pen_up)
        cursor = tx(poly[-1])
    if cal.park_after_plot:
        park_x, park_y, park_lift_z = cal.resolved_park()
        if abs(park_lift_z - cal.pen_up_z) > 1e-6:
            lines.append(f"G0 Z{park_lift_z:.3f} {feed_word(cal.z_feed)}")
        park: tuple[float, float] = (park_x, park_y)
        for wx, wy in route_travel(cursor, park, obstacles):
            lines.append(f"G0 X{wx:.3f} Y{wy:.3f} {feed_word(cal.travel_feed)}")
    lines.append("M2")
    gcode = "\n".join(lines) + "\n"

    GcodeSafetyChecker(cal).check(gcode, name=name)
    return calibration_comment(cal) + gcode
