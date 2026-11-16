"""Microbenchmark of planning primitives, not a complete optimizer benchmark."""

import json
import time
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import LineString
from shapely.strtree import STRtree

results = []
for n in (20_000, 100_000, 400_000):
    x = np.linspace(0, 200, n // 100)
    start = time.perf_counter()
    lines = [LineString(np.column_stack((x, y + np.sin(x / 5)))) for y in np.arange(100) * 2]
    built = time.perf_counter()
    reduced = shapely.simplify(lines, tolerance=0.002, preserve_topology=True)
    simplified = time.perf_counter()
    tree = STRtree(lines)
    candidates = tree.query(lines, predicate="dwithin", distance=0.5)
    indexed = time.perf_counter()
    results.append(
        {
            "input_points": n,
            "output_points": int(shapely.get_num_coordinates(reduced).sum()),
            "geometry_ms": (built - start) * 1000,
            "simplify_ms": (simplified - built) * 1000,
            "index_query_ms": (indexed - simplified) * 1000,
            "candidate_pairs": int(candidates.shape[1]),
            "all_pairs": 100**2,
        }
    )
# Worst-case broad overlap makes any spatial tree unselective.
dense = [LineString([(0, i * 0.0001), (100, i * 0.0001)]) for i in range(1000)]
t0 = time.perf_counter()
tree = STRtree(dense)
pairs = tree.query(dense, predicate="dwithin", distance=0.5)
worst = {
    "strokes": 1000,
    "candidate_pairs": int(pairs.shape[1]),
    "index_query_ms": (time.perf_counter() - t0) * 1000,
}
result = {
    "shapely": shapely.__version__,
    "scope": "One local run; no full union or UI; counts self and directed pairs",
    "cases": results,
    "dense_worst_case": worst,
}
p = Path(__file__).parent / "results" / "benchmark.json"
p.parent.mkdir(exist_ok=True)
p.write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result, indent=2))
