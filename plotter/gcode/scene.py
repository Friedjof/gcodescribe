from __future__ import annotations

import math
import time
import uuid
from dataclasses import asdict
from pathlib import Path

from plotter.artwork.export import calibration_comment
from plotter.artwork.pipeline import PlotterError
from plotter.core.calibration import Calibration, feed_word, z_max_feedrate_line
from plotter.core.jobmeta import profile_comment, write_job_meta
from plotter.core.storage import jobs_dir
from plotter.gcode.pressure import (
    PressureLine,
    clip_pressure_lines,
    page_uses_pressure,
    point_pressures,
)
from plotter.gcode.safety import GcodeSafetyChecker
from plotter.geometry.linemerge import merge_polylines
from plotter.geometry.oneline import continuous_polylines
from plotter.geometry.primitives import (
    Point,
    Polygon,
    Polyline,
    apply_masks,
    is_mask,
    mask_polygon,
    transform_point,
)
from plotter.geometry.routing import route_travel
from plotter.geometry.singlepass import single_pass_polylines
from plotter.geometry.travel import sort_for_travel_points


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

# Safety band for variable feedrate, relative to the profile's draw feed.
_VAR_MIN_SCALE = 0.5
_VAR_MAX_SCALE = 1.4


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


def scene_gcode(page: dict, cal: Calibration) -> str:
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

    # Draw each connected component in one continuous stroke (retracing existing
    # lines only — no visible connectors), so the pen barely lifts. ON by default
    # (set the page's "continuous" to False to opt out); the shape is preserved.
    if page.get("continuous", True):
        polylines = continuous_polylines(polylines, merge_tol)
    elif map_page:
        polylines = single_pass_polylines(polylines, tol=merge_tol)

    pen_up = f"G0 Z{cal.pen_up_z:.3f} {feed_word(cal.z_feed)}"
    pen_down = f"G1 Z{cal.pen_down_z:.3f} {feed_word(cal.z_feed)}"
    lines = ["G21", "G90", z_max_feedrate_line(cal), pen_up]

    def printer(point: Point) -> Point:
        x, y = point
        if cal.flip_y:
            return cal.origin_x + x, cal.origin_y + cal.plot_height - y
        return cal.origin_x + x, cal.origin_y + y

    obstacles = cal.obstacles or []
    cursor: Point = (0.0, 0.0)
    feed_floor = cal.draw_feed * _VAR_MIN_SCALE
    feed_ceil = min(cal.travel_feed, cal.draw_feed * _VAR_MAX_SCALE)

    def emit(
        poly: Polyline, feeds: list[float] | None, pressures: list[float] | None = None,
    ) -> None:
        nonlocal cursor
        dest = printer(poly[0])
        for wx, wy in route_travel(cursor, dest, obstacles):
            lines.append(f"G0 X{wx:.3f} Y{wy:.3f} {feed_word(cal.travel_feed)}")
        def pressure_z(value: float) -> float:
            return round(cal.pen_down_z - min(1.0, max(0.0, value)) * cal.pen_pressure_max_depth, 3)

        current_z = cal.pen_down_z if pressures is None else pressure_z(pressures[0])
        lines.append(
            pen_down if pressures is None else f"G1 Z{current_z:.3f} {feed_word(cal.z_feed)}"
        )
        for i, point in enumerate(poly[1:], start=1):
            x, y = printer(point)
            if feeds is None:
                feed = cal.draw_feed
            else:
                scale = feeds[i] if i < len(feeds) else 1.0
                feed = min(feed_ceil, max(feed_floor, cal.draw_feed * scale))
            z_word = ""
            if pressures is not None:
                target_z = pressure_z(pressures[i])
                dz = abs(target_z - current_z)
                # F describes the combined XYZ motion. Respect the profile's
                # Z speed even for short XY segments with a steep pressure change.
                if dz > 0:
                    previous = tuple(round(v, 3) for v in printer(poly[i - 1]))
                    distance = math.dist(previous, (round(x, 3), round(y, 3)))
                    path_length = math.hypot(distance, dz)
                    limit = min(cal.z_feed, cal.z_max_feedrate) * path_length / dz
                    # Round down the F word so serialization cannot exceed
                    # the configured Z limit on short, steep segments.
                    feed = min(feed, math.floor(limit * 60 * 1_000_000) / 60 / 1_000_000)
                z_word = f" Z{target_z:.3f}"
                current_z = target_z
            lines.append(f"G1 X{x:.3f} Y{y:.3f}{z_word} {feed_word(feed)}")
        lines.append(pen_up)
        cursor = printer(poly[-1])

    for poly in sort_for_travel_points(polylines):
        emit(poly, None)
    # Feed lines keep capture order (natural left-to-right writing order).
    for poly, feeds in feed_lines:
        emit(poly, feeds)
    for poly in ordered_lines:
        emit(poly.points, None, poly.pressures)

    if cal.park_after_plot:
        park_x, park_y, park_lift_z = cal.resolved_park()
        if abs(park_lift_z - cal.pen_up_z) > 1e-6:
            lines.append(f"G0 Z{park_lift_z:.3f} {feed_word(cal.z_feed)}")
        park: Point = (park_x, park_y)
        for wx, wy in route_travel(cursor, park, obstacles):
            lines.append(f"G0 X{wx:.3f} Y{wy:.3f} {feed_word(cal.travel_feed)}")
    lines.append("M2")
    gcode = "\n".join(lines) + "\n"
    GcodeSafetyChecker(cal, allow_pressure=pressure_enabled).check(
        gcode, name=page.get("name") or page.get("id") or "Paint-Seite",
    )
    return calibration_comment(cal) + gcode


def save_scene_job(
    page: dict,
    cal: Calibration | None = None,
    profile: dict | None = None,
    *,
    filename_tag: str | None = None,
    source_kind: str = "paint_page",
    source_extra: dict | None = None,
) -> Path:
    """Write a G-code job for ``page`` into ``jobs_dir()`` and return its path."""
    cal = cal or Calibration.load()
    gcode = scene_gcode(page, cal)
    if profile is None:
        from plotter.services.profiles import ProfileService

        profile = ProfileService().active_profile_meta()
    raw_stem = str(page.get("name") or page.get("id") or "paint")
    stem = "".join(c if c.isalnum() or c in "-_" else "-" for c in raw_stem)
    tag = f"-{filename_tag}" if filename_tag else ""
    path = jobs_dir() / f"paint-{stem[:40]}{tag}-{int(time.time())}-{uuid.uuid4().hex[:8]}.gcode"
    path.write_text(profile_comment(profile) + gcode)
    source = {
        "kind": source_kind,
        "page_id": page.get("id"),
        "page_name": page.get("name"),
    }
    if page.get("projectId"):
        source["project_id"] = page["projectId"]
    if source_extra:
        source.update(source_extra)
    if page_uses_pressure(page):
        source["pressure_enabled"] = True
    write_job_meta(
        path, source=source, profile=profile,
        calibration_snapshot={
            "profileId": profile["id"], "profileName": profile["name"],
            "fingerprint": profile["fingerprint"], "calibration": asdict(cal),
            "capturedAt": time.time(),
        } if page.get("projectId") else None,
    )
    return path
