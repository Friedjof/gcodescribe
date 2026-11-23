# Plot-plan module and audit of all saved slides

As of 16 November 2026. Implemented on `interface-refactoring`; previous renderer reference: `ca6f2e5`. Background: [plot-efficiency evaluation](plot-efficiency-evaluation.md).

## Implemented scope

The designer uses `plotter.plotplan` as a separate module without side effects. It does not load profiles, change documents or move hardware. The caller supplies a slide and its calibration.

```python
from plotter.plotplan import build_scene_plan, encode_plot_plan

plan = build_scene_plan(page, calibration)
gcode = encode_plot_plan(plan)
report = plan.report

# Regression reference: same preparation, original stroke order.
control = build_scene_plan(page, calibration, optimize=False)
```

| Component | Responsibility |
| --- | --- |
| `plotter/plotplan/source.py` | Retain existing transforms, masks, pressure/speed data, merging and the explicit Continuous setting |
| `model.py` | Immutable pen paths, attributes, approach/parking moves, calibration snapshot and report; reject inconsistent paths |
| `routing.py` | Sort freely reversible strokes using a spatial index, direction DP, bounded 2-opt and existing contour vertices |
| `scene.py` | Round machine coordinates to output precision; manage fixed attribute groups, actual travel paths, end anchors, candidate comparison, plan ID and cache |
| `encoder.py` | Encode the completed plan as G-code; enforce pressure/Z speed limits and the final safety check |
| `plotter/geometry/routing.py` | Reusable obstacle graph with bed bounds, a distance cache and explicit errors for impossible travel |
| `plotter/gcode/scene.py` | Preserve existing public functions and save job files and metadata |

Only order, direction and the starting point of a closed contour are optimised. The multiset of drawn segments, pen contacts and protected attribute sequences remain unchanged. Fixed feed, pressure or source-order groups are neither reversed nor internally reordered. Their first point anchors the preceding free group's endpoint; a parking move follows where applicable.

Candidates are evaluated using actual obstacle-aware travel paths. After rounding to 0.001 mm, the entire travel route is checked again. A candidate is accepted only if the route actually emitted is shorter. Ties retain the previous plan. Search limits are deterministic; this is not a claim of global optimality.

`TravelPlanner(..., bed_bounds=(w,h))` avoids the previous detour outside the bed. It retains 3 mm obstacle clearance; rounded routes may lose at most 0.001 mm numerically. Unreachable endpoints are rejected. The final safety check still validates all G-code. Legacy callers without bed bounds initially retain their previous behaviour outside this module.

The plan ID binds document state, calibration, optimiser mode and module version. Scoring and the 3D preview return it with the report as `plotPlan`; new job metadata records `source.plot_plan_id` and `source.plot_plan_version`. Identical snapshots reuse the same plan; edits create a new one. The job endpoint does not yet require a plan ID previously confirmed in the preview.

The cache holds at most eight immutable plans, conservatively estimated at a combined 48 MiB. Keys are hashes; large source JSON documents are not retained. Oversized plans are fully computed and checked but not cached. This bounds the cache, rather than all temporary geometry or concurrent requests. Geometry/profile changes invalidate keys automatically. The encoder checks every output again.

## Corpus and audit method

Every live slide entry was collected from three actual stores, without opening application stores that might run migrations:

| Store | Slides | Final comparison status |
| --- | ---: | --- |
| Running development installation, Redis | 83 | Checked |
| Local file fallback | 5 | Checked |
| Flatpak file store | 9 | Checked |
| Total | **97** | **94 renderable, 3 empty** |

The inventory also records 74 deletion markers and nine migration copies; these are not counted as additional live slides. No referenced pages or profiles are missing. The data contains 1,715,372 stored coordinate points. Entries are checked per installation even when their contents are similar.

The corpus contains 5,876 objects: images, text, freehand strokes, basic shapes, masks, Sudoku and maps. Four objects explicitly vary pressure; eleven retain source order and eleven have saved speed values. No saved slide has `continuous=False`, and no used profile contains obstacles. Targeted regression tests cover those branches; the real corpus alone does not.

Two slides contain 252 objects already marked as plotted. Besides their normal remaining-content plots, full copies were evaluated, yielding **99 audit cases** without changing saved plot markers. The three empty slides are explicitly not counted as successfully rendered artwork.

Comparison procedure:

1. Create private, hashed snapshots of every source and profile.
2. Run the unchanged renderer from `ca6f2e5` against them.
3. Run the new reference mode against the same data. Its complete modal motion sequence `(G,X,Y,Z,F)` must match the previous renderer.
4. Independently evaluate the optimised plan's **actual rounded G-code**: undirected drawing-segment multiset including Z/feed, contact count, protected order and total travel distance.
5. Clear the cache and recompute independently. Plan IDs and G-code must be deterministic. Measure cache reuse separately afterwards.
6. Check input hashes and corpus coverage. A failing page does not stop inventory collection, but does fail the audit.

