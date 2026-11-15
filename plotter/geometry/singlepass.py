"""Draw every segment once, with the minimum stroke count per connected network."""
from __future__ import annotations

import math
from collections import Counter, defaultdict

Point = tuple[float, float]
Polyline = list[Point]


def dedupe_segments(lines: list[Polyline]) -> list[Polyline]:
    """Remove shared/reversed segments, preserving distinct parallel lines."""
    seen: set[tuple[Point, Point]] = set()
    out: list[Polyline] = []
    for line in lines:
        piece: Polyline = []
        for a, b in zip(line, line[1:], strict=False):
            if a == b:
                continue
            key = (a, b) if a < b else (b, a)
            if key in seen:
                if len(piece) >= 2:
                    out.append(piece)
                piece = []
                continue
            seen.add(key)
            if not piece:
                piece = [a]
            piece.append(b)
        if len(piece) >= 2:
            out.append(piece)
    return out


def single_pass_polylines(
    lines: list[Polyline], tol: float = 0.001, *, min_length_mm: float = 0.0
) -> list[Polyline]:
    """Euler decomposition using virtual pen-up edges, never retracing ink.

    A connected network with 2k odd junctions needs k strokes; even networks
    need one. Virtual edges join odd junctions to a hub and are removed from
    the final trails. No bridges between separate features are drawn.
    """
    lines = dedupe_segments(lines)
    if not lines or (len(lines) == 1 and min_length_mm <= 0):
        return lines
    inv = 1.0 / tol if tol > 0 else 1e9

    def key(p: Point) -> tuple[int, int]:
        return round(p[0] * inv), round(p[1] * inv)

    counts = Counter(key(p) for line in lines for p in line)
    nodes: dict[tuple[int, int], int] = {}
    edges: list[tuple[int, int, Polyline | None]] = []
    incident: dict[int, list[int]] = defaultdict(list)

    def node(p: Point) -> int:
        return nodes.setdefault(key(p), len(nodes))

    def add(a: int, b: int, points: Polyline | None) -> None:
        eid = len(edges)
        edges.append((a, b, points))
        incident[a].append(eid)
        incident[b].append(eid)

    for line in lines:
        start = 0
        for end in range(1, len(line)):
            if end == len(line) - 1 or counts[key(line[end])] > 1:
                piece = line[start:end + 1]
                add(node(piece[0]), node(piece[-1]), piece)
                start = end

    pruned = bytearray(len(edges))
    if min_length_mm > 0:
        # Filter graph branches before Euler decomposition, so a tiny dead end
        # hidden inside a long merged stroke can still be removed. Through
        # connections are preserved, regardless of OSM way fragmentation.
        degree = {n: len(eids) for n, eids in incident.items()}
        pending = [n for n, d in degree.items() if d == 1 or (
            d == 2 and incident[n][0] == incident[n][1]
        )]
        while pending:
            n = pending.pop()
            available = [eid for eid in incident[n] if not pruned[eid]]
            if not available or (len(available) > 1 and len(set(available)) > 1):
                continue
            eid = available[0]
            a, b, points = edges[eid]
            length = sum(math.dist(p, q) for p, q in zip(points, points[1:], strict=False))
            if length >= min_length_mm:
                continue
            pruned[eid] = 1
            for end in (a, b):
                degree[end] -= 1
                if degree[end] == 1:
                    pending.append(end)
        for n in incident:
            incident[n] = [eid for eid in incident[n] if not pruned[eid]]

    hub = len(nodes)
    for n in list(incident):
        if len(incident[n]) % 2:
            add(hub, n, None)
    used = pruned + bytearray(len(edges) - len(pruned))
    out: list[Polyline] = []
    starts = [hub, *nodes.values()] if hub in incident else list(nodes.values())
    for start in starts:
        stack: list[tuple[int, int | None, bool]] = [(start, None, False)]
        route: list[tuple[int, bool]] = []
        while stack:
            n = stack[-1][0]
            while incident[n] and used[incident[n][-1]]:
                incident[n].pop()
            if not incident[n]:
                _, eid, reverse = stack.pop()
                if eid is not None:
                    route.append((eid, reverse))
                continue
            eid = incident[n].pop()
            used[eid] = 1
            a, b, _ = edges[eid]
            stack.append((b if n == a else a, eid, n != a))
        stroke: Polyline = []
        for eid, reverse in reversed(route):
            points = edges[eid][2]
            if points is None:
                if len(stroke) >= 2:
                    out.append(stroke)
                stroke = []
            else:
                segment = points[::-1] if reverse else points
                stroke.extend(segment if not stroke else segment[1:])
        if len(stroke) >= 2:
            out.append(stroke)
    return out
