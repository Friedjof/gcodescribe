# Pen width and plot optimisation: offline experiment

These scripts test the assumptions in the [plan](../../docs/pen-width-optimization-plan.md). They write only their own reports, use synthetic millimetre geometry and never communicate with printers or a running application's data store.

Run from the repository:

```bash
.venv/bin/python experiments/pen-width/demo.py
.venv/bin/python experiments/pen-width/checks.py
.venv/bin/python experiments/pen-width/benchmark.py
```

The project environment already contains Shapely and the app dependencies. Use `demo.py --output /tmp/pen-width-demo` for another output directory. The demo checks six reference cases and three counterexamples, including unchanged inputs and identical ink coverage for eight routing candidates. `checks.py` also checks input order, mutual coverage, protected duplicates, rotation/translation and numerical resolution.

- [Comparison images and explanations](results/index.html): standalone HTML to open directly in a browser.
- [Raw measurements](results/metrics.json): areas, distances, points, two time models, tolerance rollback and the width/spacing grid.
- [Component benchmark](results/benchmark.json): geometry construction, simplification and indexing times, including a dense worst case.
- Individual original/candidate SVGs are under `results/`. Browser zoom is not a way to measure a physical pen's width.

The prototype assumes round, constant-width, opaque strokes. It does not simulate repeated ink application, paper fibres, pen mechanics, variable width or firmware dynamics. Protected attributes are explicitly marked in fixtures, not detected automatically. The naive area calculation rebuilds the complete union for every candidate; it is a small-case reference, not a production optimiser.

The 0.25% area budget and boundary tolerance of 5% of pen width are experimental settings. The demo checks globally; the application plan additionally requires local budgets, semantics and topology checks. Discrete Hausdorff distance and polygonal circle approximations do not provide an exact error guarantee. Results are proposed candidates, not automatically approved print jobs.

The first time calculation uses the existing G-code analyser; the second assumes continuous feed plus lift/contact costs. Neither measures plotting time. The benchmark is one local run with variable timings. Geometry is deterministic on repetition; runtimes are not.
