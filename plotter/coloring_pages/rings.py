"""Ring style library for the mandala engine.

Each style draws one annular ring (between r0 and r1) of a mandala with
n-fold symmetry. Styles only use closed or ring-spanning polylines so the
result stays plotter-friendly. `detail` (0..1) adds nested ornaments for
older kids and adults.
"""

from __future__ import annotations

import math
import random

from .geometry import (
    arc,
    bud,
    circle,
    closed_polygon,
    diamond,
    heart,
    leaf,
    petal,
    polar,
    regular_polygon,
)
from .types import Point, Polyline

Ctx = tuple[float, float]  # cx, cy


def _cell_angles(n: int, k: int, phase: float) -> tuple[float, float, float]:
    a0 = (k + phase) / n * math.tau
    a1 = (k + 1 + phase) / n * math.tau
    return a0, a1, (a0 + a1) / 2


def ring_petals(
    cx: float,
    cy: float,
    r0: float,
    r1: float,
    n: int,
    phase: float,
    rng: random.Random,
    detail: float,
) -> list[Polyline]:
    lines: list[Polyline] = []
    width = math.tau / n * rng.uniform(0.82, 1.0)
    echo = detail > 0.25 and rng.random() < 0.4 + detail * 0.5
    tip_dot = detail > 0.45 and rng.random() < detail * 0.7
    for k in range(n):
        _, _, mid = _cell_angles(n, k, phase)
        lines.append(petal(cx, cy, mid, r0, r1, width))
        if echo:
            lines.append(
                petal(cx, cy, mid, r0 + (r1 - r0) * 0.12, r0 + (r1 - r0) * 0.62, width * 0.55)
            )
        if tip_dot:
            dot_r = min((r1 - r0) * 0.09, 2.2)
            sx, sy = polar(cx, cy, r1 - dot_r * 2.2, mid)
            lines.append(circle(sx, sy, dot_r, 14))
    return lines


def ring_pointed(
    cx: float,
    cy: float,
    r0: float,
    r1: float,
    n: int,
    phase: float,
    rng: random.Random,
    detail: float,
) -> list[Polyline]:
    lines: list[Polyline] = []
    width = math.tau / n * rng.uniform(0.3, 0.46)
    vein = detail > 0.3 and rng.random() < 0.45 + detail * 0.5
    for k in range(n):
        _, _, mid = _cell_angles(n, k, phase)
        lines.append(leaf(cx, cy, mid, r0, r1, width))
        if vein:
            lines.append(
                [
                    polar(cx, cy, r0 + (r1 - r0) * 0.12, mid),
                    polar(cx, cy, r0 + (r1 - r0) * 0.82, mid),
                ]
            )
    return lines


def ring_buds(
    cx: float,
    cy: float,
    r0: float,
    r1: float,
    n: int,
    phase: float,
    rng: random.Random,
    detail: float,
) -> list[Polyline]:
    lines: list[Polyline] = []
    cell_w = math.tau * (r0 + r1) / 2 / n
    half = min(cell_w * rng.uniform(0.3, 0.42), (r1 - r0) * 0.55)
    echo = detail > 0.35 and rng.random() < detail * 0.8
    for k in range(n):
        _, _, mid = _cell_angles(n, k, phase)
        lines.append(bud(cx, cy, mid, r0, r1, half))
        if echo:
            lines.append(bud(cx, cy, mid, r0 + (r1 - r0) * 0.18, r0 + (r1 - r0) * 0.72, half * 0.5))
    return lines


def ring_scallops(
    cx: float,
    cy: float,
    r0: float,
    r1: float,
    n: int,
    phase: float,
    rng: random.Random,
    detail: float,
) -> list[Polyline]:
    lines: list[Polyline] = [circle(cx, cy, r0, max(48, n * 8))]
    bulge = rng.uniform(0.85, 1.0)
    echo = detail > 0.3 and rng.random() < 0.35 + detail * 0.5
    for k in range(n):
        a0, a1, _ = _cell_angles(n, k, phase)
        lines.append(_scallop(cx, cy, r0, r1, a0, a1, bulge))
        if echo:
            lines.append(
                _scallop(
                    cx,
                    cy,
                    r0,
                    r0 + (r1 - r0) * 0.55,
                    a0 + (a1 - a0) * 0.18,
                    a1 - (a1 - a0) * 0.18,
                    bulge,
                )
            )
    return lines


