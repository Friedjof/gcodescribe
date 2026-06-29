from __future__ import annotations

import math
import time
from pathlib import Path

import numpy as np

from .calibration import Calibration
from .export import calibration_comment
from .jobmeta import profile_comment, write_job_meta
from .linemerge import merge_polylines
from .oneline import continuous_polylines
from .pipeline import PlotterError
from .routing import route_travel
from .safety import GcodeSafetyChecker
from .scene_geometry import (
    Point,
    Polygon,
    Polyline,
    apply_masks,
    is_mask,
    mask_polygon,
    transform_point,
)
from .storage import jobs_dir


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
    lines: list[Polyline] = []
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


def _sorted_for_travel(polylines: list[Polyline]) -> list[Polyline]:
    if len(polylines) > 4000:
        return _sorted_for_travel_large(polylines)
    remaining = list(polylines)
    ordered: list[Polyline] = []
    cursor: Point = (0.0, 0.0)
    while remaining:
        best_i, best_rev, best_d = 0, False, float("inf")
        for i, line in enumerate(remaining):
            d_start = math.hypot(line[0][0] - cursor[0], line[0][1] - cursor[1])
            d_end = math.hypot(line[-1][0] - cursor[0], line[-1][1] - cursor[1])
            if d_start < best_d:
                best_i, best_rev, best_d = i, False, d_start
            if d_end < best_d:
                best_i, best_rev, best_d = i, True, d_end
        line = remaining.pop(best_i)
        if best_rev:
            line = list(reversed(line))
        ordered.append(line)
        cursor = line[-1]
    return ordered


def _sorted_for_travel_large(polylines: list[Polyline]) -> list[Polyline]:
    """KD-tree greedy nearest-neighbour ordering for large stroke counts, so even
    big non-continuous pages keep their (invisible) pen-up travel short."""
    from scipy.spatial import cKDTree

    n = len(polylines)
    pts = np.empty((2 * n, 2))
    for i, line in enumerate(polylines):
        pts[2 * i] = line[0]
        pts[2 * i + 1] = line[-1]
    tree = cKDTree(pts)
    used = bytearray(n)
    ordered: list[Polyline] = []
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
            line = list(reversed(line))
        ordered.append(line)
        cursor = np.array([line[-1][0], line[-1][1]])
    return ordered


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
    if any(_is_feed_object(obj) for obj in page.get("objects", []) if not obj.get("plotted")):
        non_feed = {
            **page,
            "objects": [obj for obj in page.get("objects", []) if not _is_feed_object(obj)],
        }
        polylines = page_polylines(non_feed)
        feed_lines, fallback = _feed_lines(page)
        polylines.extend(fallback)
    else:
        polylines = page_polylines(page)
        feed_lines = []

    if not polylines and not feed_lines:
        raise PlotterError("Die Seite enthält keine ungeplotteten Linien.")

    if cal.obstacles:
        obs_polys = [_obs_to_local_polygon(obs, cal) for obs in cal.obstacles]
        polylines = apply_masks(polylines, obs_polys)
        kept: list[FeedLine] = []
        for line, feeds in feed_lines:
            masked = apply_masks([line], obs_polys)
            if len(masked) == 1 and len(masked[0]) == len(line):
                kept.append((line, feeds))
            else:
                polylines.extend(piece for piece in masked if len(piece) >= 2)
        feed_lines = kept
        if not polylines and not feed_lines:
            raise PlotterError("Die Seite enthält keine ungeplotteten Linien.")

    polylines = merge_polylines(polylines, tol=cal.merge_tolerance)

    # Draw each connected component in one continuous stroke (retracing existing
    # lines only — no visible connectors), so the pen barely lifts. ON by default
    # (set the page's "continuous" to False to opt out); the shape is preserved.
    if page.get("continuous", True):
        polylines = continuous_polylines(polylines, cal.merge_tolerance)

    pen_up = f"G0 Z{cal.pen_up_z:.3f} F{cal.z_feed:.0f}"
    pen_down = f"G1 Z{cal.pen_down_z:.3f} F{cal.z_feed:.0f}"
    lines = ["G21", "G90", pen_up]

    def printer(point: Point) -> Point:
        x, y = point
        if cal.flip_y:
            return cal.origin_x + x, cal.origin_y + cal.plot_height - y
        return cal.origin_x + x, cal.origin_y + y

    obstacles = cal.obstacles or []
    cursor: Point = (0.0, 0.0)
    feed_floor = cal.draw_feed * _VAR_MIN_SCALE
    feed_ceil = min(cal.travel_feed, cal.draw_feed * _VAR_MAX_SCALE)

    def emit(poly: Polyline, feeds: list[float] | None) -> None:
        nonlocal cursor
        dest = printer(poly[0])
        for wx, wy in route_travel(cursor, dest, obstacles):
            lines.append(f"G0 X{wx:.3f} Y{wy:.3f} F{cal.travel_feed:.0f}")
        lines.append(pen_down)
        for i, point in enumerate(poly[1:], start=1):
            x, y = printer(point)
            if feeds is None:
                feed = cal.draw_feed
            else:
                scale = feeds[i] if i < len(feeds) else 1.0
                feed = min(feed_ceil, max(feed_floor, cal.draw_feed * scale))
            lines.append(f"G1 X{x:.3f} Y{y:.3f} F{feed:.0f}")
        lines.append(pen_up)
        cursor = printer(poly[-1])

    for poly in _sorted_for_travel(polylines):
        emit(poly, None)
    # Feed lines keep capture order (natural left-to-right writing order).
    for poly, feeds in feed_lines:
        emit(poly, feeds)

    if cal.park_after_plot:
        park: Point = (cal.bed_width / 2, cal.bed_height)
        for wx, wy in route_travel(cursor, park, obstacles):
            lines.append(f"G0 X{wx:.3f} Y{wy:.3f} F{cal.travel_feed:.0f}")
    lines.append("M2")
    gcode = "\n".join(lines) + "\n"
    GcodeSafetyChecker(cal).check(gcode, name=page.get("name") or page.get("id") or "Paint-Seite")
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
        from .services.profiles import ProfileService

        profile = ProfileService().active_profile_meta()
    raw_stem = str(page.get("name") or page.get("id") or "paint")
    stem = "".join(c if c.isalnum() or c in "-_" else "-" for c in raw_stem)
    tag = f"-{filename_tag}" if filename_tag else ""
    path = jobs_dir() / f"paint-{stem[:40]}{tag}-{int(time.time())}.gcode"
    path.write_text(profile_comment(profile) + gcode)
    source = {
        "kind": source_kind,
        "page_id": page.get("id"),
        "page_name": page.get("name"),
    }
    if source_extra:
        source.update(source_extra)
    write_job_meta(path, source=source, profile=profile)
    return path
