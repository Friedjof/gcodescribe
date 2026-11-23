"""Offline pen-width planning experiment; no app state, printer or job writes.

Run from the repository: .venv/bin/python experiments/pen-width/demo.py
Outputs HTML/SVG/JSON alongside this script. Synthetic round-tip ink model only.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import platform
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import shapely
from shapely.geometry import LineString, Point
from shapely.ops import linemerge, unary_union

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from plotter.gcode.metrics import analyze_gcode  # noqa: E402
from plotter.geometry.oneline import continuous_polylines  # noqa: E402
from plotter.geometry.singlepass import single_pass_polylines  # noqa: E402
from plotter.geometry.travel import sort_for_travel_points  # noqa: E402


@dataclass(frozen=True)
class Stroke:
    points: tuple[tuple[float, float], ...]
    protect: bool = False

    @property
    def geometry(self):
        return Point(self.points[0]) if len(set(self.points)) == 1 else LineString(self.points)


def stroke(points, protect=False):
    return Stroke(tuple(tuple(p) for p in points), protect)


def ink(strokes, width):
    # 32 segments per quadrant; approximate round caps, not an optical ink model.
    return unary_union([s.geometry.buffer(width / 2, quad_segs=32) for s in strokes])


def difference(before, after):
    missing = before.difference(after).area
    added = after.difference(before).area
    boundary = (
        before.boundary.hausdorff_distance(after.boundary) if not after.is_empty else math.inf
    )
    return {
        "missing_mm2": missing,
        "added_mm2": added,
        "missing_pct": 100 * missing / max(before.area, 1e-12),
        "added_pct": 100 * added / max(before.area, 1e-12),
        "boundary_mm": boundary,
    }


def exact_union(strokes):
    """Prototype for uniform, unordered strokes only; protected ones stay separate."""
    lines = [s.geometry for s in strokes if not s.protect and s.geometry.geom_type == "LineString"]
    retained = [s for s in strokes if s.protect or s.geometry.geom_type == "Point"]
    if not lines:
        return list(strokes)
    union = unary_union(lines)  # Nodes collinear overlap regardless of vertex segmentation.
    merged = union if union.geom_type == "LineString" else linemerge(union)
    pieces = [merged] if merged.geom_type == "LineString" else list(merged.geoms)
    return retained + [stroke(list(p.coords)) for p in pieces]


def simplify(strokes, tolerance):
    return [
        s
        if s.protect or s.geometry.geom_type == "Point"
        else stroke(list(s.geometry.simplify(tolerance, preserve_topology=True).coords))
        for s in strokes
    ]


def covered(strokes, width, loss_pct=0.25, boundary_mm=None):
    """Small-fixture reverse deletion. Full union per candidate is intentionally NOT scalable.

    Every acceptance is against ORIGINAL ink and CURRENT survivors: no mutual
    deletion, no accumulating per-candidate percentage allowances.
    """
    boundary_mm = width * 0.05 if boundary_mm is None else boundary_mm
    original = ink(strokes, width)
    kept = list(strokes)
    order = sorted(range(len(strokes)), key=lambda i: (strokes[i].geometry.length, i))
    for index in order:
        if strokes[index].protect:
            continue
        trial = [s for i, s in enumerate(kept) if i != index and s is not None]
        if not trial:
            continue
        d = difference(original, ink(trial, width))
        if d["missing_pct"] <= loss_pct + 1e-9 and d["boundary_mm"] <= boundary_mm + 1e-9:
            kept[index] = None
    return [s for s in kept if s is not None]


def route_stats(strokes, lift=2.0, draw=30.0, travel=100.0):
    lines = [list(s.points) if len(s.points) > 1 else [s.points[0], s.points[0]] for s in strokes]
    ordered = sort_for_travel_points(lines)
    gcode = ["G21", "G90", f"G0 Z{lift} F1200"]
    cursor = (0.0, 0.0)
    distance = travel_distance = 0.0
    for line in ordered:
        travel_distance += math.dist(cursor, line[0])
        distance += sum(math.dist(a, b) for a, b in zip(line, line[1:], strict=False))
        gcode += [f"G0 X{line[0][0]:.3f} Y{line[0][1]:.3f} F{travel * 60}", "G1 Z0 F1200"]
        gcode += [f"G1 X{x:.3f} Y{y:.3f} F{draw * 60}" for x, y in line[1:]]
        gcode.append(f"G0 Z{lift} F1200")
        cursor = line[-1]
    metrics = analyze_gcode("\n".join(gcode))
    # Second model deliberately does not assume an independent stop at each vertex.
    proxy = distance / draw + travel_distance / travel + len(lines) * (2 * lift / 20 + 0.3)
    return {
        "strokes": len(strokes),
        "points": sum(len(s.points) for s in strokes),
        "draw_mm": distance,
        "travel_mm": travel_distance,
        "lifts": len(lines),
        "app_estimate_s": metrics.duration_s,
        "continuous_feed_proxy_s": proxy,
    }


def fixtures():
    return [
        (
            "duplicates",
            "Overlaps with different subdivisions",
            0.4,
            [
                stroke([(5, 10), (35, 10)]),
                stroke([(35, 10), (20, 10), (5, 10)]),
                stroke([(12, 10), (28, 10)]),
            ],
            "exact",
        ),
        (
            "curve",
            "Oversampled curve",
            0.4,
            [stroke([(5 + i * 0.05, 12 + 3 * math.sin(i * 0.05 / 5)) for i in range(601)])],
            "simplify",
        ),
        (
            "hatch",
            "Dense hatching",
            0.5,
            [stroke([(5, 5 + i * 0.1), (35, 5 + i * 0.1)]) for i in range(61)],
            "coverage",
        ),
        (
            "parallel",
            "Nearby parallel strokes are not duplicates",
            0.4,
            [stroke([(5, 10), (35, 10)]), stroke([(5, 10.12), (35, 10.12)])],
            "coverage",
        ),
        (
            "dots",
            "Dots on a line and isolated punctuation",
            0.4,
            [stroke([(5, 10), (35, 10)])]
            + [stroke([(x, 10)]) for x in (10, 15, 20, 25)]
            + [stroke([(36, 12)], True)],
            "coverage",
        ),
        (
            "protected",
            "Lettering dot and small loop retained",
            0.4,
            [
                stroke([(5, 10), (35, 10)]),
                stroke([(16, 11.5)], True),
                stroke(
                    [
                        (
                            22 + 0.5 * math.cos(i * math.pi / 20),
                            12 + 0.5 * math.sin(i * math.pi / 20),
                        )
                        for i in range(41)
                    ],
                    True,
                ),
            ],
            "coverage",
        ),
    ]


def svg_panel(strokes, width, bounds, color="#172638"):
    x0, y0, x1, y1 = bounds
    body = []
    for s in strokes:
        if s.geometry.geom_type == "Point":
            body.append(
                f'<circle cx="{s.points[0][0]}" cy="{s.points[0][1]}" r="{width / 2}" fill="{color}"/>'  # noqa: E501 -- inline report markup
            )
        else:
            path = " ".join(
                ("M" if i == 0 else "L") + f"{x:.5f},{y:.5f}" for i, (x, y) in enumerate(s.points)
            )
            body.append(
                f'<path d="{path}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"/>'  # noqa: E501 -- inline report markup
            )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0 - 1} {y0 - 1} {max(1, x1 - x0) + 2} {max(1, y1 - y0) + 2}" role="img" aria-label="Stroke-width model">'  # noqa: E501 -- inline report markup
        + "".join(body)
        + "</svg>"
    )


def area_svg(area, color):
    # Shapely's display helper defaults to a 2-unit border; that would fabricate
    # apparent ink around these sub-mm regions. Render filled polygons only.
    return (
        area.svg(fill_color=color)
        .replace('stroke="#555555"', 'stroke="none"')
        .replace('opacity="0.6"', 'opacity="1"')
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / "results")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    rows, cards, proofs, simplification_sweep = [], [], [], []
    for key, title, width, original, method in fixtures():
        digest = hashlib.sha256(repr(original).encode()).hexdigest()
        begin = time.perf_counter()
        if method == "simplify":
            candidate = original
            for factor in (0.1, 0.025, 0.0125, 0.005, 0.0025):
                trial = simplify(original, width * factor)
                delta = difference(ink(original, width), ink(trial, width))
                accepted = (
                    max(delta["missing_pct"], delta["added_pct"]) <= 0.25
                    and delta["boundary_mm"] <= width * 0.05
                )
                simplification_sweep.append(
                    dict(
                        tolerance_mm=width * factor,
                        points=sum(len(s.points) for s in trial),
                        accepted=accepted,
                        **delta,
                    )
                )
                if accepted:
                    candidate = trial
                    break
        else:
            candidate = exact_union(original) if method == "exact" else covered(original, width)
        elapsed = (time.perf_counter() - begin) * 1000
        before, after = ink(original, width), ink(candidate, width)
        diff = difference(before, after)
        row = dict(
            case=key,
            width_mm=width,
            method=method,
            before=route_stats(original),
            after=route_stats(candidate),
            **diff,
            prototype_ms=elapsed,
        )
        rows.append(row)
        assert hashlib.sha256(repr(original).encode()).hexdigest() == digest
        assert all(s in candidate for s in original if s.protect)
        if key in ("parallel", "protected"):
            assert candidate == original
        if key == "dots":
            assert len(candidate) == 2
        if key == "duplicates":
            assert diff["missing_mm2"] < 1e-7 and diff["added_mm2"] < 1e-7
        if key == "curve":
            assert len(candidate[0].points) < 100 and diff["boundary_mm"] < 0.041
        if key == "hatch":
            assert (
                len(candidate) < len(original)
                and diff["missing_pct"] <= 0.25
                and diff["boundary_mm"] <= width * 0.05 + 1e-9
            )
        bounds = before.bounds
        first, second = svg_panel(original, width, bounds), svg_panel(candidate, width, bounds)
        (args.output / f"{key}-before.svg").write_text(first)
        (args.output / f"{key}-after.svg").write_text(second)
        loss, gain = before.difference(after), after.difference(before)
        delta = svg_panel([], width, bounds).replace(
            "</svg>",
            area_svg(before, "#dbe2e7")
            + area_svg(loss, "#da3152")
            + area_svg(gain, "#168b76")
            + "</svg>",
        )
        cards.append(
            f'<article><h2>{html.escape(title)}</h2><p>Pen {width:g} mm · {row["before"]["strokes"]} → {row["after"]["strokes"]} paths · {row["before"]["points"]} → {row["after"]["points"]} points</p><div class="panels"><figure><figcaption>Original</figcaption>{first}</figure><figure><figcaption>Candidate</figcaption>{second}</figure><figure><figcaption>Missing in red · added in green</figcaption>{delta}</figure></div><p>Missing ink: {diff["missing_pct"]:.4f}% · added: {diff["added_pct"]:.4f}% · boundary deviation: {diff["boundary_mm"]:.4f} mm<br>App time estimate: {row["before"]["app_estimate_s"]:.1f} → {row["after"]["app_estimate_s"]:.1f} s · Continuous-motion model: {row["before"]["continuous_feed_proxy_s"]:.1f} → {row["after"]["continuous_feed_proxy_s"]:.1f} s</p></article>'  # noqa: E501 -- inline report markup
        )
        proofs.append(key)
    # Counterexample: testing centerlines against ink is insufficient.
    parallel = fixtures()[3][3]
    a, b = parallel
    center_contained = a.geometry.buffer(0.2).covers(b.geometry)
    naive_loss = difference(ink(parallel, 0.4), ink([a], 0.4))
    assert center_contained and naive_loss["missing_pct"] > 20
    # A global percent budget alone can lose an entire tiny semantic feature.
    full = [stroke([(0, y), (100, y)]) for y in range(50)] + [stroke([(110, 25)], True)]
    punctuation_loss = difference(ink(full, 0.4), ink(full[:-1], 0.4))
    assert punctuation_loss["missing_pct"] < 0.01 and punctuation_loss["boundary_mm"] > 9
    # Tiny geometry may still produce a distinct dot. Never delete just on length.
    tiny = [stroke([(0, 0), (0.02, 0)])]
    tiny_area = ink(tiny, 0.4).area
    assert tiny_area > 0.12
    # Compare the two EXISTING routing algorithms at multiple geometric scales.
    routes = []
    for scale in (0.5, 10):
        network = [
            [(5 + x * scale, 5 + y * scale), (5 + (x + 1) * scale, 5 + y * scale)]
            for x in range(5)
            for y in range(6)
        ]
        network += [
            [(5 + x * scale, 5 + y * scale), (5 + x * scale, 5 + (y + 1) * scale)]
            for x in range(6)
            for y in range(5)
        ]
        for lift in (0.5, 5):
            for name, algorithm in [
                ("continuous", continuous_polylines),
                ("single_pass", single_pass_polylines),
            ]:
                paths = algorithm(network, tol=0.001)
                assert (
                    ink([stroke(p) for p in paths], 0.4)
                    .symmetric_difference(ink([stroke(p) for p in network], 0.4))
                    .area
                    < 1e-6
                )
                routes.append(
                    dict(
                        scale=scale,
                        lift_mm=lift,
                        mode=name,
                        **route_stats([stroke(p) for p in paths], lift),
                    )
                )
    # Same offsets cross the deletion threshold differently after scaling and for different nibs.
    sweep = []
    for width in (0.2, 0.4, 0.8):
        for gap in (0.0, 0.01, 0.05, 0.12, 0.3):
            lines = [stroke([(0, 0), (20, 0)]), stroke([(0, gap), (20, gap)])]
            d = difference(ink(lines, width), ink(lines[:1], width))
            sweep.append(dict(width_mm=width, gap_mm=gap, **d))
    results = {
        "model": "Round constant-width nib; no opacity, dynamics or measured hardware timing",
        "python": platform.python_version(),
        "shapely": shapely.__version__,
        "cases": rows,
        "routing": routes,
        "width_gap_sweep": sweep,
        "simplification_sweep": simplification_sweep,
        "counterexamples": {
            "centerline_contained": center_contained,
            "naive_parallel_deletion": naive_loss,
            "global_budget_lost_punctuation": punctuation_loss,
            "tiny_002mm_line_ink_area_mm2": tiny_area,
        },
        "checks": proofs,
    }
    (args.output / "metrics.json").write_text(json.dumps(results, indent=2, allow_nan=False) + "\n")
    route_table = (
        "<table><tr><th>Grid spacing</th><th>Lift</th><th>Mode</th><th>Drawing distance</th><th>Lifts</th><th>App estimate</th><th>Without segment stops</th></tr>"  # noqa: E501 -- inline report markup
        + "".join(
            f"<tr><td>{r['scale']} mm</td><td>{r['lift_mm']} mm</td><td>{r['mode']}</td><td>{r['draw_mm']:.1f} mm</td><td>{r['lifts']}</td><td>{r['app_estimate_s']:.1f} s</td><td>{r['continuous_feed_proxy_s']:.1f} s</td></tr>"  # noqa: E501 -- inline report markup
            for r in routes
        )
        + "</table>"
    )
    document = (
        """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pen width and plot optimisation</title><style>body{font:15px/1.5 system-ui;background:#eef1f4;color:#172638;margin:0}main{max-width:1260px;margin:auto;padding:28px}h1{font-size:28px}h2{font-size:20px}article{background:white;border:1px solid #d2dae2;border-radius:10px;padding:22px;margin:22px 0}p{max-width:1000px}.panels{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}figure{margin:0;border:1px solid #e1e6ea;padding:10px}figcaption{font-size:12px;color:#52606c;margin-bottom:12px}svg{width:100%;height:190px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:10px;border-bottom:1px solid #d2dae2;text-align:left}.note{border-left:3px solid #137f78;padding:8px 16px}a{color:#175bb4}</style><main><h1>Pen width and plot optimisation</h1><p>Reproducible planning demo. All lengths are in millimetres, using synthetic artwork and a round, constant-width pen. Images are enlarged comparisons, not a physical measurement scale.</p><p class="note">This demo does not change the app. It measures geometric ink coverage and calculated times. Paper, ink deposition and actual machine motion are not simulated.</p>"""  # noqa: E501 -- inline report markup
        + "".join(cards)
        + f'<article><h2>Why spacing alone is insufficient</h2><p>With a 0.4 mm pen and 0.12 mm line spacing, the second centreline lies inside the coverage of the first stroke. Removing it still loses {naive_loss["missing_pct"]:.2f}% of the combined ink area. A percentage budget alone could also remove an entire punctuation mark; here that represents just {punctuation_loss["missing_pct"]:.5f}%.</p></article><article><h2>Fewer lifts or less retracing</h2><p>The same network, using two existing routing algorithms. Times are estimates at 30 mm/s drawing, 100 mm/s travel and 20 mm/s Z speed. The second model assumes continuous motion. These are not measured plotting times.</p>{route_table}</article><p><a href="metrics.json">Measurements as JSON</a> · Run: <code>.venv/bin/python experiments/pen-width/demo.py</code></p></main></html>'  # noqa: E501 -- inline report markup
    )
    (args.output / "index.html").write_text(document)
    print(
        json.dumps(
            {
                "cases": len(rows),
                "routing_cases": len(routes),
                "checks": "passed",
                "report": str(args.output / "index.html"),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
