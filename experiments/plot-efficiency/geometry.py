"""Measure geometry loss in existing import helpers with synthetic fixtures.

Run: .venv/bin/python experiments/plot-efficiency/geometry.py
All dimensions are source millimetres, before editor placement/scaling. These
are diagnostic counterexamples, not quality-approved optimization candidates.
Raster fixtures live in a temporary directory; no app data or hardware is used.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np
from shapely.geometry import LineString

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import plotter.artwork.trace as trace  # noqa: E402
from plotter.artwork.drawing import Drawing  # noqa: E402
from plotter.services.asset_pages import render_drawing  # noqa: E402
from plotter.services.gallery.previews import preview_from_drawing  # noqa: E402


def parallel_lines(gap_px: int, directory: Path) -> dict:
    """Run the actual clean-ink centerline pipeline on ten separate lines.

    The comparison run bypasses only consolidation, so it measures geometry
    removed at that stage, not a claim that skeletonization perfectly matches
    the raster. uniform_ink=True is used by the SVG handwriting import path.
    """
    dpi = 200
    raster = np.full((300, 500), 255, np.uint8)
    for i in range(10):
        cv2.line(raster, (30, 20 + i * gap_px), (450, 20 + i * gap_px), 0, 3)
    image = directory / f"parallel-{gap_px}.png"
    if not cv2.imwrite(str(image), raster):
        raise RuntimeError("Could not write the temporary raster fixture")
    consolidate = trace._consolidate_strokes
    trace._consolidate_strokes = lambda a, b: list(zip(a, b, strict=True))
    try:
        baseline, *_ = trace._centerline_paths(image, dpi, 3, uniform_ink=True)
    finally:
        trace._consolidate_strokes = consolidate
    paths, *_ = trace._centerline_paths(image, dpi, 3, uniform_ink=True)
    return {
        "gap_mm": gap_px * 25.4 / dpi,
        "before_consolidation_lines": len(baseline),
        "actual_output_lines": len(paths),
        "before_draw_mm": sum(trace._stroke_arclen(line) for line in baseline),
        "actual_draw_mm": sum(trace._stroke_arclen(line) for line in paths),
        "baseline_y_span_mm": float(np.ptp(np.concatenate(baseline)[:, 1])),
        "output_y_span_mm": float(np.ptp(np.concatenate(paths)[:, 1])),
    }


def preview_loss() -> dict:
    # 201 lines with 201 vertices each. Every odd vertex forms a 0.5 mm peak;
    # endpoints and every even vertex lie on the baseline. Global stride=2
    # aliases every peak away. The motif is deliberately adversarial.
    lines = [
        np.array([complex(i * 0.5, row * 2.0 + (i % 2) * 0.5) for i in range(201)])
        for row in range(201)
    ]
    drawing = Drawing(lines, 100, 402)
    original = [LineString(np.column_stack((line.real, line.imag))) for line in lines]
    results = {}
    for name, function in (("asset", render_drawing), ("gallery", preview_from_drawing)):
        data = function(drawing, max_points=20000)
        preview = [LineString(line) for line in data["polylines"]]
        results[name] = {
            "input_points": sum(map(len, lines)),
            "output_points": sum(map(len, data["polylines"])),
            "max_deviation_mm": max(
                a.hausdorff_distance(b) for a, b in zip(original, preview, strict=True)
            ),
            "input_draw_mm": sum(line.length for line in original),
            "output_draw_mm": sum(line.length for line in preview),
            "input_peaks": 201 * 100,
            "output_vertical_span_per_line_mm": max(
                max(point[1] for point in line) - min(point[1] for point in line)
                for line in data["polylines"]
            ),
        }
    return results


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="gcodescribe-geometry-evaluation-") as tmp:
        parallel = {str(gap): parallel_lines(gap, Path(tmp)) for gap in (10, 25)}
    strokes = [np.array([[0.0, float(y)], [50.0, float(y)]]) for y in range(11)]
    consolidated = trace._consolidate_strokes(strokes, [False] * len(strokes))
    report = {
        "scope": "Synthetic source-mm fixtures; no final-size or physical-print claims",
        "centerline_parallel_lines": parallel,
        "preview_geometry_used_as_plot_input": preview_loss(),
        "transitive_consolidation": {
            "input_lines": len(strokes),
            "output_lines": len(consolidated),
            "band_width_mm": 10,
            "pair_distance_limit_mm": trace._CONSOLIDATE_MAX_PERP_MM,
        },
    }
    target = Path(__file__).with_name("results") / "geometry.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
