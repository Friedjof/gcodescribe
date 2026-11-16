"""Offline route experiments; deterministic synthetic fixtures, no application state."""

from __future__ import annotations

import argparse
import json
import math
import random
import statistics
import sys
import time
from pathlib import Path

import numpy as np
from shapely.geometry import LineString
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from plotter.core.calibration import Calibration  # noqa: E402
from plotter.gcode.safety import GcodeSafetyChecker, SafetyViolation  # noqa: E402
from plotter.geometry.linemerge import merge_polylines  # noqa: E402
from plotter.geometry.oneline import continuous_polylines  # noqa: E402
from plotter.geometry.routing import OBSTACLE_MARGIN, route_travel  # noqa: E402
from plotter.geometry.travel import (  # noqa: E402
    _greedy_large,
    _tuple_end,
    sort_for_travel_complex,
    sort_for_travel_points,
)
from plotter.maze.generate import generate_maze  # noqa: E402


def length(lines, start=(0.0, 0.0), obstacles=()):
    result = 0.0
    pos = start
    for line in lines:
        for point in route_travel(pos, line[0], list(obstacles)):
            result += math.dist(pos, point)
            pos = point
        pos = line[-1]
    return result


def signature(lines):
    return sorted(
        tuple(sorted((tuple(a), tuple(b))))
        for line in lines
        for a, b in zip(line, line[1:], strict=False)
    )


def fixture(n, seed):
    rng = random.Random(seed)
    return [
        [(x, y), (x + rng.uniform(-2, 2), y + rng.uniform(-2, 2))]
        for x, y in ((rng.uniform(5, 195), rng.uniform(5, 275)) for _ in range(n))
    ]


def time_call(fn, data, count=1):
    elapsed = []
    for _ in range(count):
        t0 = time.perf_counter()
        result = fn(data)
        elapsed.append((time.perf_counter() - t0) * 1000)
    assert signature(result) == signature(data)
    return result, statistics.median(elapsed)


def tuples_from_complex(lines):
    return [[(float(p.real), float(p.imag)) for p in line] for line in lines]


def two_opt(lines):
    return tuples_from_complex(
        sort_for_travel_complex([np.asarray([complex(*p) for p in line]) for line in lines])
    )


def at_start(lines, start):
    shifted = [[(p[0] - start[0], p[1] - start[1]) for p in line] for line in lines]
    result = sort_for_travel_points(shifted)
    return [[(p[0] + start[0], p[1] + start[1]) for p in line] for line in result]


def closed_greedy(lines):
    remaining = list(lines)
    result = []
    pos = (0.0, 0.0)
    while remaining:
        _, i, j = min(
            (math.dist(pos, p), i, j)
            for i, line in enumerate(remaining)
            for j, p in enumerate(line[:-1])
        )
        line = remaining.pop(i)
        ring = line[:-1]
        chosen = ring[j:] + ring[:j] + [ring[j]]
        result.append(chosen)
        pos = chosen[-1]
    return result


def obstacle_greedy(lines, obstacles):
    remaining = list(lines)
    result = []
    pos = (0.0, 0.0)
    while remaining:
        candidates = []
        for i, line in enumerate(remaining):
            for rev, target in [(False, line[0]), (True, line[-1])]:
                path = [pos, *route_travel(pos, target, obstacles)]
                distance = sum(math.dist(a, b) for a, b in zip(path, path[1:], strict=False))
                candidates.append((distance, i, rev))
        _, i, rev = min(candidates)
        line = remaining.pop(i)
        line = line[::-1] if rev else line
        result.append(line)
        pos = line[-1]
    return result


def svg_routes(filename, old, new, *, output, width, height, obstacles=()):
    """Side-by-side black geometry and red pen-up travel (all units mm)."""
    padding, header = 10, 22
    panel_width = width + 2 * padding
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="1200" '
        f'viewBox="0 0 {panel_width * 2} {height + header + padding}">',
        '<rect width="100%" height="100%" fill="white"/>',
    ]
    for k, (name, paths) in enumerate([("Current order", old), ("Candidate order", new)]):
        parts.append(f'<g transform="translate({k * panel_width + padding},{header})">')
        parts.append(
            '<text x="0" y="-10" font-family="sans-serif" font-size="6">'
            f"{name}: {length(paths, obstacles=obstacles):.1f} mm travel</text>"
        )
        for obs in obstacles:
            parts.append(
                f'<rect x="{obs["x"]}" y="{obs["y"]}" width="{obs["w"]}" height="{obs["h"]}" '
                'fill="#ddd" stroke="#777" stroke-width=".4"/>'
            )
        cursor = (0.0, 0.0)
        for line in paths:
            route = [cursor, *route_travel(cursor, line[0], list(obstacles))]
            travel = " ".join(f"{x:.5f},{y:.5f}" for x, y in route)
            draw = " ".join(f"{x:.5f},{y:.5f}" for x, y in line)
            parts.append(
                f'<polyline points="{travel}" fill="none" stroke="#dc4b44" '
                'stroke-width=".35" stroke-dasharray="1.2 1"/>'
            )
            parts.append(
                f'<polyline points="{draw}" fill="none" stroke="#15252b" stroke-width=".6"/>'
            )
            cursor = line[-1]
        parts.append("</g>")
    parts.append("</svg>")
    (output / filename).write_text("\n".join(parts))


