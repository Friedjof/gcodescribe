from __future__ import annotations

import re
from pathlib import Path

_WORD = re.compile(r"([GXYZ])(-?\d+(?:\.\d+)?)", re.IGNORECASE)


def parse_gcode(path: Path, max_points: int = 60000) -> dict:
    """Extract draw / travel polylines from a G-code job for the live view.

    Matches the G-code this app generates: absolute coordinates, ``G1`` with
    X/Y for drawing, ``G0`` with X/Y for travels, Z-only moves for pen up/down.
    Coordinates are printer-space mm.
    """
    polylines: list[list[list[float]]] = []
    travels: list[list[list[float]]] = []
    current: list[list[float]] | None = None
    x = y = 0.0
    points = 0
    truncated = False

    def close() -> None:
        nonlocal current
        if current is not None and len(current) > 1:
            polylines.append(current)
        current = None

    for line in path.read_text(errors="replace").splitlines():
        line = line.split(";", 1)[0].strip()
        if not line:
            continue
        words = {k.upper(): float(v) for k, v in _WORD.findall(line)}
        g = words.get("G")
        if g == 28:  # home
            close()
            x = y = 0.0
            continue
        if g not in (0, 1):
            continue
        nx = words.get("X", x)
        ny = words.get("Y", y)
        if "X" not in words and "Y" not in words:
            continue  # Z-only pen move
        if points >= max_points:
            truncated = True
            break
        if g == 0:
            close()
            travels.append([[x, y], [nx, ny]])
        else:
            if current is None:
                current = [[x, y]]
            current.append([nx, ny])
            points += 1
        x, y = nx, ny
    close()

    draw_pts = [p for line in polylines for p in line]
    bounds = None
    if draw_pts:
        xs = [p[0] for p in draw_pts]
        ys = [p[1] for p in draw_pts]
        bounds = [min(xs), min(ys), max(xs), max(ys)]

    return {
        "polylines": polylines,
        "travels": travels,
        "bounds": bounds,
        "truncated": truncated,
    }


def parse_gcode_3d(path: Path, max_points: int = 150000) -> dict:
    """Reconstruct the 3D tool path of a G-code job for the 3D preview.

    ``draws`` are pen-down drawing polylines, ``travels`` are pen-up moves
    including the Z lifts that connect them. Each point is ``[x, y, z]`` in
    printer-space mm. Matches the G-code this app generates (absolute coords,
    G1+XY = draw, G0 = travel, Z-only = pen lift/drop).
    """
    draws: list[list[list[float]]] = []
    travels: list[list[list[float]]] = []
    cur_draw: list[list[float]] | None = None
    cur_travel: list[list[float]] | None = None
    x = y = z = 0.0
    points = 0
    truncated = False

    def close_draw() -> None:
        nonlocal cur_draw
        if cur_draw is not None and len(cur_draw) > 1:
            draws.append(cur_draw)
        cur_draw = None

    def close_travel() -> None:
        nonlocal cur_travel
        if cur_travel is not None and len(cur_travel) > 1:
            travels.append(cur_travel)
        cur_travel = None

    for line in path.read_text(errors="replace").splitlines():
        line = line.split(";", 1)[0].strip()
        if not line:
            continue
        words = {k.upper(): float(v) for k, v in _WORD.findall(line)}
        g = words.get("G")
        if g == 28:  # home
            close_draw()
            close_travel()
            x = y = z = 0.0
            continue
        if g not in (0, 1):
            continue
        nx = words.get("X", x)
        ny = words.get("Y", y)
        nz = words.get("Z", z)
        if points >= max_points:
            truncated = True
            break
        moves_xy = "X" in words or "Y" in words
        is_draw = g == 1 and moves_xy
        if is_draw:
            close_travel()
            if cur_draw is None:
                cur_draw = [[x, y, z]]
            cur_draw.append([nx, ny, nz])
        else:
            # G0 travel or a pure Z move (pen lift/drop) — part of the travel.
            close_draw()
            if cur_travel is None:
                cur_travel = [[x, y, z]]
            cur_travel.append([nx, ny, nz])
        points += 1
        x, y, z = nx, ny, nz
    close_draw()
    close_travel()

    pts = [p for line in draws for p in line]
    bounds = None
    if pts:
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        zs = [p[2] for p in (pts + [q for t in travels for q in t])]
        bounds = [min(xs), min(ys), min(zs), max(xs), max(ys), max(zs)]

    return {
        "draws": draws,
        "travels": travels,
        "bounds": bounds,
        "truncated": truncated,
    }
