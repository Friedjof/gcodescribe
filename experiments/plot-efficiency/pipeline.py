"""Offline production-renderer measurements; never connects to a printer.

Run from the repository root:
    PYTHONPATH=. .venv/bin/python experiments/plot-efficiency/pipeline.py

Times cover scene_gcode, including its safety check, after one warmup. They
exclude source generation, HTTP, UI, serialization of this report and physical
plotting. Duration metrics are the app's estimates, not measured machine time.
"""

from __future__ import annotations

import json
import math
import platform
import re
import statistics
import time
from pathlib import Path

from plotter.coloring_pages import ColoringPageGenerator
from plotter.core.calibration import Calibration
from plotter.gcode.metrics import analyze_gcode, metrics_dict
from plotter.gcode.preview import parse_gcode_3d_text
from plotter.gcode.scene import scene_gcode
from plotter.maze import generate_maze
from plotter.printer.serial.transport import DEFAULT_BAUD, prepare_lines

SEED = "pipeline-audit"
REPEATS = 3
XY_WORDS = re.compile(r"^G[01] X([^ ]+) Y([^ ]+)")
FEED_WORD = re.compile(r" F([0-9.]+)")
MOTION_WORDS = re.compile(r"([GXYZF])(-?\d+(?:\.\d+)?)")


def modal_feeds(text: str) -> str:
    """Prototype only: omit F if the last explicit modal feed is identical.

    Z feeds participate, so the next XY move retains its required feed change.
    No XY/Z points or commands are removed. This is for generated G-code only.
    """
    result: list[str] = []
    previous_feed: float | None = None
    for line in prepare_lines(text):
        if match := FEED_WORD.search(line):
            value = float(match[1])
            if value == previous_feed:
                line = line[:match.start()] + line[match.end():]
            previous_feed = value
        result.append(line)
    return "\n".join(result) + "\n"


def motion_states(text: str) -> list[tuple]:
    """Resolve every generated G0/G1 endpoint and its effective modal feed."""
    x = y = z = 0.0
    feed = None
    states = []
    for line in prepare_lines(text):
        words = {key: float(value) for key, value in MOTION_WORDS.findall(line)}
        feed = words.get("F", feed)
        command = words.get("G")
        if command not in (0, 1):
            continue
        x, y, z = words.get("X", x), words.get("Y", y), words.get("Z", z)
        states.append((command, x, y, z, feed))
    return states


def wire_metrics(text: str) -> dict:
    plain = "\n".join(prepare_lines(text)) + "\n"
    compact = modal_feeds(text)
    original = metrics_dict(analyze_gcode(plain))
    reduced = metrics_dict(analyze_gcode(compact))
    original.pop("size_bytes")
    reduced.pop("size_bytes")
    assert original == reduced, "Modal-F prototype changed motion metrics"
    assert parse_gcode_3d_text(plain) == parse_gcode_3d_text(compact)
    assert motion_states(plain) == motion_states(compact), "Per-move feeds changed"
    wire_bytes = len(plain.encode())
    compact_bytes = len(compact.encode())
    commands = len(prepare_lines(text))
    return {
        "commands": commands,
        "bytes": wire_bytes,
        "modal_F_bytes": compact_bytes,
        "modal_F_saved_percent": round(100 * (1 - compact_bytes / wire_bytes), 2),
        "uart_8N1_byte_floor_s": round(wire_bytes * 10 / DEFAULT_BAUD, 3),
        "modal_F_uart_8N1_byte_floor_s": round(compact_bytes * 10 / DEFAULT_BAUD, 3),
        "hypothetical_1ms_per_ack_host_wait_s": round(commands * 0.001, 3),
        "hypothetical_5ms_per_ack_host_wait_s": round(commands * 0.005, 3),
        "identical_3d_path_and_motion_metrics": True,
        "identical_per_move_modal_feed_sequence": True,
    }


def measure(name: str, polylines: list, *, continuous: bool = True) -> dict:
    page = {
        "id": name,
        "objects": [{"id": "geometry", "cachedPolylines": polylines}],
        "continuous": continuous,
    }
    calibration = Calibration()
    code = scene_gcode(page, calibration)
    runs: list[float] = []
    for _ in range(REPEATS):
        start = time.perf_counter()
        repeated = scene_gcode(page, calibration)
        runs.append(time.perf_counter() - start)
        assert repeated == code, "Repeated render must be deterministic"

    previous = None
    zero_xy_draws = 0
    for line in code.splitlines():
        if match := XY_WORDS.match(line):
            position = (match[1], match[2])
            zero_xy_draws += line.startswith("G1") and position == previous
            previous = position
    return {
        "case": name,
        "continuous": continuous,
        "input_strokes": len(polylines),
        "input_points": sum(map(len, polylines)),
        "input_draw_mm": round(sum(
            math.dist(a, b)
            for line in polylines for a, b in zip(line, line[1:], strict=False)
        ), 3),
        "median_scene_render_s": round(statistics.median(runs), 6),
        "zero_xy_draw_commands": zero_xy_draws,
        "app_metrics": metrics_dict(analyze_gcode(code)),
        "wire": wire_metrics(code),
    }


def main() -> None:
    cases = []
    for count in (2, 101, 1001, 10001):
        line = [[10 + 100 * i / (count - 1), 10] for i in range(count)]
        cases.append(measure(f"100mm_collinear_{count}", [line], continuous=False))
    cases.append(measure(
        "0.1mm_quantized_1001",
        [[[10 + 0.1 * i / 1000, 10] for i in range(1001)]],
        continuous=False,
    ))
    generator = ColoringPageGenerator()
    for kind, mode in (
        ("mandala", "flower"), ("pattern", "truchet"),
        ("pattern", "wave_field"), ("pattern", "hex_mosaic"),
    ):
        generate = (generator.generate_mandala_page if kind == "mandala"
                    else generator.generate_math_pattern_page)
        artwork = generate(SEED, mode, 164, 200, complexity=0.8)
        cases.append(measure(f"{kind}_{mode}", artwork.polylines))
        if mode == "wave_field":
            cases.append(measure(
                "pattern_wave_field_no_continuous", artwork.polylines, continuous=False,
            ))
    for size in (25, 45):
        maze = generate_maze("classic", SEED, size, 164, 200)
        cases.append(measure(f"maze_{size}", maze.wall_lines + maze.marker_lines))
        if size == 45:
            cases.append(measure(
                "maze_45_no_continuous", maze.wall_lines + maze.marker_lines, continuous=False,
            ))

    result = {
        "scope": __doc__.strip(),
        "python": platform.python_version(),
        "seed": SEED,
        "repeats_after_warmup": REPEATS,
        "calibration": Calibration().as_dict(),
        "wire_assumptions": {
            "baud": DEFAULT_BAUD,
            "bits_per_byte": 10,
            "warning": (
                "UART byte times are theoretical lower bounds. ACK latencies are "
                "hypothetical sensitivity cases, not measurements. Host wait and "
                "firmware motion may overlap; do not add them to plot-time estimates."
            ),
        },
        "cases": cases,
    }
    output = Path(__file__).parent / "results" / "pipeline.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n")
    print(f"Wrote {len(cases)} cases with deterministic renders and modal-F checks: {output}")


if __name__ == "__main__":
    main()
