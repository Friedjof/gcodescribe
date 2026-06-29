"""Variable plotter feedrate from stroke timing.

Faster pen movement during capture → faster plotting, slower → slower, so the
plot keeps some of the natural rhythm. The result is always clamped to a safe
band around the profile's draw feed so a noisy capture can never command an
unsafe feedrate. Pure; consumed by the renderer.
"""

from __future__ import annotations

from math import hypot

# Default band relative to the configured draw feed.
DEFAULT_MIN_SCALE = 0.65
DEFAULT_MAX_SCALE = 1.25


def _point_speed(points: list[dict]) -> list[float]:
    """Instantaneous speed (em/ms) for the segment ending at each point."""
    n = len(points)
    speeds = [0.0] * n
    for i in range(1, n):
        a, b = points[i - 1], points[i]
        dist = hypot(b.get("x", 0.0) - a.get("x", 0.0), b.get("y", 0.0) - a.get("y", 0.0))
        ta = a.get("t")
        tb = b.get("t")
        if isinstance(ta, (int, float)) and isinstance(tb, (int, float)) and tb > ta:
            speeds[i] = dist / (tb - ta)
        else:
            speeds[i] = float("nan")
    if n > 1:
        speeds[0] = speeds[1]
    return speeds


def feed_scales(
    points: list[dict],
    *,
    min_scale: float = DEFAULT_MIN_SCALE,
    max_scale: float = DEFAULT_MAX_SCALE,
) -> list[float]:
    """Per-point feed *scale* (relative to the draw feed) for moving to each point.

    Faster capture → higher scale. Normalized within the stroke to
    ``[min_scale, max_scale]``. A stroke without usable timing returns 1.0 for
    every point. Scales are profile-independent, so the same captured stroke
    plots safely under any plotter calibration.
    """
    n = len(points)
    if n == 0:
        return []
    speeds = _point_speed(points)
    valid = [s for s in speeds if s == s and s > 0]  # drop NaN/zero
    if not valid:
        return [1.0] * n
    smin = min(valid)
    smax = max(valid)
    span = smax - smin

    scales: list[float] = []
    for s in speeds:
        if s != s or span <= 0:  # NaN or no spread → neutral
            scales.append(1.0)
        else:
            ratio = (s - smin) / span
            scales.append(min_scale + ratio * (max_scale - min_scale))
    return scales


def clamp_feed(scale: float, draw_feed: float, floor: float, ceil: float) -> float:
    """Turn a feed scale into an absolute, safety-clamped feedrate (mm/min)."""
    if ceil < floor:
        floor, ceil = ceil, floor
    return min(ceil, max(floor, draw_feed * scale))


def stroke_feeds(
    points: list[dict],
    draw_feed: float,
    *,
    min_scale: float = DEFAULT_MIN_SCALE,
    max_scale: float = DEFAULT_MAX_SCALE,
    floor: float | None = None,
    ceil: float | None = None,
) -> list[float]:
    """Per-point absolute feedrate (mm/min), clamped to the ``[floor, ceil]`` band."""
    lo = floor if floor is not None else draw_feed * min_scale
    hi = ceil if ceil is not None else draw_feed * max_scale
    return [
        clamp_feed(scale, draw_feed, lo, hi)
        for scale in feed_scales(points, min_scale=min_scale, max_scale=max_scale)
    ]