def _scallop(
    cx: float, cy: float, r0: float, r1: float, a0: float, a1: float, bulge: float
) -> Polyline:
    pts: list[Point] = []
    for i in range(13):
        t = i / 12
        r = r0 + (r1 - r0) * math.sin(math.pi * t) ** 0.85 * bulge
        pts.append(polar(cx, cy, r, a0 + (a1 - a0) * t))
    return pts


def ring_dots(
    cx: float,
    cy: float,
    r0: float,
    r1: float,
    n: int,
    phase: float,
    rng: random.Random,
    detail: float,
) -> list[Polyline]:
    lines: list[Polyline] = []
    mid_r = (r0 + r1) / 2
    cell_w = math.tau * mid_r / n
    big = min((r1 - r0) * 0.4, cell_w * 0.36)
    alternate = detail > 0.25 and rng.random() < 0.5
    double = detail > 0.5 and rng.random() < detail * 0.7
    for k in range(n):
        _, _, mid = _cell_angles(n, k, phase)
        r = big * (0.55 if alternate and k % 2 else 1.0)
        sx, sy = polar(cx, cy, mid_r, mid)
        lines.append(circle(sx, sy, r, 18))
        if double and r == big:
            lines.append(circle(sx, sy, r * 0.5, 12))
    return lines


def ring_diamonds(
    cx: float,
    cy: float,
    r0: float,
    r1: float,
    n: int,
    phase: float,
    rng: random.Random,
    detail: float,
) -> list[Polyline]:
    lines: list[Polyline] = []
    width = math.tau / n * rng.uniform(0.32, 0.45)
    nested = detail > 0.3 and rng.random() < 0.4 + detail * 0.5
    for k in range(n):
        _, _, mid = _cell_angles(n, k, phase)
        lines.append(diamond(cx, cy, mid, r0, r1, width))
        if nested:
            lines.append(
                diamond(cx, cy, mid, r0 + (r1 - r0) * 0.25, r1 - (r1 - r0) * 0.25, width * 0.5)
            )
    return lines


def ring_spikes(
    cx: float,
    cy: float,
    r0: float,
    r1: float,
    n: int,
    phase: float,
    rng: random.Random,
    detail: float,
) -> list[Polyline]:
    lines: list[Polyline] = [circle(cx, cy, r0, max(48, n * 6))]
    inset = rng.uniform(0.02, 0.12)
    inner_spike = detail > 0.35 and rng.random() < detail * 0.8
    for k in range(n):
        a0, a1, mid = _cell_angles(n, k, phase)
        base0 = a0 + (a1 - a0) * inset
        base1 = a1 - (a1 - a0) * inset
        lines.append(
            closed_polygon(
                [polar(cx, cy, r0, base0), polar(cx, cy, r1, mid), polar(cx, cy, r0, base1)]
            )
        )
        if inner_spike:
            lines.append(
                closed_polygon(
                    [
                        polar(cx, cy, r0 + (r1 - r0) * 0.08, a0 + (a1 - a0) * 0.3),
                        polar(cx, cy, r0 + (r1 - r0) * 0.55, mid),
                        polar(cx, cy, r0 + (r1 - r0) * 0.08, a1 - (a1 - a0) * 0.3),
                    ]
                )
            )
    return lines


