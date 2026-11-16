"""Offline prototype: optimal directions for a fixed, already sorted stroke order.

This does not find the optimal order, change geometry, or handle constraints such
as directional pens. It demonstrates a cheap candidate for reversible strokes.
Run from the repository root with PYTHONPATH=. .venv/bin/python <this file>.
"""

from __future__ import annotations

import itertools
import json
import math
import random
import statistics
import time
from collections import Counter
from pathlib import Path

from plotter.coloring_pages import ColoringPageGenerator
from plotter.geometry.linemerge import merge_polylines
from plotter.geometry.travel import sort_for_travel_points
from plotter.maze.generate import generate_maze

Point = tuple[float, float]
Polyline = list[Point]


def travel(lines: list[Polyline], start: Point, park: Point) -> float:
    cursor = start
    distance = 0.0
    for line in lines:
        distance += math.dist(cursor, line[0])
        cursor = line[-1]
    return distance + math.dist(cursor, park)


def orient(lines: list[Polyline], start: Point, park: Point) -> list[Polyline]:
    """Two-state dynamic program, exact for this order and Euclidean air travel."""
    if not lines:
        return []
    costs = [math.dist(start, lines[0][0]), math.dist(start, lines[0][-1])]
    parents = []
    for previous, line in zip(lines, lines[1:], strict=False):
        next_costs, back = [], []
        for entry in (line[0], line[-1]):
            candidates = [
                costs[0] + math.dist(previous[-1], entry),
                costs[1] + math.dist(previous[0], entry),
            ]
            state = min(range(2), key=candidates.__getitem__)
            next_costs.append(candidates[state])
            back.append(state)
        costs = next_costs
        parents.append(back)
    final_costs = [
        costs[0] + math.dist(lines[-1][-1], park),
        costs[1] + math.dist(lines[-1][0], park),
    ]
    state = min(range(2), key=final_costs.__getitem__)
    states = [state]
    for back in reversed(parents):
        state = back[state]
        states.append(state)
    return [
        list(reversed(line)) if state else list(line)
        for line, state in zip(lines, reversed(states), strict=True)
    ]


def segments(lines: list[Polyline]) -> Counter:
    return Counter(
        tuple(sorted((tuple(a), tuple(b))))
        for line in lines for a, b in zip(line, line[1:], strict=False)
    )


def checks() -> None:
    rng = random.Random(771)
    for n in range(9):
        lines = [[(rng.random() * 10, rng.random() * 10) for _ in range(3)]
                 for _ in range(n)]
        before = json.dumps(lines)
        start, park = (1.0, 2.0), (3.0, 4.0)
        actual = orient(lines, start, park)
        exhaustive = min(
            travel([line[::-1] if bit else line
                    for line, bit in zip(lines, bits, strict=True)], start, park)
            for bits in itertools.product((0, 1), repeat=n)
        )
        assert math.isclose(travel(actual, start, park), exhaustive, abs_tol=1e-9)
        assert segments(actual) == segments(lines)
        assert len(actual) == len(lines)
        assert before == json.dumps(lines)


def main() -> None:
    checks()
    cases = {
        f"maze-{kind}": generate_maze(kind, "efficiency-2026", 12, 164, 200).wall_lines
        for kind in ("classic", "hex", "polar")
    }
    generator = ColoringPageGenerator()
    for kind in ("truchet", "wave_field", "hex_mosaic"):
        cases[f"pattern-{kind}"] = generator.generate_math_pattern_page(
            "efficiency-2026", kind, 164, 200
        ).polylines
    results = []
    # Deliberately hold ordering fixed to isolate the orientation improvement.
    # Mimic a y-flipped 164x200 mm plot area at bed origin (20,20), start (0,0).
    start, park = (0.0, 0.0), (0.0, 220.0)
    for name, raw in cases.items():
        ordered = sort_for_travel_points(merge_polylines(
            [[tuple(p) for p in line] for line in raw]
        ))
        bed = [[(x + 20, 220 - y) for x, y in line] for line in ordered]
        timings = []
        for _ in range(5):
            t0 = time.perf_counter()
            candidate = orient(bed, start, park)
            timings.append((time.perf_counter() - t0) * 1000)
        assert segments(candidate) == segments(bed)
        assert len(candidate) == len(bed)
        before, after = travel(bed, start, park), travel(candidate, start, park)
        assert after <= before + 1e-8
        results.append({
            "name": name, "strokes": len(bed),
            "travel_before_mm": round(before, 6), "travel_after_mm": round(after, 6),
            "reduction_percent": round(100 * (before - after) / before, 3),
            "median_ms_5_runs": round(statistics.median(timings), 3),
            "exact_segment_multiset_preserved": True,
        })
    result = {
        "scope": "Offline reversible-stroke candidate; fixed order, no obstacles or hardware",
        "fixtures": "Existing app generators; seed efficiency-2026; maze size 12; 164x200 mm",
        "start_mm": start, "park_mm": park,
        "checks": "9 sizes exhaustively checked against every orientation; no input mutation",
        "cases": results,
    }
    output = Path(__file__).parent / "results" / "orientation.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
