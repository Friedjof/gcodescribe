from __future__ import annotations

from datetime import UTC, datetime
from xml.etree.ElementTree import Element, ParseError, SubElement, fromstring, indent, tostring

from .calibration import Calibration
from .services.errors import ServiceError


class CalibrationImportError(ServiceError):
    """The uploaded XML is not a valid calibration document."""


def calibration_to_xml(cal: Calibration) -> str:
    """Serialise the calibration as a standalone XML document."""
    root = Element("plotterCalibration", version="1")
    root.set("exported", datetime.now(UTC).isoformat(timespec="seconds"))

    SubElement(root, "bed", width=f"{cal.bed_width}", height=f"{cal.bed_height}")
    SubElement(
        root,
        "plotArea",
        x=f"{cal.origin_x}",
        y=f"{cal.origin_y}",
        width=f"{cal.plot_width}",
        height=f"{cal.plot_height}",
    )

    paper = SubElement(root, "paper", margin=f"{cal.paper_margin}")
    for name, point in sorted(cal.paper_corners.items()):
        SubElement(paper, "corner", id=name, x=f"{point[0]}", y=f"{point[1]}")

    SubElement(
        root,
        "pen",
        upZ=f"{cal.pen_up_z}",
        downZ=f"{cal.pen_down_z}",
        calibrated=str(cal.pen_calibrated).lower(),
    )
    SubElement(
        root,
        "feedrates",
        travel=f"{cal.travel_feed}",
        draw=f"{cal.draw_feed}",
        z=f"{cal.z_feed}",
    )
    SubElement(
        root,
        "layout",
        fitToArea=str(cal.fit_to_area).lower(),
        flipY=str(cal.flip_y).lower(),
    )

    indent(root)
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + tostring(root, encoding="unicode") + "\n"


def calibration_from_xml(xml: str, *, base: Calibration | None = None) -> Calibration:
    """Parse a calibration XML document (as produced by ``calibration_to_xml``).

    Missing elements/attributes fall back to ``base`` (or the defaults), so a
    partial document still imports cleanly. Returns a new ``Calibration``;
    the caller decides whether to persist it.
    """
    try:
        root = fromstring(xml)
    except ParseError as exc:
        raise CalibrationImportError(f"Ungültige XML-Datei: {exc}") from exc
    if root.tag != "plotterCalibration":
        raise CalibrationImportError(
            f"Kein Kalibrierungs-Dokument (Wurzelelement <{root.tag}>, "
            "erwartet <plotterCalibration>)."
        )

    cal = base or Calibration()
    updates: dict = {}

    def num(el: Element | None, attr: str, target: str) -> None:
        if el is not None and el.get(attr) is not None:
            try:
                updates[target] = float(el.get(attr))
            except ValueError as exc:
                raise CalibrationImportError(
                    f"Ungültiger Wert für {target}: {el.get(attr)!r}"
                ) from exc

    def flag(el: Element | None, attr: str, target: str) -> None:
        if el is not None and el.get(attr) is not None:
            updates[target] = el.get(attr).strip().lower() in ("true", "1", "yes")

    bed = root.find("bed")
    num(bed, "width", "bed_width")
    num(bed, "height", "bed_height")

    area = root.find("plotArea")
    num(area, "x", "origin_x")
    num(area, "y", "origin_y")
    num(area, "width", "plot_width")
    num(area, "height", "plot_height")

    paper = root.find("paper")
    if paper is not None:
        num(paper, "margin", "paper_margin")
        corners: dict[str, list[float]] = {}
        for corner in paper.findall("corner"):
            cid = corner.get("id")
            try:
                cx, cy = float(corner.get("x")), float(corner.get("y"))
            except (TypeError, ValueError) as exc:
                raise CalibrationImportError(
                    f"Ungültige Papier-Ecke {cid!r}."
                ) from exc
            if cid:
                corners[cid] = [cx, cy]
        if corners:
            updates["paper_corners"] = corners

    pen = root.find("pen")
    num(pen, "upZ", "pen_up_z")
    num(pen, "downZ", "pen_down_z")
    flag(pen, "calibrated", "pen_calibrated")

    feeds = root.find("feedrates")
    num(feeds, "travel", "travel_feed")
    num(feeds, "draw", "draw_feed")
    num(feeds, "z", "z_feed")

    layout = root.find("layout")
    flag(layout, "fitToArea", "fit_to_area")
    flag(layout, "flipY", "flip_y")

    return cal.merged(updates)


def calibration_comment(cal: Calibration) -> str:
    """Calibration as a G-code comment block, embedded in every export."""
    lines = ["; --- plotter calibration ---"]
    for key, value in cal.as_dict().items():
        lines.append(f"; {key} = {value}")
    lines.append("; ---------------------------")
    return "\n".join(lines) + "\n"
