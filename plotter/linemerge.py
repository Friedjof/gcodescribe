"""Chain polylines with coincident endpoints into continuous strokes.

Games (mazes, sudoku grids, coloring pages) and single-line text emit their art
as many short polylines — a maze wall is a single grid edge, a grid line is one
segment per cell. Drawn naively, every one of those becomes its own pen-down /
pen-up, so a wall that the eye reads as one straight line is plotted as dozens
of disconnected dabs with a lift between each. That stuttering is the artefact.

``merge_polylines`` stitches those pieces back together: wherever one polyline
ends exactly where another begins, they are joined into a single stroke the pen
draws without lifting. At a junction where several pieces meet, the join that
keeps the pen heading *straight through* is preferred, so a long straight wall
stays one continuous line instead of being broken at every crossing.

This is the same idea as vpype's ``linemerge`` (used on uploaded SVG/PDF files);
the scene/paint pipeline builds its g-code itself and so needs its own.
"""
from __future__ import annotations

import math
from collections import defaultdict

Point = tuple[float, float]
Polyline = list[Point]

# Endpoints closer than this (in plot-area mm) are treated as the same point.
# Grid art shares bit-identical corner coordinates, so any positive value joins
# them; the small slack only forgives floating-point drift from transforms.
DEFAULT_TOLERANCE = 0.05


def _unit(p1: Point, p2: Point) -> Point:
    dx, dy = p2[0] - p1[0], p2[1] - p1[1]
    d = math.hypot(dx, dy) or 1.0
    return (dx / d, dy / d)


def merge_polylines(
    polylines: list[Polyline], tol: float = DEFAULT_TOLERANCE
) -> list[Polyline]:
    """Greedily chain polylines whose endpoints coincide (within ``tol``).

    Returns new polylines; the input is not modified. Each output stroke is the
    longest run of input pieces that connect end-to-end. Where more than two
    pieces share an endpoint, the most collinear continuation is chosen so
    straight lines are not broken at crossings.
    """
    chains: list[Polyline] = [
        [tuple(p) for p in line] for line in polylines if len(line) >= 2
    ]
    if len(chains) <= 1:
        return chains

    inv = 1.0 / tol if tol > 0 else 1e9

    # Snap each endpoint to an integer node id, so coincident ends share a node.
    node_of: dict[tuple[int, int], int] = {}

    def node_id(p: Point) -> int:
        key = (round(p[0] * inv), round(p[1] * inv))
        nid = node_of.get(key)
        if nid is None:
            nid = len(node_of)
            node_of[key] = nid
        return nid

    incident: dict[int, list[int]] = defaultdict(list)
    end_nodes: list[tuple[int, int]] = []
    for i, chain in enumerate(chains):
        a, b = node_id(chain[0]), node_id(chain[-1])
        end_nodes.append((a, b))
        incident[a].append(i)
        incident[b].append(i)

    used = [False] * len(chains)

    def best_at(node: int, arrival: Point) -> int:
        """Pick the unused piece at ``node`` whose departure best continues a
        pen arriving along ``arrival`` (straightest first); -1 if none."""
        best, best_score = -1, -2.0
        for j in incident[node]:
            if used[j]:
                continue
            cj = chains[j]
            dep = _unit(cj[0], cj[1]) if end_nodes[j][0] == node else _unit(cj[-1], cj[-2])
            score = arrival[0] * dep[0] + arrival[1] * dep[1]
            if score > best_score:
                best, best_score = j, score
        return best

    def grow(chain: Polyline, tail: int) -> int:
        """Extend ``chain`` at its ``tail`` node as far as it connects."""
        while True:
            j = best_at(tail, _unit(chain[-2], chain[-1]))
            if j < 0:
                break
            used[j] = True
            if end_nodes[j][0] == tail:
                seg, far = chains[j], end_nodes[j][1]
            else:
                seg, far = chains[j][::-1], end_nodes[j][0]
            chain.extend(seg[1:])
            tail = far
        return tail

    result: list[Polyline] = []
    for i in range(len(chains)):
        if used[i]:
            continue
        used[i] = True
        chain = list(chains[i])
        head, tail = end_nodes[i]
        grow(chain, tail)       # extend forward from the tail
        chain.reverse()         # then flip and extend the other end
        grow(chain, head)
        result.append(chain)
    return result
