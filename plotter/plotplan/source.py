"""Scene preparation preserving existing masks, source order and pressure semantics.

No routing, G-code, persistence or hardware access. Coordinates remain editor mm
until the adapter freezes them in a PlotPlan. Import reconstruction and legacy
merge/continuous decisions are deliberately separate from route optimization.
"""
from __future__ import annotations

import math

from plotter.artwork.pipeline import PlotterError
from plotter.core.calibration import Calibration
from plotter.gcode.pressure import (
    PressureLine,
    clip_pressure_lines,
    page_uses_pressure,
    point_pressures,
)
from plotter.geometry.linemerge import merge_polylines
from plotter.geometry.oneline import continuous_polylines
from plotter.geometry.primitives import (
    Polygon,
    Polyline,
    apply_masks,
    is_mask,
    mask_polygon,
    transform_point,
)
from plotter.geometry.singlepass import single_pass_polylines


def page_polylines(page: dict) -> list[Polyline]:
    """Return unplotted scene polylines in plot-area mm, editor y-down space."""
    lines: list[Polyline] = []
    objects = sorted(
        (obj for obj in page.get("objects", []) if not obj.get("plotted")),
        key=lambda obj: float(obj.get("zOrder", 0.0)),
    )
    for obj in objects:
        if is_mask(obj):
            m = mask_polygon(obj)
            if m:
                lines = apply_masks(lines, [m])
            continue
        transform = obj.get("transform") or {"x": 0, "y": 0, "rotation": 0, "scale": 1}
        for raw_line in obj.get("cachedPolylines") or []:
            if len(raw_line) < 2:
                continue
            line = [transform_point(point, transform) for point in raw_line]
            if len(line) > 1:
                lines.append(line)
    return lines


def page_thumbnail(page: dict, target: float = 100.0) -> dict | None:
    """A tiny preview of a page for the sidebar list.

    Returns ``{"d": svg_path, "w": int, "h": int}`` with coordinates fitted to
    the drawing's bounding box and quantised to a ``target``-unit grid, or
    ``None`` for an empty page.
    """
    objects = sorted(
        page.get("objects", []), key=lambda obj: float(obj.get("zOrder", 0.0))
    )
    # Sidebar-only LOD. Never touch stored geometry or the G-code pipeline.
    raw_lines = [line for obj in objects if not is_mask(obj)
                 for line in obj.get("cachedPolylines") or [] if len(line) >= 2]
    line_step = max(1, math.ceil(len(raw_lines) / 500))
    sampled = raw_lines[::line_step]
    selected_lines = {id(line) for line in sampled}
    point_step = max(1, math.ceil(sum(len(line) for line in sampled) / 1500))
    lines: list[Polyline] = []
    for obj in objects:
        if is_mask(obj):
            m = mask_polygon(obj)
            if m:
                lines = apply_masks(lines, [m])
            continue
        transform = obj.get("transform") or {"x": 0, "y": 0, "rotation": 0, "scale": 1}
        for raw_line in obj.get("cachedPolylines") or []:
            if len(raw_line) < 2 or id(raw_line) not in selected_lines:
                continue
            sample = raw_line[::point_step]
            if sample[-1] is not raw_line[-1]:
                sample = [*sample, raw_line[-1]]
            line = [transform_point(point, transform) for point in sample]
            lines.append(line)
    if not lines:
        return None
    xs = [p[0] for line in lines for p in line]
    ys = [p[1] for line in lines for p in line]
    min_x, min_y = min(xs), min(ys)
    w = max(max(xs) - min_x, 1e-6)
    h = max(max(ys) - min_y, 1e-6)
    scale = target / max(w, h)

    parts: list[str] = []
    for line in lines:
        pts: list[str] = []
        last: tuple[int, int] | None = None
        for x, y in line:
            nx = round((x - min_x) * scale)
            ny = round((y - min_y) * scale)
            if (nx, ny) == last:
                continue
            last = (nx, ny)
            pts.append(f"{nx},{ny}")
        if len(pts) >= 2:
            parts.append("M" + "L".join(pts))
    if not parts:
        return None
    return {"d": "".join(parts), "w": round(w * scale), "h": round(h * scale)}


def _obs_to_local_polygon(obs: dict, cal: Calibration) -> Polygon:
    """Convert a bed-coordinate obstacle rect to a local (editor mm, y-down) polygon."""
    ox, oy, ow, oh = obs["x"], obs["y"], obs["w"], obs["h"]
    lx0 = ox - cal.origin_x
    lx1 = ox + ow - cal.origin_x
    if cal.flip_y:
        ly0 = cal.plot_height + cal.origin_y - oy - oh
        ly1 = cal.plot_height + cal.origin_y - oy
    else:
        ly0 = oy - cal.origin_y
        ly1 = oy + oh - cal.origin_y
    return [(lx0, ly0), (lx1, ly0), (lx1, ly1), (lx0, ly1)]


