from __future__ import annotations

import math
import time
from pathlib import Path

from .calibration import Calibration
from .export import calibration_comment
from .jobmeta import profile_comment, write_job_meta
from .linemerge import merge_polylines
from .pipeline import PlotterError
from .routing import route_travel
from .safety import GcodeSafetyChecker
from .storage import jobs_dir

Point = tuple[float, float]
Polyline = list[Point]
Polygon = list[Point]
EPS = 1e-9


def _transform_point(point: list | tuple, transform: dict) -> Point:
    scale = float(transform.get("scale", 1.0))
    x = float(point[0]) * float(transform.get("scaleX") or scale)
    y = float(point[1]) * float(transform.get("scaleY") or scale)
    rot = float(transform.get("rotation", 0.0))
    cos_r, sin_r = math.cos(rot), math.sin(rot)
    return (
        float(transform.get("x", 0.0)) + x * cos_r - y * sin_r,
        float(transform.get("y", 0.0)) + x * sin_r + y * cos_r,
    )


def _is_mask(obj: dict) -> bool:
    return obj.get("type") == "mask-rect" or obj.get("data", {}).get("mask") == "erase"


def _mask_polygon(obj: dict) -> Polygon | None:
    transform = obj.get("transform") or {"x": 0, "y": 0, "rotation": 0, "scale": 1}
    raw = next((line for line in obj.get("cachedPolylines") or [] if len(line) >= 4), None)
    if raw is None:
        return None
    pts = [_transform_point(point, transform) for point in raw]
    if len(pts) > 1 and math.dist(pts[0], pts[-1]) <= EPS:
        pts = pts[:-1]
    return pts if len(pts) >= 3 else None


def _inside_convex(p: Point, poly: Polygon) -> bool:
    signs: list[float] = []
    for i, a in enumerate(poly):
        b = poly[(i + 1) % len(poly)]
        cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
        if abs(cross) > EPS:
            signs.append(cross)
    return bool(signs) and (all(s >= 0 for s in signs) or all(s <= 0 for s in signs))


def _segment_intersection_t(a: Point, b: Point, c: Point, d: Point) -> float | None:
    rx, ry = b[0] - a[0], b[1] - a[1]
    sx, sy = d[0] - c[0], d[1] - c[1]
    den = rx * sy - ry * sx
    if abs(den) <= EPS:
        return None
    qpx, qpy = c[0] - a[0], c[1] - a[1]
    t = (qpx * sy - qpy * sx) / den
    u = (qpx * ry - qpy * rx) / den
    if -EPS <= t <= 1 + EPS and -EPS <= u <= 1 + EPS:
        return max(0.0, min(1.0, t))
    return None


def _lerp(a: Point, b: Point, t: float) -> Point:
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def _subtract_polygon_from_segment(a: Point, b: Point, poly: Polygon) -> list[Polyline]:
    ts = {0.0, 1.0}
    for i, c in enumerate(poly):
        d = poly[(i + 1) % len(poly)]
        t = _segment_intersection_t(a, b, c, d)
        if t is not None:
            ts.add(t)
    ordered = sorted(ts)
    out: list[Polyline] = []
    for t0, t1 in zip(ordered, ordered[1:], strict=False):
        if t1 - t0 <= EPS:
            continue
        mid = _lerp(a, b, (t0 + t1) / 2)
        if _inside_convex(mid, poly):
            continue
        p0, p1 = _lerp(a, b, t0), _lerp(a, b, t1)
        if math.dist(p0, p1) > EPS:
            out.append([p0, p1])
    return out


def _subtract_polygon(line: Polyline, poly: Polygon) -> list[Polyline]:
    pieces: list[Polyline] = []
    current: Polyline = []
    for a, b in zip(line, line[1:], strict=False):
        visible = _subtract_polygon_from_segment(a, b, poly)
        for seg in visible:
            if current and math.dist(current[-1], seg[0]) <= EPS:
                current.append(seg[1])
            else:
                if len(current) > 1:
                    pieces.append(current)
                current = seg[:]
        if not visible and len(current) > 1:
            pieces.append(current)
            current = []
    if len(current) > 1:
        pieces.append(current)
    return pieces


def _apply_masks(lines: list[Polyline], masks: list[Polygon]) -> list[Polyline]:
    for mask in masks:
        next_lines: list[Polyline] = []
        for line in lines:
            next_lines.extend(_subtract_polygon(line, mask))
        lines = next_lines
    return lines


def page_polylines(page: dict) -> list[Polyline]:
    """Return unplotted scene polylines in plot-area mm, editor y-down space."""
    lines: list[Polyline] = []
    objects = sorted(
        (obj for obj in page.get("objects", []) if not obj.get("plotted")),
        key=lambda obj: float(obj.get("zOrder", 0.0)),
    )
    for obj in objects:
        if _is_mask(obj):
            mask = _mask_polygon(obj)
            if mask:
                lines = _apply_masks(lines, [mask])
            continue
        transform = obj.get("transform") or {"x": 0, "y": 0, "rotation": 0, "scale": 1}
        for raw_line in obj.get("cachedPolylines") or []:
            if len(raw_line) < 2:
                continue
            line = [_transform_point(point, transform) for point in raw_line]
            if len(line) > 1:
                lines.append(line)
    return lines