There is no automatic fitting, exclusion of difficult artwork or printer movement. Raw geometry and private source files are not committed. The local report is `data/audits/plotplan/slides.json`, which Git ignores.

## Measured benefit and limitations

The final comparison of the 94 renderable normal slides found:

- **81 slides with shorter travel, 13 unchanged, none worse.**
- Total travel **204.057 → 184.763 m**, a reduction of **19.294 m or 9.46%**.
- Median relative improvement per slide: **13.77%**. This is distinct from the total weighted by distance.
- Unchanged drawing-segment multisets, pen contacts and pressure/speed sequences.
- All 94 reference motion sequences match the previous renderer.

Both additional full copies pass every check; their combined travel falls from 1.748 to 1.310 m. These variants are excluded from the total savings above. All 99 cases are accounted for: 96 successful comparisons and three explicitly empty slides. All 96 reference sequences match the old renderer, and every input hash remains unchanged.

Of the 13 unchanged slides, twelve are fully protected by source order; one is a single continuous stroke. Forcing an artificial improvement would be inappropriate. All 18,060 protected strokes are retained.

**Less travel is not a measured reduction in plotting time.** Drawing distance and lift count remain unchanged in this first production optimisation stage. Acceleration, firmware and transmission still affect real duration. The problematic existing time estimate is not the selection criterion. Travel totals also retain the previous assumed job origin `(0,0)`, recorded as `start_assumed_origin`; they do not measure the actual head position before plotting. A future start-position contract must bind the known machine position, planning and execution together.

**Retracing remains the larger unresolved trade-off.** Continuous still adds paths on 76 slides. The largest case adds approximately 21.319 m to a total drawing distance of 43.636 m with one contact. The module preserves and reports that existing decision. Choosing between single-pass, hybrid and Continuous requires pen/ink conditions and a reliable lift/time model.

**Initial computation has a cost.** In the final run, preparation, optimisation and encoding took a median 1.33 s, 4.03 s at the 95th percentile and at most 7.24 s. Routing can add computation. The preceding legacy greedy step remains quadratic up to 4,000 strokes, so the evaluation's isolated KD-tree speedup is not claimed as an overall realised gain. All 94 normal cases subsequently hit the cache. Plan retrieval took a median 32 ms and at most 342 ms, including JSON snapshots and hashing but excluding re-encoding. Edits still require recalculation. Timings under concurrent test load are not reliable machine comparisons.

**Avoiding new damage does not prove the original input was perfect.** These tests compare saved paths and previous G-code. They do not repair import detail loss, old preview reduction, centreline consolidation, dash/fill errors or grid-based merging. Those remain separate corrections from the evaluation. Pen-width-based removal, contact reduction, new fill generators and the separate direct SVG/CLI emitters are also outside this stage.

## Repeating the audit

`scripts/snapshot_plot_slides.py` reads only slide/index data and profile calibration. The output directory must be new and outside the sources. Redis credentials come from an environment variable and are never printed. File sources are read twice; Redis uses MGET with stability checks. Concurrent changes cause the snapshot to be rejected instead of changing the sources.

File-store example:

```sh
.venv/bin/python scripts/snapshot_plot_slides.py \
  --file-source local=data --output /tmp/gcodescribe-slides-new
.venv/bin/python scripts/audit_plot_plans.py \
  --source local=/tmp/gcodescribe-slides-new/local \
  --include-plotted --output data/audits/plotplan/new-run.json
```

Use `--redis-source development --redis-url-env REDIS_URL --profiles-from data` for Redis. Repeat `--file-source` to add file stores and supply corresponding `--source` arguments to the audit.

For an additional old-version comparison, check out or export that version separately. First run the audit with `--baseline-package /path/to/old/version`, then audit the same source snapshot with `--baseline /path/to/baseline.json`. Source sets and variant flags must match. Incomplete or subsequently modified baseline runs are rejected.

Targeted checks:

```sh
PATH="$PWD/.venv/bin:$PATH" .venv/bin/pytest -q \
  tests/test_plot_plan.py tests/test_plot_plan_routing.py \
  tests/test_travel_bounds.py tests/test_plot_plan_audit.py \
  tests/test_plot_slide_snapshot.py
```

Counterexamples require the auditor to detect changed feed rates, missing segments, extra contacts, longer travel, modified inputs, incorrect approaches, inconsistent snapshots and incomplete baselines. The complete backend suite is run in addition.

Final validation at implementation: **1,114 backend tests passed**, including 24 snapshot/audit tests; Ruff and `git diff --check` passed. The complete 99-case report exactly covers the baseline. An independent contact counter was tested with an injected erroneous contact; actual contacts in all 96 renderings were also checked against the frozen baseline using G-code metrics. The later guard test and corpus audit are recorded separately in the local report.

No user source, profile calibration or plot marker was changed. No hardware plots were run, so actual duration, ink deposition and material quality remain unmeasured.