def ring_zigzag(
    cx: float,
    cy: float,
    r0: float,
    r1: float,
    n: int,
    phase: float,
    rng: random.Random,
    detail: float,
) -> list[Polyline]:
    lines: list[Polyline] = [circle(cx, cy, r0, max(48, n * 6)), circle(cx, cy, r1, max(48, n * 6))]
    pad = (r1 - r0) * rng.uniform(0.04, 0.14)
    pts: list[Point] = []
    for k in range(n * 2 + 1):
        a = (k / 2 + phase) / n * math.tau
        r = r1 - pad if k % 2 else r0 + pad
        pts.append(polar(cx, cy, r, a))
    lines.append(pts)
    if detail > 0.45 and rng.random() < detail * 0.7:
        mid_r = (r0 + r1) / 2
        dot = min((r1 - r0) * 0.16, 1.8)
        for k in range(n):
            sx, sy = polar(cx, cy, mid_r, (k + 0.5 + phase) / n * math.tau)
            lines.append(circle(sx, sy, dot, 10))
    return lines


def ring_loops(
    cx: float,
    cy: float,
    r0: float,
    r1: float,
    n: int,
    phase: float,
    rng: random.Random,
    detail: float,
) -> list[Polyline]:
    lines: list[Polyline] = []
    mid_r = (r0 + r1) / 2
    spacing = math.tau * mid_r / n
    radius = min((r1 - r0) * 0.48, spacing * rng.uniform(0.55, 0.68))
    inner = detail > 0.4 and rng.random() < detail * 0.6
    for k in range(n):
        _, _, mid = _cell_angles(n, k, phase)
        sx, sy = polar(cx, cy, mid_r, mid)
        lines.append(circle(sx, sy, radius, 24))
        if inner:
            lines.append(circle(sx, sy, radius * 0.45, 14))
    return lines


def ring_hearts(
    cx: float,
    cy: float,
    r0: float,
    r1: float,
    n: int,
    phase: float,
    rng: random.Random,
    detail: float,
) -> list[Polyline]:
    lines: list[Polyline] = []
    mid_r = (r0 + r1) / 2
    cell_w = math.tau * mid_r / n
    size = min((r1 - r0) * 0.46, cell_w * 0.4)
    echo = detail > 0.35 and rng.random() < detail * 0.7
    for k in range(n):
        _, _, mid = _cell_angles(n, k, phase)
        lines.append(heart(cx, cy, mid, mid_r, size))
        if echo:
            lines.append(heart(cx, cy, mid, mid_r, size * 0.5))
    return lines


def ring_cells(
    cx: float,
    cy: float,
    r0: float,
    r1: float,
    n: int,
    phase: float,
    rng: random.Random,
    detail: float,
) -> list[Polyline]:
    """Brick-wall ring: concentric circles plus alternating radial dividers."""
    splits = 2 if detail > 0.45 and (r1 - r0) > 9 and rng.random() < detail else 1
    radii = [r0 + (r1 - r0) * i / (splits + 1) for i in range(splits + 2)]
    lines: list[Polyline] = [circle(cx, cy, r, max(48, n * 6)) for r in radii]
    for band in range(splits + 1):
        offset = phase + (band % 2) * 0.5
        for k in range(n):
            a = (k + offset) / n * math.tau
            lines.append([polar(cx, cy, radii[band], a), polar(cx, cy, radii[band + 1], a)])
    return lines


def ring_waves(
    cx: float,
    cy: float,
    r0: float,
    r1: float,
    n: int,
    phase: float,
    rng: random.Random,
    detail: float,
) -> list[Polyline]:
    mid_r = (r0 + r1) / 2
    amp = (r1 - r0) * rng.uniform(0.3, 0.46)
    lines: list[Polyline] = [_wave_circle(cx, cy, mid_r, amp, n, phase * math.tau)]
    if detail > 0.3 and rng.random() < 0.4 + detail * 0.5:
        lines.append(_wave_circle(cx, cy, mid_r, amp, n, phase * math.tau + math.pi))
    return lines


