# Plot efficiency: reproducible evaluation

Production version examined: `f62512b`. Findings and priorities: [evaluation](../../docs/plot-efficiency-evaluation.md). These files are not loaded by the app and make no printer/network requests. All artwork is synthetic or comes from existing deterministic app generators; no private documents or user data are included.

## Run

From the repository, use the existing Python environment, including Shapely, and Node 22 with type stripping:

```sh
PYTHONPATH=. .venv/bin/python experiments/plot-efficiency/orientation.py
PYTHONPATH=. .venv/bin/python experiments/plot-efficiency/routing.py
PYTHONPATH=. .venv/bin/python experiments/plot-efficiency/geometry.py
PYTHONPATH=. .venv/bin/python experiments/plot-efficiency/pipeline.py
node --experimental-strip-types experiments/plot-efficiency/styling.mjs
.venv/bin/ruff check experiments/plot-efficiency
```

Scripts overwrite their own raw data under `results/`. Routing also accepts `--output /tmp/custom-output`. Timings are local measurements under changing host load, not performance guarantees. Geometry is deterministic; later production changes may intentionally change the findings.

| Script / raw data | Question and checks |
| --- | --- |
| `orientation.py` / `results/orientation.json` | Optimise directions for fixed order with start/park; nine small exhaustive comparisons and six app motifs; exact segments and unchanged inputs |
| `routing.py` / `results/routing.json` | Greedy/2-opt, KD threshold, contour starts, coordinates, obstacles, grid merging and hatch junctions; segment invariants for route-only candidates and the real safety checker in the boundary reproduction |
| `geometry.py` / `results/geometry.json` | Actual centreline/preview functions on quality counterexamples; temporary raster files are removed |
| `pipeline.py` / `results/pipeline.json` | Thirteen G-code cases, dense/identical lines, real generators, Continuous controls, repeated rendering and modal-F output with identical motion/feed sequences |
| `styling.mjs` / `results/styling.json` | Actual designer functions for dashing, filling holes and drawing dots |

## Comparison images

- [Maze](results/routing-maze.svg): black drawing paths, dashed red travel. Existing scene greedy ordering on the left, existing SVG 2-opt on the right. Both use the same strokes after 0.001 mm merging, with Continuous off and no parking move. This does not compare against an unsorted source.
- [Obstacle](results/routing-obstacle.svg): a constructed counterexample. The left sorts by straight-line distance before rerouting travel; the right selects by actual detour length. The grey obstacle has 3 mm planning clearance. Both preserve every drawn segment.

Geometric exactness means unchanged centrelines/segments, not proven identical ink deposition after reversing strokes, moving contour starts or retracing. Direction/seam prototypes apply only to freely reversible strokes without pressure/feed/order constraints. Counterexamples in `geometry.py` and `styling.mjs` demonstrate errors, not acceptable optimisations.

App time estimates, transmission lower bounds and actual plot duration are kept separate. The [pen-width study](../pen-width/README.md) additionally examines ink coverage, duplicates, simplification and the trade-off between retracing and lifting.
