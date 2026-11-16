"""Scene adapter: freeze source state, optimize free strokes, plan every travel."""
from __future__ import annotations

import hashlib
import json
import math
import threading
from collections import OrderedDict
from dataclasses import asdict, replace

from plotter.artwork.pipeline import PlotterError
from plotter.core.calibration import Calibration
from plotter.geometry.routing import (
    OBSTACLE_MARGIN,
    TravelPlanner,
    TravelRoutingError,
    seg_intersects_obs,
)
from plotter.geometry.travel import sort_for_travel_points

from .model import VERSION, Path, PlanReport, PlotPlan, PlotStroke, Point
from .routing import optimize_routes
from .source import prepare_scene

# Cache hashes and immutable results, never the potentially huge source JSON.
# Conservative accounting bounds retained geometry; an oversized plan bypasses
# storage, not validation. This also reuses large slides on preview/job requests.
_CACHE_BYTE_BUDGET = 48 * 1024 * 1024
_CACHE_MAX_PLANS = 8
_cache: OrderedDict[str, tuple[PlotPlan, int]] = OrderedDict()
_cache_lock = threading.Lock()
_cache_bytes = 0


def _json(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _length(points) -> float:
    return sum(math.dist(a, b) for a, b in zip(points, points[1:], strict=False))


def _plan_id(source_json: str, calibration_json: str, optimize: bool) -> str:
    return hashlib.sha256(
        f"plotplan-{VERSION}\0{source_json}\0{calibration_json}\0{optimize}".encode()
    ).hexdigest()


def _build(source_json: str, calibration_json: str, optimize: bool) -> PlotPlan:
    page = json.loads(source_json)
    cal = Calibration.from_dict(json.loads(calibration_json))
    normal, feeds, ordered, pressure_enabled, merged_draw_mm = prepare_scene(page, cal)

    def bed(point: Point) -> Point:
        x, y = point
        return (round(cal.origin_x + x, 3), round(
            cal.origin_y + cal.plot_height - y if cal.flip_y else cal.origin_y + y, 3
        ))

    # Freeze at output precision before routing, so the metric describes the
    # actual positions the printer receives, including tiny/dot strokes.
    plain = tuple(PlotStroke(tuple(map(bed, line))) for line in sort_for_travel_points(normal))
    fixed = tuple(
        PlotStroke(tuple(map(bed, line)), feeds=tuple(values), order_locked=True,
                   source_group="feed") for line, values in feeds
    ) + tuple(
        PlotStroke(tuple(map(bed, line.points)),
                   pressures=None if line.pressures is None else tuple(line.pressures),
                   order_locked=True, source_group="source-order") for line in ordered
    )
    baseline = plain + fixed
    planner = TravelPlanner(cal.obstacles or (), bed_bounds=(cal.bed_width, cal.bed_height))
    park = tuple(round(v, 3) for v in cal.resolved_park()[:2]) if cal.park_after_plot else None

    def travel_paths(strokes: tuple[PlotStroke, ...]) -> tuple[tuple[Path, ...], Path, float]:
        cursor = (0.0, 0.0)
        paths = []
        distance = 0.0
        for stroke in strokes:
            path = tuple((round(x, 3), round(y, 3))
                         for x, y in planner.route(cursor, stroke.points[0]))
            distance += _length((cursor, *path))
            paths.append(path)
            cursor = stroke.points[-1]
        finish = tuple((round(x, 3), round(y, 3))
                       for x, y in planner.route(cursor, park)) if park is not None else ()
        distance += _length((cursor, *finish))
        return tuple(paths), finish, distance

    baseline_paths, baseline_park, before = travel_paths(baseline)
    strokes = baseline
    paths, park_path, after = baseline_paths, baseline_park, before
    algorithm = "baseline"
    diagnostics = ["start_assumed_origin", "legacy_geometry_preparation"]
    if optimize and plain:
        result = optimize_routes(
            tuple(stroke.points for stroke in plain), start=(0.0, 0.0),
            end=fixed[0].points[0] if fixed else park,
            obstacles=cal.obstacles or (), bed_bounds=(cal.bed_width, cal.bed_height),
        )
        candidate = tuple(
            replace(plain[index], points=points)
            for index, points in zip(result.source_indices, result.lines, strict=True)
        )
        candidate += fixed
        candidate_paths, candidate_park, candidate_distance = travel_paths(candidate)
        diagnostics.extend(result.diagnostics)
        # Recheck after rounding obstacle waypoints to the emitted precision.
        # Every candidate retains identical strokes and all locked attributes.
        if candidate_distance < before - 1e-6:
            strokes, paths, park_path, after = (
                candidate, candidate_paths, candidate_park, candidate_distance
            )
            algorithm = result.algorithm
        elif result.distance_mm < result.baseline_distance_mm - 1e-6:
            diagnostics.append("rounded_route_not_better")
    draw_mm = sum(_length(stroke.points) for stroke in strokes)
    extra = max(0.0, sum(_length(line) for line in normal) - merged_draw_mm)
    if extra > 1e-6:
        diagnostics.append("continuous_retraces_existing_ink")
    # Serialize-compatible clearance check. Each coordinate can move by 0.0005
    # mm at output precision; allow at most 0.001 mm numeric clearance loss.
    # The encoder additionally checks actual obstacles and physical bed limits.
    cursor = (0.0, 0.0)
    for stroke, path in zip(strokes, paths, strict=True):
        for target in path:
            if any(seg_intersects_obs(cursor, target, obs, OBSTACLE_MARGIN - 0.001)
                   for obs in cal.obstacles):
                raise TravelRoutingError(
                    "Die gerundete Leerfahrt unterschreitet den Hindernisabstand."
                )
            cursor = target
        cursor = stroke.points[-1]
    for target in park_path:
        if any(seg_intersects_obs(cursor, target, obs, OBSTACLE_MARGIN - 0.001)
               for obs in cal.obstacles):
            raise TravelRoutingError("Die gerundete Parkfahrt unterschreitet den Hindernisabstand.")
        cursor = target
    report = PlanReport(
        baseline_travel_mm=before, travel_mm=after, draw_mm=draw_mm,
        pen_contacts=len(strokes), point_count=sum(len(stroke.points) for stroke in strokes),
        algorithm=algorithm, diagnostics=tuple(diagnostics),
        continuous_extra_draw_mm=extra, protected_strokes=len(fixed),
    )
    return PlotPlan(
        plan_id=_plan_id(source_json, calibration_json, optimize),
        name=page.get("name") or page.get("id") or "Paint-Seite",
        calibration_json=calibration_json, strokes=strokes, travels=paths,
        park_path=park_path, pressure_enabled=pressure_enabled, report=report,
    )


def _cached_build(source_json: str, calibration_json: str, optimize: bool) -> PlotPlan:
    global _cache_bytes
    key = _plan_id(source_json, calibration_json, optimize)
    with _cache_lock:
        if (hit := _cache.get(key)) is not None:
            _cache.move_to_end(key)
            return hit[0]
    # Computation outside the lock keeps unrelated requests independent. Racing
    # identical requests may compute twice; both produce the same frozen plan.
    plan = _build(source_json, calibration_json, optimize)
    size = (4096 + len(calibration_json.encode()) + plan.report.point_count * 192
            + sum(map(len, plan.travels)) * 128 + len(plan.park_path) * 128
            + len(plan.strokes) * 512)
    if size <= _CACHE_BYTE_BUDGET:
        with _cache_lock:
            if (hit := _cache.get(key)) is not None:
                _cache.move_to_end(key)
                return hit[0]
            while _cache and (_cache_bytes + size > _CACHE_BYTE_BUDGET
                              or len(_cache) >= _CACHE_MAX_PLANS):
                _, (_, removed_size) = _cache.popitem(last=False)
                _cache_bytes -= removed_size
            _cache[key] = plan, size
            _cache_bytes += size
    return plan


def clear_plot_plan_cache() -> None:
    global _cache_bytes
    with _cache_lock:
        _cache.clear()
        _cache_bytes = 0


def build_scene_plan(page: dict, cal: Calibration, *, optimize: bool = True) -> PlotPlan:
    """Plan one immutable scene snapshot; no application state is loaded or saved.

    optimize=False is the regression/control mode: legacy stroke ordering plus
    the same bounded travel planner. Geometry preparation and explicit page
    continuous settings are preserved in both modes. No pen-width deletion.
    """
    try:
        source_json, calibration_json = _json(page), _json(asdict(cal))
        return _cached_build(source_json, calibration_json, optimize)
    except TravelRoutingError as exc:
        raise PlotterError(f"Kein sicherer Leerweg innerhalb des Druckbetts: {exc}") from exc
    except (TypeError, ValueError) as exc:
        raise PlotterError(
            f"Der Plotplan enthält ungültige Geometrie, Druck-/Tempowerte oder Einstellungen: {exc}"
        ) from exc
