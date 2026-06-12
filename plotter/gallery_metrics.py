from __future__ import annotations

import math
import re
from dataclasses import asdict, dataclass

_WORD = re.compile(r"([GXYZF])(-?\d+(?:\.\d+)?)", re.IGNORECASE)

# Fallback feeds (mm/min) when a move carries no F word; match typical profiles.
_DEFAULT_TRAVEL_FEED = 3000.0
_DEFAULT_DRAW_FEED = 1500.0


@dataclass(frozen=True)
class GcodeMetrics:
    """Plottability facts extracted from a generated G-code job."""

    size_bytes: int
    command_count: int
    pen_lifts: int  # how often the pen is set down on the paper
    polyline_count: int
    point_count: int
    draw_mm: float  # total pen-down distance
    travel_mm: float  # total pen-up XY distance
    duration_s: float  # estimated plot time incl. Z moves
    points_per_mm: float  # structural density along the drawn path


def analyze_gcode(text: str) -> GcodeMetrics:
    """Measure the G-code this app generates (absolute coords, G0 travel,
    G1+XY draw, Z-only moves for pen up/down)."""
    x = y = z = 0.0
    feed = _DEFAULT_TRAVEL_FEED
    commands = 0
    pen_lifts = 0
    polylines = 0
    points = 0
    draw_mm = 0.0
    travel_mm = 0.0
    duration_s = 0.0
    drawing = False  # currently inside a pen-down polyline

    for raw in text.splitlines():
        line = raw.split(";", 1)[0].strip()
        if not line:
            continue
        words = {k.upper(): float(v) for k, v in _WORD.findall(line)}
        g = words.get("G")
        if g is None:
            continue
        commands += 1
        if g == 28:
            x = y = z = 0.0
            drawing = False
            continue
        if g not in (0, 1):
            continue
        nx, ny, nz = words.get("X", x), words.get("Y", y), words.get("Z", z)
        if "F" in words and words["F"] > 0:
            feed = words["F"]
        dist = math.dist((x, y, z), (nx, ny, nz))
        duration_s += dist / max(feed, 1.0) * 60.0

        moves_xy = "X" in words or "Y" in words
        if g == 1 and moves_xy:
            if not drawing:
                drawing = True
                polylines += 1
            draw_mm += dist
            points += 1
        elif moves_xy:
            travel_mm += dist
            drawing = False
        elif g == 1 and nz < z:
            pen_lifts += 1  # pen lowered onto the paper
            drawing = False
        else:
            drawing = False
        x, y, z = nx, ny, nz

    return GcodeMetrics(
        size_bytes=len(text.encode()),
        command_count=commands,
        pen_lifts=pen_lifts,
        polyline_count=polylines,
        point_count=points,
        draw_mm=round(draw_mm, 1),
        travel_mm=round(travel_mm, 1),
        duration_s=round(duration_s, 1),
        points_per_mm=round(points / draw_mm, 3) if draw_mm > 0 else 0.0,
    )


def _ramp(value: float, best: float, worst: float) -> float:
    """1.0 at/below ``best``, 0.0 at/above ``worst``, linear in between."""
    if worst == best:
        return 1.0
    return max(0.0, min(1.0, (worst - value) / (worst - best)))


def score_metrics(m: GcodeMetrics, max_gcode_bytes: int) -> dict:
    """Plottability score 0–100 with its sub-scores (each 0–100).

    - time: short plots are event-friendly (full marks ≤ 5 min, zero ≥ 45 min)
    - lifts: few pen lifts per metre mean clean, continuous strokes
    - size: small G-code relative to the hard limit
    - detail: enough drawn path to be interesting, without being excessive
    """
    time_part = _ramp(m.duration_s, 300.0, 2700.0)
    lifts_per_m = m.pen_lifts / max(m.draw_mm / 1000.0, 0.05)
    lifts_part = _ramp(lifts_per_m, 15.0, 150.0)
    size_part = _ramp(m.size_bytes, max_gcode_bytes * 0.08, max_gcode_bytes)
    # Detail rises until ~1.5 m of drawn path, then eases off for plots that
    # are mostly redundant ink (> 30 m).
    detail_part = min(_ramp(-m.draw_mm, -1500.0, 0.0), _ramp(m.draw_mm, 30000.0, 60000.0))

    total = 0.30 * time_part + 0.25 * lifts_part + 0.15 * size_part + 0.30 * detail_part
    return {
        "total": round(total * 100),
        "time": round(time_part * 100),
        "lifts": round(lifts_part * 100),
        "size": round(size_part * 100),
        "detail": round(detail_part * 100),
    }


def metrics_dict(m: GcodeMetrics) -> dict:
    return asdict(m)