FeedLine = tuple[Polyline, list[float]]

def _is_feed_object(obj: dict) -> bool:
    """A stroke-font text object that carries per-point feed scales."""
    feeds = obj.get("cachedFeeds")
    polys = obj.get("cachedPolylines")
    return (
        isinstance(feeds, list)
        and isinstance(polys, list)
        and len(polys) > 0
        and len(feeds) == len(polys)
    )


def _is_ordered_object(obj: dict) -> bool:
    return (obj.get("data") or {}).get("strokeOrder") == "source"


def _ordered_lines(page: dict) -> list[PressureLine]:
    """Source order and pressure stay aligned, including beneath scene masks."""
    lines: list[PressureLine] = []
    objects = sorted(
        (obj for obj in page.get("objects", []) if not obj.get("plotted")),
        key=lambda obj: float(obj.get("zOrder", 0.0)),
    )
    for obj in objects:
        if is_mask(obj):
            if (mask := mask_polygon(obj)) is not None:
                lines = clip_pressure_lines(lines, [mask])
            continue
        if not _is_ordered_object(obj):
            continue
        data = obj.get("data") or {}
        enabled = data.get("pressureEnabled") is True
        raw_lines = obj.get("cachedPolylines") or []
        pressures = data.get("cachedSegmentPressures")
        if pressures is None and data.get("basePolylines") == raw_lines:
            pressures = data.get("baseSegmentPressures")
        if enabled and (not isinstance(pressures, list) or len(pressures) != len(raw_lines)):
            raise PlotterError(
                "Die Druckwerte fehlen oder passen nicht zu den Stiftwegen. "
                "Bitte das Xournal-Objekt erneut aus der Galerie einfügen."
            )
        transform = obj.get("transform") or {"x": 0, "y": 0, "rotation": 0, "scale": 1}
        has_pressure = False
        for i, raw_line in enumerate(raw_lines):
            if len(raw_line) < 2:
                continue
            values = point_pressures(pressures[i], len(raw_line)) if enabled else None
            has_pressure |= values is not None
            lines.append(PressureLine([transform_point(p, transform) for p in raw_line], values))
        if enabled and not has_pressure:
            raise PlotterError("Dieses Xournal-Objekt enthält keine nutzbare Druckvariation.")
    return lines


def _coerce_feeds(raw: object, n: int) -> list[float]:
    """`n` feed scales from `raw`, defaulting missing/invalid entries to 1.0."""
    out: list[float] = []
    for i in range(n):
        v = raw[i] if isinstance(raw, list) and i < len(raw) else 1.0
        out.append(float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else 1.0)
    return out


def _feed_lines(page: dict) -> tuple[list[FeedLine], list[Polyline]]:
    """Variable-feed lines from feed objects, plus fallbacks (feed dropped).

    A feed line keeps its per-point scales only if no higher-z mask alters it;
    otherwise its (correctly masked) geometry falls back to uniform feed.
    """
    objects = sorted(
        (obj for obj in page.get("objects", []) if not obj.get("plotted")),
        key=lambda obj: float(obj.get("zOrder", 0.0)),
    )
    masks = [
        (float(obj.get("zOrder", 0.0)), poly)
        for obj in objects
        if is_mask(obj) and (poly := mask_polygon(obj)) is not None
    ]
    feed_lines: list[FeedLine] = []
    fallback: list[Polyline] = []
    for obj in objects:
        if is_mask(obj) or not _is_feed_object(obj):
            continue
        transform = obj.get("transform") or {"x": 0, "y": 0, "rotation": 0, "scale": 1}
        z = float(obj.get("zOrder", 0.0))
        later = [poly for mz, poly in masks if mz > z]
        raw_feeds = obj.get("cachedFeeds") or []
        for raw_line, raw_feed in zip(obj.get("cachedPolylines") or [], raw_feeds, strict=False):
            if len(raw_line) < 2:
                continue
            line = [transform_point(point, transform) for point in raw_line]
            feeds = _coerce_feeds(raw_feed, len(line))
            masked = apply_masks([line], later) if later else [line]
            if len(masked) == 1 and len(masked[0]) == len(line):
                feed_lines.append((line, feeds))
            else:
                fallback.extend(piece for piece in masked if len(piece) >= 2)
    return feed_lines, fallback