def correctness_repros():
    obstacles = [{"x": 90.0, "y": 0.0, "w": 20.0, "h": 140.0}]
    start, end = (50.0, 50.0), (150.0, 50.0)
    actual = route_travel(start, end, obstacles)
    alternative = [(86.95, 143.05), (113.05, 143.05), end]
    cal = Calibration(obstacles=obstacles)

    def gcode(path):
        return "G21\nG90\nG0 Z5\nG0 X50 Y50\n" + "\n".join(f"G0 X{x} Y{y}" for x, y in path)

    try:
        GcodeSafetyChecker(cal).check(gcode(actual))
    except SafetyViolation as exc:
        rejection = str(exc)
    else:
        raise AssertionError("Expected bed limit rejection")
    GcodeSafetyChecker(cal).check(gcode(alternative))

    outline = [(0.0, 0.0), (20.0, 0.0), (20.0, 20.0), (0.0, 20.0), (0.0, 0.0)]
    lines = [outline, *[[(0.0, float(y)), (20.0, float(y))] for y in range(2, 20, 2)]]
    geometry = unary_union([LineString(line) for line in lines])
    noded = [list(line.coords) for line in geometry.geoms]
    current = continuous_polylines(lines, tol=0.001)
    candidate = continuous_polylines(noded, tol=0.001)
    assert geometry.equals(unary_union([LineString(line) for line in candidate]))
    results = {
        "bed_boundary": {
            "bed_mm": [cal.bed_width, cal.bed_height],
            "obstacles": obstacles,
            "margin_mm": OBSTACLE_MARGIN,
            "corner_extra_mm": 0.05,
            "start": start,
            "end": end,
            "current_path": actual,
            "current_safety_rejection": rejection,
            "alternative_path": alternative,
            "alternative_safety_passes": True,
        },
        "hatch_noding": {
            "source": "20 mm square plus 9 horizontal hatch lines at 2 mm increments, "
            "matching endpoint-on-outline topology of designer hatches",
            "current_strokes": len(current),
            "candidate_strokes": len(candidate),
            "current_draw_mm": sum(
                math.dist(a, b) for line in current for a, b in zip(line, line[1:], strict=False)
            ),
            "candidate_draw_mm": sum(
                math.dist(a, b) for line in candidate for a, b in zip(line, line[1:], strict=False)
            ),
            "geometry_set_equal": True,
            "caveat": "Noding permits traversal but continuous mode retraces some outline edges; "
            "ink deposition and time are not equivalent.",
        },
    }
    return results