def page_thumbnail(page: dict, target: float = 100.0) -> dict | None:
    """A tiny preview of a page for the sidebar list.

    Returns ``{"d": svg_path, "w": int, "h": int}`` with coordinates fitted to
    the drawing's bounding box and quantised to a ``target``-unit grid, or
    ``None`` for an empty page. Quantising + de-duplicating consecutive points
    keeps the path string small enough to live in the (fully loaded) page index.
    """
    # Unlike page_polylines, the thumbnail shows every object regardless of its
    # plotted flag — a finished page should still preview its full artwork.
    objects = sorted(
        page.get("objects", []), key=lambda obj: float(obj.get("zOrder", 0.0))
    )
    lines: list[Polyline] = []
    for obj in objects:
        if _is_mask(obj):
            mask = _mask_polygon(obj)
            if mask:
                lines = _apply_masks(lines, [mask])
            continue
        transform = obj.get("transform") or {"x": 0, "y": 0, "rotation": 0, "scale": 1}
        for raw_line in obj.get("cachedPolylines") or []:
            if len(raw_line) < 2:
                continue
            line = [_transform_point(point, transform) for point in raw_line]
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
                continue  # collapse points that coincide at thumbnail resolution
            last = (nx, ny)
            pts.append(f"{nx},{ny}")
        if len(pts) >= 2:
            parts.append("M" + "L".join(pts))
    if not parts:
        return None
    return {"d": "".join(parts), "w": round(w * scale), "h": round(h * scale)}


def _obs_to_local_polygon(obs: dict, cal: Calibration) -> Polygon:
    """Convert a bed-coordinate obstacle rect to a local (editor mm, y-down) polygon.

    The inverse of the printer() coordinate transform used in scene_gcode.
    """
    ox, oy, ow, oh = obs["x"], obs["y"], obs["w"], obs["h"]
    lx0 = ox - cal.origin_x
    lx1 = ox + ow - cal.origin_x
    if cal.flip_y:
        ly0 = cal.plot_height + cal.origin_y - oy - oh  # upper edge in SVG (small local y)
        ly1 = cal.plot_height + cal.origin_y - oy       # lower edge in SVG (large local y)
    else:
        ly0 = oy - cal.origin_y
        ly1 = oy + oh - cal.origin_y
    return [(lx0, ly0), (lx1, ly0), (lx1, ly1), (lx0, ly1)]


def _sorted_for_travel(polylines: list[Polyline]) -> list[Polyline]:
    if len(polylines) > 4000:
        return polylines
    remaining = list(polylines)
    ordered: list[Polyline] = []
    cursor = (0.0, 0.0)
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


def scene_gcode(page: dict, cal: Calibration) -> str:
    polylines = page_polylines(page)
    if not polylines:
        raise PlotterError("Die Seite enthält keine ungeplotteten Linien.")

    # Clip drawing strokes that cross obstacle zones (treat like erase masks).
    # This stops the pen from drawing through a clamp; the safety checker then
    # validates that no segment (travel or draw) penetrates any obstacle.
    if cal.obstacles:
        obs_polys = [_obs_to_local_polygon(obs, cal) for obs in cal.obstacles]
        polylines = _apply_masks(polylines, obs_polys)
        if not polylines:
            raise PlotterError("Die Seite enthält keine ungeplotteten Linien.")

    # Join pieces that meet end-to-end into continuous strokes, so a wall the
    # eye reads as one line is plotted without lifting the pen at every segment.
    polylines = merge_polylines(polylines)

    pen_up = f"G0 Z{cal.pen_up_z:.3f} F{cal.z_feed:.0f}"
    pen_down = f"G1 Z{cal.pen_down_z:.3f} F{cal.z_feed:.0f}"
    lines = ["G21", "G90", pen_up]

    def printer(point: Point) -> Point:
        x, y = point
        if cal.flip_y:
            return cal.origin_x + x, cal.origin_y + cal.plot_height - y
        return cal.origin_x + x, cal.origin_y + y

    obstacles = cal.obstacles or []
    cursor: Point = (0.0, 0.0)  # current printer position (home after G28)

    for poly in _sorted_for_travel(polylines):
        dest = printer(poly[0])
        for wx, wy in route_travel(cursor, dest, obstacles):
            lines.append(f"G0 X{wx:.3f} Y{wy:.3f} F{cal.travel_feed:.0f}")
        lines.append(pen_down)
        for point in poly[1:]:
            x, y = printer(point)
            lines.append(f"G1 X{x:.3f} Y{y:.3f} F{cal.draw_feed:.0f}")
        lines.append(pen_up)
        cursor = printer(poly[-1])

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
    """Write a G-code job for ``page`` into ``jobs_dir()`` and return its path.

    ``filename_tag`` inserts a stable segment before the timestamp, e.g.
    ``color-01-schwarz`` -> ``paint-{stem}-color-01-schwarz-{ts}.gcode``; this
    is how coloring jobs stay recognisable in the job list. ``source_kind`` and
    ``source_extra`` are merged into the sidecar ``source`` block so callers can
    tag a job (e.g. as a coloring job carrying its colour and group id).
    """
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