def _wave_circle(cx: float, cy: float, mid_r: float, amp: float, n: int, phase: float) -> Polyline:
    samples = max(96, n * 14)
    pts = [
        polar(
            cx,
            cy,
            mid_r + amp * math.sin(n * (math.tau * i / samples) + phase),
            math.tau * i / samples,
        )
        for i in range(samples)
    ]
    return closed_polygon(pts)


def ring_fans(
    cx: float,
    cy: float,
    r0: float,
    r1: float,
    n: int,
    phase: float,
    rng: random.Random,
    detail: float,
) -> list[Polyline]:
    """Fan/shell ring: radial cell borders plus nested arcs growing outward."""
    lines: list[Polyline] = [circle(cx, cy, r0, max(48, n * 6)), circle(cx, cy, r1, max(48, n * 6))]
    arcs = 2 + (1 if detail > 0.35 else 0) + (1 if detail > 0.7 else 0)
    for k in range(n):
        a0, a1, _ = _cell_angles(n, k, phase)
        lines.append([polar(cx, cy, r0, a0), polar(cx, cy, r1, a0)])
        for j in range(1, arcs + 1):
            t = j / (arcs + 1)
            lines.append(arc(cx, cy, r0 + (r1 - r0) * t, a0, a1, 8))
    # the nested arcs double as separators, drop the plain inner circle again
    return lines[1:] if rng.random() < 0.4 else lines


RING_STYLES = {
    "petals": ring_petals,
    "pointed": ring_pointed,
    "buds": ring_buds,
    "scallops": ring_scallops,
    "dots": ring_dots,
    "diamonds": ring_diamonds,
    "spikes": ring_spikes,
    "zigzag": ring_zigzag,
    "loops": ring_loops,
    "hearts": ring_hearts,
    "cells": ring_cells,
    "waves": ring_waves,
    "fans": ring_fans,
}

# Styles that read well even on very narrow rings.
THIN_OK = {"dots", "zigzag", "scallops", "waves", "cells", "loops"}
# Styles that want room to breathe.
WIDE_PREFERRED = {"petals", "buds", "hearts", "fans", "pointed"}


def center_medallion(
    cx: float, cy: float, r: float, rng: random.Random, detail: float
) -> list[Polyline]:
    variant = rng.choice(["rosette", "rings", "star", "daisy", "spiral"])
    lines: list[Polyline] = []
    if variant == "rosette":
        n = rng.choice([6, 8])
        lines.append(circle(cx, cy, r * 0.3, 24))
        width = math.tau / n * 0.9
        for k in range(n):
            lines.append(petal(cx, cy, k / n * math.tau, r * 0.3, r, width))
    elif variant == "rings":
        for f in (1.0, 0.62, 0.3):
            lines.append(circle(cx, cy, r * f, 32))
        if detail > 0.4:
            for k in range(8):
                lines.append(
                    [polar(cx, cy, r * 0.62, k / 8 * math.tau), polar(cx, cy, r, k / 8 * math.tau)]
                )
    elif variant == "star":
        sides = rng.choice([5, 6, 8])
        rot = rng.uniform(0, math.tau)
        lines.append(regular_polygon(cx, cy, r, sides, rot))
        lines.append(regular_polygon(cx, cy, r * 0.55, sides, rot + math.pi / sides))
        lines.append(circle(cx, cy, r * 0.22, 18))
    elif variant == "daisy":
        lines.append(circle(cx, cy, r * 0.42, 24))
        n = rng.choice([6, 8, 10])
        dot = min(r * 0.24, math.tau * r * 0.7 / n * 0.38)
        for k in range(n):
            sx, sy = polar(cx, cy, r * 0.7, k / n * math.tau)
            lines.append(circle(sx, sy, dot, 14))
    else:  # spiral
        turns = 2.5 + detail * 1.5
        samples = int(turns * 28)
        direction = rng.choice([-1, 1])
        pts = [
            polar(cx, cy, r * i / samples, direction * turns * math.tau * i / samples)
            for i in range(samples + 1)
        ]
        lines.append(pts)
        lines.append(circle(cx, cy, r, 36))
    return lines