def main(output: Path):
    output.mkdir(parents=True, exist_ok=True)
    results = {
        "note": "Synthetic and built-in-generator exact-path comparisons. "
        "Millimeters and local CPU timings; no measured hardware time."
    }
    quality = []
    for seed in range(8):
        lines = fixture(250, seed)
        greedy, greedy_ms = time_call(sort_for_travel_points, lines)
        refined, refined_ms = time_call(two_opt, lines)
        quality.append(
            {
                "seed": seed,
                "strokes": len(lines),
                "greedy_mm": length(greedy),
                "refined_mm": length(refined),
                "greedy_ms": greedy_ms,
                "refined_ms": refined_ms,
            }
        )
    results["scene_vs_existing_svg_2opt"] = quality
    print("ordering fixtures done", flush=True)

    _greedy_large(fixture(10, 0), _tuple_end, lambda ln: ln[::-1])
    scaling = []
    for n in (500, 1000, 4000, 4001):
        lines = fixture(n, 42)
        normal, normal_ms = time_call(sort_for_travel_points, lines, count=3 if n <= 1000 else 1)
        kd, kd_ms = time_call(
            lambda data: _greedy_large(data, _tuple_end, lambda ln: ln[::-1]),
            lines,
            count=3 if n <= 1000 else 1,
        )
        scaling.append(
            {
                "n": n,
                "current_ms": normal_ms,
                "kd_ms": kd_ms,
                "current_mm": length(normal),
                "kd_mm": length(kd),
            }
        )
    results["kd_threshold"] = scaling
    print("scaling done", flush=True)

    loops = []
    for seed in range(4):
        rng = random.Random(seed)
        lines = []
        for _ in range(120):
            x, y, radius = rng.uniform(10, 190), rng.uniform(10, 270), rng.uniform(1, 5)
            ring = [
                (x + radius * math.cos(i * math.tau / 32), y + radius * math.sin(i * math.tau / 32))
                for i in range(32)
            ]
            lines.append(ring + [ring[0]])
        old, old_ms = time_call(sort_for_travel_points, lines)
        new, new_ms = time_call(closed_greedy, lines)
        loops.append(
            {
                "seed": seed,
                "current_mm": length(old),
                "seam_choice_mm": length(new),
                "current_ms": old_ms,
                "seam_choice_ms": new_ms,
            }
        )
    results["closed_loop_seams"] = loops

    lines = [[(5.0, y), (15.0, y)] for y in range(5, 276, 10)]
    old = sort_for_travel_points(lines)
    new = at_start(lines, (0.0, 280.0))
    results["flipped_page_start"] = {
        "strokes": len(lines),
        "source_origin_sort_mm": length(old, (0.0, 280.0)),
        "machine_origin_sort_mm": length(new, (0.0, 280.0)),
    }

    obstacles = [{"x": 84.0, "y": 10.0, "w": 2.0, "h": 180.0}]
    lines = [[(x, float(y)), (x + 1.0, float(y))] for y in range(25, 186, 20) for x in (79.0, 90.0)]
    old, old_ms = time_call(sort_for_travel_points, lines)
    new, new_ms = time_call(lambda data: obstacle_greedy(data, obstacles), lines)
    results["obstacle_cost"] = {
        "strokes": len(lines),
        "euclidean_sort_actual_mm": length(old, obstacles=obstacles),
        "obstacle_sort_actual_mm": length(new, obstacles=obstacles),
        "current_ms": old_ms,
        "obstacle_sort_ms": new_ms,
    }
    results["bed_boundary_repro"] = {
        "start": [50.0, 50.0],
        "end": [150.0, 50.0],
        "obstacle": {"x": 90.0, "y": 0.0, "w": 20.0, "h": 140.0},
        "returned_path": route_travel(
            (50.0, 50.0), (150.0, 50.0), [{"x": 90.0, "y": 0.0, "w": 20.0, "h": 140.0}]
        ),
        "note": "Planner has no bed bounds: returned y=-3.05 is outside a bed with min_y=0. "
        "The later safety checker rejects it despite a clear alternative around the upper side.",
    }

    boundary = [[(-1.0, 0.0), (0.24, 0.0)], [(0.26, 0.0), (1.0, 0.0)]]
    diagonal = [[(-1.0, -0.24), (-0.24, -0.24)], [(0.24, 0.24), (1.0, 0.24)]]
    results["merge_tolerance_repros"] = {
        "tolerance_mm": 0.5,
        "close_gap_mm": math.dist(boundary[0][-1], boundary[1][0]),
        "close_gap_strokes_after": len(merge_polylines(boundary, tol=0.5)),
        "distant_gap_mm": math.dist(diagonal[0][-1], diagonal[1][0]),
        "distant_gap_strokes_after": len(merge_polylines(diagonal, tol=0.5)),
        "distant_gap_input": diagonal,
        "distant_gap_output": merge_polylines(diagonal, tol=0.5),
    }

    svg_routes(
        "routing-obstacle.svg", old, new, output=output, width=120, height=200, obstacles=obstacles
    )

    mazes = []
    for size in (12, 24):
        fixture_seed = "routing-evaluation-2026"
        maze = generate_maze("classic", fixture_seed, size, 190, 270)
        raw = [[tuple(p) for p in line] for line in maze.wall_lines + maze.marker_lines]
        merged = merge_polylines(raw, tol=0.001)
        for continuous in (False, True):
            paths = continuous_polylines(merged, tol=0.001) if continuous else merged
            old, old_ms = time_call(sort_for_travel_points, paths)
            new, new_ms = time_call(two_opt, paths)
            mazes.append(
                {
                    "generator": "plotter.maze.generate.generate_maze",
                    "type": "classic",
                    "seed": fixture_seed,
                    "size": size,
                    "width": 190,
                    "height": 270,
                    "continuous": continuous,
                    "raw_strokes": len(raw),
                    "final_strokes": len(paths),
                    "current_mm": length(old),
                    "candidate_mm": length(new),
                    "current_ms": old_ms,
                    "candidate_ms": new_ms,
                }
            )
            if size == 24 and not continuous:
                svg_routes("routing-maze.svg", old, new, output=output, width=190, height=270)
    results["builtin_mazes"] = mazes

    results["correctness"] = correctness_repros()
    (output / "routing.json").write_text(json.dumps(results, indent=2))
    print(f"Wrote routing benchmark and SVG comparisons to {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / "results")
    main(parser.parse_args().output)