def prepare_scene(page: dict, cal: Calibration):
    # Stroke-font text objects carry per-point feed scales and are plotted with
    # variable feedrate, bypassing merge/continuous so timing survives. Everything
    # else (and any masked feed line) goes through the unchanged uniform-feed path.
    pressure_enabled = page_uses_pressure(page)
    if pressure_enabled:
        try:
            depth = cal.validated_pressure_depth()
        except (TypeError, ValueError) as exc:
            raise PlotterError(str(exc)) from exc
        if depth <= 0:
            raise PlotterError(
                "Für die Druckvariation bitte im Projektprofil die maximale "
                "Zusatzabsenkung größer als 0 mm einstellen."
            )
        if any(not math.isfinite(v) or v <= 0 for v in (cal.z_feed, cal.z_max_feedrate)):
            raise PlotterError(
                "Für die Druckvariation muss die Z-Geschwindigkeit größer als 0 sein."
            )
        if min(cal.z_feed, cal.z_max_feedrate) < 0.000001:
            raise PlotterError("Die Z-Geschwindigkeit ist für die Druckvariation zu klein.")
    ordered_lines = _ordered_lines(page)
    if any(_is_feed_object(obj) for obj in page.get("objects", []) if not obj.get("plotted")):
        non_feed = {
            **page,
            "objects": [obj for obj in page.get("objects", [])
                        if not _is_feed_object(obj) and not _is_ordered_object(obj)],
        }
        polylines = page_polylines(non_feed)
        feed_lines, fallback = _feed_lines(page)
        polylines.extend(fallback)
    else:
        polylines = page_polylines({
            **page, "objects": [obj for obj in page.get("objects", [])
                                if not _is_ordered_object(obj)],
        })
        feed_lines = []

    if not polylines and not feed_lines and not ordered_lines:
        raise PlotterError("Die Seite enthält keine ungeplotteten Linien.")

    points = [point for line in polylines for point in line]
    points.extend(point for line in ordered_lines for point in line.points)
    points.extend(point for line, _ in feed_lines for point in line)
    x0 = min(point[0] for point in points)
    y0 = min(point[1] for point in points)
    x1 = max(point[0] for point in points)
    y1 = max(point[1] for point in points)
    if x0 < -0.001 or y0 < -0.001 or x1 > cal.plot_width + 0.001 or y1 > cal.plot_height + 0.001:
        raise PlotterError(
            f"Die Zeichnung liegt außerhalb der aktuellen Projektfläche: "
            f"Inhalt X {x0:.1f}–{x1:.1f} mm, Y {y0:.1f}–{y1:.1f} mm; "
            f"verfügbar X 0–{cal.plot_width:g} mm, Y 0–{cal.plot_height:g} mm. "
            "Bitte die Zeichnung im Designer verschieben oder proportional einpassen."
        )

    if cal.obstacles:
        obs_polys = [_obs_to_local_polygon(obs, cal) for obs in cal.obstacles]
        polylines = apply_masks(polylines, obs_polys)
        ordered_lines = clip_pressure_lines(ordered_lines, obs_polys)
        kept: list[FeedLine] = []
        for line, feeds in feed_lines:
            masked = apply_masks([line], obs_polys)
            if len(masked) == 1 and len(masked[0]) == len(line):
                kept.append((line, feeds))
            else:
                polylines.extend(piece for piece in masked if len(piece) >= 2)
        feed_lines = kept
        if not polylines and not feed_lines and not ordered_lines:
            raise PlotterError("Die Seite enthält keine ungeplotteten Linien.")

    drawable = [
        obj for obj in page.get("objects", []) if not obj.get("plotted") and not is_mask(obj)
    ]
    map_page = bool(drawable) and all(
        (obj.get("data") or {}).get("template") == "osmMap" for obj in drawable
    )
    # Dense map streets must not be snapped together at the larger pen-art
    # merge tolerance; it can join distinct neighbouring roads / rail tracks.
    merge_tol = min(cal.merge_tolerance, 0.001) if map_page else cal.merge_tolerance
    polylines = merge_polylines(polylines, tol=merge_tol)

    merged_draw_mm = sum(math.dist(a, b) for line in polylines
                         for a, b in zip(line, line[1:], strict=False))

    # Draw each connected component in one continuous stroke (retracing existing
    # lines only — no visible connectors), so the pen barely lifts. ON by default
    # (set the page's "continuous" to False to opt out); the shape is preserved.
    if page.get("continuous", True):
        polylines = continuous_polylines(polylines, merge_tol)
    elif map_page:
        polylines = single_pass_polylines(polylines, tol=merge_tol)

    return polylines, feed_lines, ordered_lines, pressure_enabled, merged_draw_mm
