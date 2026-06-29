"""Reduce pen lifts without ever distorting the drawing.

The wrong way (what we explicitly avoid) is to skip the pen-up and draw a
straight line to the next stroke — that adds ink that isn't part of the artwork.

Instead, per connected component, we draw it as **one continuous stroke** by
retracing the minimum set of edges needed to make it traversable in a single
trail (Chinese-postman / Eulerian path). Retraces always follow *existing*
lines — the pen goes over ink it already laid down, so they are invisible and
the shape is preserved exactly. Separate components are left separate: the pen
lifts (invisibly) between them and the caller orders those moves to keep the
pen-up travel short. No bridges, no straight connectors.

See vpype ``linemerge``/``linesort`` and the Chinese-postman problem.
"""
from __future__ import annotations

from collections import Counter, deque

import numpy as np

# Only an out-of-memory safety ceiling — NOT a quality knob. Eulerisation is
# O(E) and stays a few seconds even at ~140k edges / ~57k odd vertices, so a
# whole city must always collapse to one stroke. The guard must never be the
# reason a large map degrades into many pen lifts.
DEFAULT_MAX_LINES = 2_000_000

# OOM safety ceiling only. The greedy odd-vertex pairing is near-linear, so a
# whole city (one connected component) must still collapse to a single stroke
# rather than fall back to per-stroke pen lifts.
MAX_COMPONENT_ODD = 2_000_000


def _node_snapper(tol: float):
    """Map coincident endpoints to a shared integer node id (mm grid snap).

    Mirrors the endpoint snapping in :mod:`plotter.linemerge`.
    """
    inv = 1.0 / tol if tol > 0 else 1e9
    node_of: dict[tuple[int, int], int] = {}

    def node_id(p: complex) -> int:
        key = (round(p.real * inv), round(p.imag * inv))
        nid = node_of.get(key)
        if nid is None:
            nid = len(node_of)
            node_of[key] = nid
        return nid

    return node_id


def _node_input(lines: list[np.ndarray], tol: float) -> list[np.ndarray]:
    """Split every polyline at the points it shares with another polyline.

    Crucial: callers usually pass *merged* strokes, where roads that cross at a
    junction meet at an **interior** vertex (e.g. a "+"). The connectivity graph
    is built from endpoints, so without this those crossing strokes look like
    separate components and the pen lifts between them. Splitting at shared
    vertices turns every junction into a node so the whole network is one
    connected graph (and can be drawn as one stroke).
    """
    inv = 1.0 / tol if tol > 0 else 1e9

    def key(p: complex) -> tuple[int, int]:
        return (round(p.real * inv), round(p.imag * inv))

    counts: Counter[tuple[int, int]] = Counter()
    for line in lines:
        for p in line:
            counts[key(p)] += 1

    out: list[np.ndarray] = []
    for line in lines:
        start = 0
        for i in range(1, len(line) - 1):  # interior vertices only
            if counts[key(line[i])] >= 2:  # shared with another vertex → junction
                out.append(line[start:i + 1])
                start = i
        out.append(line[start:])
    return [seg for seg in out if len(seg) >= 2]


def _orient(pts: np.ndarray, anchor: complex) -> np.ndarray:
    """Return ``pts`` ordered so it starts at the end nearest ``anchor``."""
    return pts if abs(pts[0] - anchor) <= abs(pts[-1] - anchor) else pts[::-1]


def _nearest_other_path(g, source: int, targets: set[int]) -> list[int] | None:
    """BFS from ``source``; return the node path to the nearest node in
    ``targets`` (following existing edges), or ``None`` if none is reachable."""
    parent: dict[int, int | None] = {source: None}
    queue: deque[int] = deque([source])
    while queue:
        node = queue.popleft()
        for nb in g.neighbors(node):
            if nb in parent:
                continue
            parent[nb] = node
            if nb in targets:
                path = [nb]
                cur: int | None = node
                while cur is not None:
                    path.append(cur)
                    cur = parent[cur]
                path.reverse()
                return path  # source ... nb
            queue.append(nb)
    return None


def _edge_pts(g, a: int, b: int, node_xy: dict[int, complex]) -> np.ndarray:
    data = g.get_edge_data(a, b)
    if data:
        for ed in data.values():
            pts = ed.get("pts")
            if pts is not None:
                return pts
    return np.array([node_xy[a], node_xy[b]])


