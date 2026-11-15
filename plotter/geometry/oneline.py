"""Reduce pen lifts without ever distorting the drawing.

The wrong way (what we explicitly avoid) is to skip the pen-up and draw a
straight line to the next stroke — that adds ink that isn't part of the artwork.

Instead, per connected component, we draw it as **one continuous stroke** by
retracing existing edges to make it traversable in a single trail. Shortest-path
pairing and a weighted spanning-tree heuristic limit the extra drawing distance.
Retraces preserve the geometry but put extra ink on some lines. Separate
components are left separate: the pen
lifts (invisibly) between them and the caller orders those moves to keep the
pen-up travel short. No bridges, no straight connectors.

See vpype ``linemerge``/``linesort`` and the Chinese-postman problem.
"""
from __future__ import annotations

import heapq
from collections import Counter

import numpy as np

# Out-of-memory safety ceiling. Large components use a linear parity pass;
# a whole city should still collapse to one stroke.
DEFAULT_MAX_LINES = 2_000_000

# OOM safety ceiling for odd-vertex processing.
MAX_COMPONENT_ODD = 2_000_000

# Repeated shortest-path searches become quadratic when a city has thousands
# of odd junctions. Large graphs use a bounded spanning-tree parity pass.
_SHORTEST_PATH_ODD_LIMIT = 2048


def _node_snapper(tol: float):
    """Map coincident endpoints to a shared integer node id (mm grid snap).

    Mirrors the endpoint snapping in :mod:`plotter.geometry.linemerge`.
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
    """Find the physically shortest path to another odd junction."""
    parent: dict[int, int | None] = {source: None}
    distances = {source: 0.0}
    queue = [(0.0, source)]
    while queue:
        distance, node = heapq.heappop(queue)
        if distance != distances[node]:
            continue
        if node in targets:
            path = [node]
            cur = parent[node]
            while cur is not None:
                path.append(cur)
                cur = parent[cur]
            return list(reversed(path))
        for nb in g.neighbors(node):
            cost = min(ed.get("length", 1.0) for ed in g.get_edge_data(node, nb).values())
            candidate = distance + cost
            if candidate < distances.get(nb, float("inf")):
                distances[nb] = candidate
                parent[nb] = node
                heapq.heappush(queue, (candidate, nb))
    return None


def _edge_pts(g, a: int, b: int, node_xy: dict[int, complex]) -> np.ndarray:
    data = g.get_edge_data(a, b)
    if data:
        for ed in sorted(data.values(), key=lambda edge: edge.get("length", float("inf"))):
            pts = ed.get("pts")
            if pts is not None:
                return pts
    return np.array([node_xy[a], node_xy[b]])


def _eulerise_component(g, node_xy: dict[int, complex]) -> bool:
    """Duplicate existing edges until the component has an Euler path.

    Small components pair odd vertices using shortest paths; large components
    use spanning-tree parity with at most one retrace per tree edge. Two odd
    vertices remain as endpoints. Returns False above the memory safety limit.
    """
    odd = [n for n, d in g.degree() if d % 2 == 1]
    if len(odd) <= 2:
        return True
    if len(odd) > MAX_COMPONENT_ODD:
        return False
    if len(odd) > _SHORTEST_PATH_ODD_LIMIT:
        import networkx as nx

        # In reverse tree order, an odd subtree requires its parent edge to be
        # retraced. Each tree edge is duplicated at most once, all original
        # edges survive, and exactly the two chosen endpoints remain odd.
        # Prefer short physical segments over arbitrary DFS branches. This
        # keeps the retrace bound tied to the lightest spanning tree.
        tree = nx.minimum_spanning_tree(g, weight="length")
        tree_edges = list(nx.dfs_edges(tree, source=odd[0]))
        parity = set(odd[2:])
        for a, b in reversed(tree_edges):
            if b in parity:
                parity.remove(b)
                if a in parity:
                    parity.remove(a)
                else:
                    parity.add(a)
                pts = _edge_pts(g, a, b, node_xy)
                g.add_edge(a, b, pts=pts, length=float(np.abs(np.diff(pts)).sum()), retrace=True)
        return True
    pool = set(odd[2:])  # keep the first two as the open path's endpoints
    while pool:
        u = pool.pop()
        path = _nearest_other_path(g, u, pool)
        if path is None:
            break
        pool.discard(path[-1])
        for a, b in zip(path, path[1:], strict=False):
            pts = _edge_pts(g, a, b, node_xy)
            g.add_edge(a, b, pts=pts, length=float(np.abs(np.diff(pts)).sum()), retrace=True)
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
        polylines: complex mm arrays (same convention as :mod:`plotter.artwork.drawing`).
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
        g.add_edge(a, b, key=i, pts=pl, length=float(np.abs(np.diff(pl)).sum()))

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
