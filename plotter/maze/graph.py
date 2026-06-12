from __future__ import annotations

import random

import networkx as nx


def edge_key(a: str, b: str) -> str:
    return "--".join(sorted((str(a), str(b))))


def growing_tree(graph: nx.Graph, rng: random.Random, backtrack_chance: float = 0.7) -> nx.Graph:
    """Carve a perfect maze (spanning tree) with the growing-tree algorithm.

    ``backtrack_chance`` blends between recursive-backtracker behaviour
    (long winding corridors, value near 1) and Prim-like behaviour (short
    branchy corridors, value near 0). Neighbour iteration is sorted so the
    result is fully determined by the rng seed.
    """
    nodes = sorted(graph.nodes)
    start = nodes[rng.randrange(len(nodes))]
    tree = nx.Graph()
    tree.add_nodes_from(graph.nodes)
    visited = {start}
    active = [start]
    while active:
        index = len(active) - 1 if rng.random() < backtrack_chance else rng.randrange(len(active))
        node = active[index]
        candidates = [n for n in sorted(graph.neighbors(node)) if n not in visited]
        if not candidates:
            active.pop(index)
            continue
        chosen = candidates[rng.randrange(len(candidates))]
        visited.add(chosen)
        tree.add_edge(node, chosen)
        active.append(chosen)
    return tree


def solve_maze(graph: nx.Graph, start: str, end: str) -> list[str]:
    return nx.shortest_path(graph, start, end)


def validate_maze(base_graph: nx.Graph, maze_graph: nx.Graph, start: str, end: str) -> list[str]:
    """Check the perfect-maze invariants and return the unique solution path."""
    if set(base_graph.nodes) != set(maze_graph.nodes):
        raise ValueError("Maze graph lost nodes")
    if not nx.is_connected(maze_graph):
        raise ValueError("Maze graph is not connected")
    if maze_graph.number_of_edges() != maze_graph.number_of_nodes() - 1:
        raise ValueError("Maze graph contains loops")
    solution = solve_maze(maze_graph, start, end)
    if len(solution) < 2:
        raise ValueError("Maze solution is too short")
    return solution