def _eulerise_component(g, node_xy: dict[int, complex]) -> bool:
    """Duplicate edges along existing shortest paths until the component has an
    Euler path (0 or 2 odd vertices). Retraces follow existing lines, so they
    are invisible. Two odd vertices are left as the trail's endpoints to keep
    overdraw minimal. Returns ``False`` if the component is too big to eulerise.
    """
    odd = [n for n, d in g.degree() if d % 2 == 1]
    if len(odd) <= 2:
        return True
    if len(odd) > MAX_COMPONENT_ODD:
        return False
    pool = set(odd[2:])  # keep the first two as the open path's endpoints
    while pool:
        u = pool.pop()
        path = _nearest_other_path(g, u, pool)
        if path is None:
            break
        pool.discard(path[-1])
        for a, b in zip(path, path[1:], strict=False):
            g.add_edge(a, b, pts=_edge_pts(g, a, b, node_xy), retrace=True)
    return True


def _walk(g, node_xy: dict[int, complex], tol: float) -> list[complex]:
    """Concatenate the Eulerian trail of ``g`` into one continuous point list."""
    import networkx as nx

    out: list[complex] = []
    for u, v, key in nx.eulerian_path(g, keys=True):
        data = g.get_edge_data(u, v) or {}
        ed = data.get(key, {})
        pts = ed.get("pts")
        if pts is None:
            pts = _edge_pts(g, u, v, node_xy)
        seg = _orient(np.asarray(pts), node_xy[u])
        seg_list = list(seg)
        if out and abs(out[-1] - seg_list[0]) <= tol:
            out.extend(seg_list[1:])
        else:
            out.extend(seg_list)
    return out


def continuous_path(
    polylines: list[np.ndarray],
    *,
    tol: float,
    max_lines: int = DEFAULT_MAX_LINES,
) -> list[np.ndarray]:
    """Collapse each connected component into one continuous stroke.

    Args:
        polylines: complex mm arrays (same convention as :mod:`plotter.drawing`).
        tol: endpoints closer than this (mm) are treated as one junction.
        max_lines: above this many strokes, return the input unchanged.

    Returns:
        One stroke per connected component (retraces over existing ink only —
        no visible connectors, no bridges between components). The caller lifts
        the pen between the returned strokes with invisible pen-up travel.
    """
    import networkx as nx

    raw = [np.asarray(pl) for pl in polylines if len(pl) >= 2]
    if len(raw) <= 1 or len(raw) > max_lines:
        return raw

    # Split at shared (junction) vertices so crossing/merged strokes are seen as
    # connected, not as separate components.
    lines = _node_input(raw, tol)
    if len(lines) > max_lines:
        return raw

    node_id = _node_snapper(tol)
    g = nx.MultiGraph()
    node_xy: dict[int, complex] = {}
    for i, pl in enumerate(lines):
        a, b = node_id(pl[0]), node_id(pl[-1])
        node_xy.setdefault(a, pl[0])
        node_xy.setdefault(b, pl[-1])
        g.add_edge(a, b, key=i, pts=pl)

    out: list[np.ndarray] = []
    for comp in nx.connected_components(g):
        sub = nx.MultiGraph(g.subgraph(comp))
        if _eulerise_component(sub, node_xy):
            stroke = _walk(sub, node_xy, tol)
            if len(stroke) >= 2:
                out.append(np.array(stroke))
        else:
            # Too large to eulerise invisibly: emit its strokes unchanged.
            for _, _, ed in sub.edges(data=True):
                pts = ed.get("pts")
                if pts is not None and len(pts) >= 2:
                    out.append(np.asarray(pts))
    return out


def continuous_polylines(
    polylines: list[list[tuple[float, float]]], tol: float
) -> list[list[tuple[float, float]]]:
    """Tuple-space wrapper around :func:`continuous_path` for the g-code
    generators (they work in (x, y) tuples). Reduces pen lifts by collapsing
    each connected component into one continuous stroke; the shape is preserved.
    """
    arrs = [np.array([complex(x, y) for x, y in pl]) for pl in polylines if len(pl) >= 2]
    out = continuous_path(arrs, tol=tol)
    return [[(float(p.real), float(p.imag)) for p in arr] for arr in out]
