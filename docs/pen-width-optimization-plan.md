# Plan for pen-aware plot optimisation

As of 16 November 2026. Status: architecture and offline prototypes; the production plotting pipeline is unchanged at this planning stage. Implementation proceeds in independently reviewable commits on `interface-refactoring`.

## Goal and constraints

With a known pen, a plot should need fewer unnecessary drawing moves, lifts and G-code commands. The reference is the visible drawing on paper at its final size. Fewer displayed lines or coordinate points alone do not demonstrate success.

Distinguish three things:

- **Coordinate points:** intermediate curve samples generate movement commands, not separate ink dots. Collinear reduction and bounded curve simplification can help.
- **Drawn dots:** a pen contact deposits ink over an area. A covered dot may be redundant; an isolated punctuation mark remains a separate detail.
- **Repeated paths:** identical/overlapping paths may be redundant, but intentional shading, pressure variation or repeated ink application may require them.

Keep source objects, paths and Undo history editable. Optimise a derived plot plan. The precise editing view retains every original line; separate views show the expected physical ink coverage and the actual optimised tool paths.

The first version models a round, constant-width pen and one ink pass. Chisel tips, directional widths, variable-pressure lettering, transparent ink and intentional multiple passes must be recognised or explicitly marked unsupported and retain their paths. Extend support only with suitable models.

## Existing integration points

| Location | Current behaviour | Implementation consequence |
| --- | --- | --- |
| `plotter/core/calibration.py` | Machine dimensions, Z heights/speeds, `merge_tolerance=0.5` mm; no physical stroke width | Add a pen model; never equate width and joining tolerance |
| `plotter/gcode/scene.py` | Transforms, masks/obstacles, merging/ordering; separate source-order, pressure and variable-speed paths | Create an attributed intermediate representation before losing object identity |
| `plotter/geometry/singlepass.py` | Deduplicates segments with matching endpoints; decomposes networks without retracing | Reuse for unique paths; normalise overlaps with different subdivisions separately |
| `plotter/geometry/oneline.py` | Joins networks by retracing existing edges | A low-lift candidate; retracing has measurable time/ink costs |
| `plotter/geometry/travel.py` | Greedy ordering, KD-tree for large sets, bounded SVG 2-opt | Reuse while respecting ordering boundaries and the actual start position |
| `plotter/artwork/drawing.py` | Separate placement, scaling and G-code; some optimisation precedes final scale | Apply millimetre tolerances only in final paper coordinates |
| `plotter/artwork/pipeline.py` | CLI uses vpype with its own simplification/layout order | Align options/units; no hidden second optimisation after approving a plan |
| `plotter/gcode/metrics.py` | Estimated acceleration, 25 ms movement overhead and 150 ms Z settling | Do not present this as firmware timing; point reduction can exaggerate savings |
| `plotter/web/routes/pages.py` | Preview, scoring and plotting generate G-code through the same base function | Introduce a shared plan and avoid duplicate computation |
| `plotter/services/profiles.py`, `project_render.py` | Profile fingerprints/calibration snapshots prevent stale jobs | Also bind pen/optimisation snapshots; do not casually migrate machine fingerprints |
| `frontend/.../paint/lib/styling.ts` | Fixed hatch/dot spacing; finished paths partly lose semantic roles | Retain generator roles and provenance so fills can be regenerated deliberately |

Shapely 2.1.2 is available in the existing lockfile and local environment. Direct production use requires an explicit dependency and verified DEB/Flatpak availability. Nothing was installed for the prototypes.

## What the demos establish

Run `experiments/pen-width/demo.py`; see `results/index.html` and full measurements in `results/metrics.json`. Inputs are synthetic, deterministic millimetre geometry. The pen is modelled as circular coverage along a centreline. Results describe that model, not measured print quality.

| Case | Before → after | Ink-area change | Finding |
| --- | --- | --- | --- |
| Overlaps with different subdivisions | 76 → 30 mm drawing; 3 → 1 contacts | 0% missing/added | Exact geometric duplicates are a useful first step |
| Oversampled curve, 0.4 mm pen | 601 → 97 points; 32.431 → 32.430 mm | 0.1645% missing, 0.1625% added; about 0.002 mm boundary error | Far fewer commands, almost identical path; assess time separately |
| 61 hatch lines, 0.1 mm spacing, 0.5 mm pen | 1830 → 930 mm; 61 → 31 contacts | 0.0313% missing; about 0.02094 mm boundary error | Large modelled path savings; boundary shape limits further thinning |
| Two lines, 0.12 mm spacing, 0.4 mm pen | Both retained | 0% | Removing one loses 23.12% of ink area |
| Four dots on a line plus isolated punctuation | 6 → 2 contacts | 0% | Covered dots removed; isolated punctuation retained |
| Protected lettering dot and small loop | Unchanged | 0% | A global area budget cannot replace detail semantics |

Counterexamples:

1. **A centreline inside existing ink is insufficient.** The second parallel centreline lies inside the first stroke's coverage, yet its own ink extends beyond it.
2. **Percentages alone are insufficient.** One punctuation mark beside a large drawing represents only 0.00626% of this demo's area, but removing it is visibly wrong and causes a 10 mm boundary error.
3. **Short does not mean invisible.** A 0.02 mm line with a 0.4 mm pen deposits about 0.1336 mm² in the model. A blanket minimum length would incorrectly remove it.
4. **Pen width/10 is not a reliable simplification rule.** A 0.04 mm tolerance reduces the curve to 23 points but loses about 3.08% of coverage and adds 3.04%. Rolling back to 0.002 mm meets the experimental budget.
5. **Limits determine savings.** A 0.020 mm boundary tolerance permits no hatch-line deletion; 0.025 mm permits roughly every other line. These are experimental settings, not physically validated defaults.

### Time models and trade-offs

The demo compares existing routing algorithms on the same grid:

| Grid spacing / lift | Continuous with retracing | Once per edge | Interpretation |
| --- | --- | --- | --- |
| 0.5 mm / 0.5 mm | 36 mm, 1 contact, app estimate 7.6 s | 30 mm, 8 contacts, 11.6 s | Shorter drawing distance is slower in both models |
| 10 mm / 0.5 mm | 720 mm, 1 contact, 31.4 s | 600 mm, 8 contacts, 33.1 s | The continuous-motion model instead favours once per edge: 23.70 versus 24.51 s |
| 10 mm / 5 mm | 720 mm, 1 contact, 32.4 s | 600 mm, 8 contacts, 38.3 s | Larger lifts cost more |

The curve's app estimate falls from 29.2 to 9.0 s, while the other model remains near 1.71 s. This spread demonstrates model uncertainty, not measured speedup. Calibrate firmware lookahead, acceleration, turn angles, transmission and Z mechanics before making strong time claims.

## Pen model and measurement workflow

### Data structure

Version 1 proposes optional, versioned `penSetup` alongside `calibration` in existing profiles. No new mandatory library or main tab is needed. Reusable pen presets can later share this structure.

```ts
type PenSetup = {
  version: 1;
  revision: number;
  name: string;
  nib: 'round' | 'unsupported';
  widthMm: number | null;
  widthLowMm: number | null;
  widthHighMm: number | null;
  source: 'unknown' | 'nominal' | 'measured';
  paperNote: string;
  measurement: null | {
    samplesMm: number[];
    method: 'manual' | 'scan'; // scanning comes later
    capturedAt: string;
    conditions: {
      penDownZ: number;
      drawFeed: number;
      pressureDepth: number;
      directionIndependent: boolean;
    };
  };
};
```

`widthLowMm`/`widthHighMm` explicitly describe a working range including uncertainty, not a statistical confidence interval inferred from a few samples. Distinguish measured, nominal and unknown widths. A 0.4 mm input example must not silently become a saved measurement.

Validate finite positive millimetre values, consistent `low ≤ width ≤ high` bounds, finite speed/Z values and bounded text/sample counts. Initially support 0.05–5 mm in the UI; explicitly mark other widths outside tested model limits. Do not convert pen diameter automatically into stroke width.

Old profiles get `penSetup: null` and retain their machine calibration/fingerprints. Derive a separate `penFingerprint` from the normalised effective model and conditions. Renaming alone must not stale a job; changes to width, measurement status or relevant conditions invalidate new pen-optimised plans.

### Integration into existing setup

1. After contact/lift heights, offer Determine stroke width, with Use manufacturer specification or Measure with a test pattern. Measurement can be deferred.
2. A small card includes horizontal, vertical and diagonal lines, an arc and labelled spacing samples, using current paper and intended speed. Selecting it moves no hardware; plotting retains existing preview/start prerequisites.
3. Measure at least three locations per main direction, using magnification/a scale for fine pens. Combine millimetre samples and display their spread. Screen pixels are not a measurement reference.
4. Let the user confirm effective width and a conservative range. Strong directional dependence disables area-based removal while exact geometry optimisation remains available.
5. After changing pen/paper, Z or speed, show Check width again. Preserve the historical value without claiming it is a current measurement.

Later scan measurement needs a scale reference, rectification, background/ink segmentation and an uncertainty report. An unscaled photograph does not provide reliable millimetres. Scanning is outside the optimiser's first release.

Do not directly convert Xournal pressure controls to width; they are relative control values. An actual `width(pressure, speed, direction)` measurement series is needed first.

## Optimisation model

### Coordinates and attributes

Perform all checks after final scaling/transforms, in paper millimetres. Pen width does not scale with an object. Under non-uniform transforms, transform the centreline first, then expand it using the real round nib; otherwise the nib would incorrectly become elliptical.

A `PlotStroke` carries `id`, object/source reference, points, an explicit dot marker, role (`outline`, `fill`, `text`, `dot`, `unknown`), pen/colour group, pressure/speed data, ordering group, protection and repeated-pass intent. Roles come from generators/import metadata. Unknown short strokes are not automatically noise.

Optimise compatible groups together. Colours, pressure rules, intentional repeats, mask layers and required order form boundaries. Replace bare-polyline reduction with an attribute-preserving adapter.

### Ink coverage and errors

The reference is the existing final-sized, masked artwork, not an unknown ideal source photograph. Optimisation cannot recover details already lost during tracing. Before optimisation, the pen preview must show ink extending beyond paper/masks. Do not automatically shrink or crop the whole drawing to compensate for an overly broad pen.

For a constant round nib, `r = d/2`, coverage is the union of circles along the centreline. An explicit dot receives a circle; an accidental zero-length segment does not automatically become a dot. Geometry reference: [Shapely buffer 2.1.2](https://shapely.readthedocs.io/en/2.1.2/reference/shapely.buffer.html).

For original coverage `I₀` and optimised coverage `I₁`, measure:

- Missing ink: `A− = area(I₀ \ I₁)`.
- Added ink: `A+ = area(I₁ \ I₀)`.
- Relative errors against `area(I₀)`, with additional absolute limits for small regions.
- Maximum boundary deviation, including holes rather than just outer contours.
- Counts/identities of protected details, components, connections and retained white spaces.
- In later tonal models, changes to local pass counts.

Check each candidate against the group's original reference. Never reset the budget after each deletion, or use deleted paths as coverage for later removals. Recheck the entire final plan.

An experimental Balanced policy allows at most 0.25% missing/added coverage each and boundary error `min(0.03 mm, 0.05 × d)`. This starts validation; it does not guarantee invisibility. Apply the same limits locally per detail group/tile; protected details allow no loss. Overlap tile windows so errors cannot hide at seams. Check connected holes/network links separately.

Exact shape permits no intentional coverage changes, only a defined numerical budget. Unknown width cannot authorise width-dependent edits. For uncertain width, check the allowed range; a few samples do not prove a whole interval. The first production version uses conservative envelopes or retains the original when robust coverage cannot be established.

Circles are numerical approximations. The demo uses 32 segments per quadrant. Include maximum radial error `r × (1 − cos(π/(4q)))` in the production budget. Discrete Hausdorff distance is a check, not a guaranteed continuous bound; use adaptive densification or a conservative upper bound. Raster previews aid inspection but cannot alone authorise removal of subpixel details.

### Explainable processing stages

1. **Preparation:** capture immutable document/profile state; transform; apply masks, plot bounds and obstacles; preserve attributes/sources. Paper checks include ink edges. Tool/holder collision clearances remain mechanical constraints, not ink radius.
2. **Exact cleanup:** remove consecutive duplicates and exactly collinear samples unless they carry pressure/speed/dot meaning. Split intersections/partial overlaps and retain identical atomic segments once regardless of direction. Protect corners/junctions. Rounding must not collapse nearby parallel strokes.
3. **Point reduction:** simplify between protected anchors, starting with small pen-aware tolerances and rolling back on coverage/boundary failure. `preserve_topology=True` does not preserve relationships between independently simplified objects; share/check network junctions explicitly. See [Shapely simplify](https://shapely.readthedocs.io/en/2.1.2/reference/shapely.simplify.html).
4. **Coverage:** initially remove only whole redundant strokes/dots. Find local candidates spatially and check deterministically, prioritising substantial savings with little quality risk. Partial trimming comes later and must account for extra lifts/visible end caps. Never simply subtract a centreline from existing ink: the remaining stroke also deposits an area.
5. **Fills:** use known generator roles to regenerate hatch spacing for width/coverage. Inside an ideal opaque fill, parallel spacing can be at most roughly the effective width; boundaries, curvature, variation and deposition need further checks. Initially protect tonal hatching, pointillism and cross-hatching. Thinning them into lighter artwork is not equivalent optimisation.
6. **Routing:** compare original order, single-pass edges and, where applicable, retracing existing edges. Add no visible connection lines. Connections within existing ink are later coverage-checked candidates, not permission to bridge gaps. Do not inherit `merge_tolerance=0.5` as a general quality tolerance.
7. **Completion:** generate G-code with actual start, obstacles, parking and Z profile; check 0.001 mm rounding and motion limits; calculate final metrics/errors. On failure, retain the last valid stage and explain why.

This is constrained optimisation: meet quality/semantic requirements first, then compare time, retracing and data size. It promises no global optimum. Treat time differences within uncertainty as similar. With unknown dynamics, prefer less retracing among equivalent candidates; users may explicitly choose Fewer lifts.

## Architecture and API contracts

Proposed modules:

```text
plotter/plotplan/
  model.py           PlotStroke, PenSetup, Policy, PlotPlan, Report
  scene_adapter.py   Object transforms, attributes, masks
  drawing_adapter.py SVG/PDF placement in final millimetres
  normalize.py       Junctions, overlaps, exact cleanup
  simplify.py        Anchors and bounded point reduction
  coverage.py        Pen coverage, local indexing, deletion candidates
  quality.py         Error budgets, semantics, final validation
  routing.py         Route comparison and existing helpers
  timing.py          Dynamics and uncertainty
  service.py         Tasks, snapshots, cache, cancellation
```

`build_plot_plan(source, calibration, pen_setup, policy) -> PlotPlan` performs no file/printer access. The plan includes versioned input hashes, pen/policy snapshots, attributed paths, before/after metrics, rejected candidates/reasons and validation status. Separate planning and encoding; the encoder must not perform hidden subsequent line optimisation.

Store optional per-slide `plotOptimization`:

```ts
{version: 1, mode: 'off' | 'exact' | 'balanced', route: 'auto' | 'single_pass' |
'few_lifts', protectedObjectIds: string[]}
```

Missing means `off`. Tolerances belong to a versioned policy, not arbitrary beginner controls. An explicit experimental mode may expose them during measurement; every report records actual values. Keep legacy `continuous` compatibility, but once a new policy is active, only its `route` decides routing. An old Boolean must not alter the completed plan.

A successful report contains:

```ts
{status: 'ready', inputHash, planHash, policyVersion, penFingerprint,
before: {drawMm, travelMm, contacts, points, estimatedSeconds}, after: {...},
quality: {missingAreaMm2, addedAreaMm2, maxBoundaryErrorMm, protectedLost: 0},
appliedStages, skippedGroups, warnings}
```

Claim complete quality validation only after checking every required group. Partial validation returns an unchanged/conservative fallback with its own hash/status. Show its actual metrics rather than mixing proposed and usable plans.

Proposed endpoints, adapted to existing tasks:

- `POST /api/pages/{id}/plot-plan`: capture `expectedRevision`, project/profile identity, effective settings and policy; return `202` with a task ID. A valid cache hit may return immediately.
- `GET /api/plot-plans/{taskId}`: stage progress, status, hash, metrics, bounded preview and result reference. Transfer large paths compactly/binarily rather than duplicating huge JSON trees.
- `DELETE /api/plot-plans/{taskId}`: cooperative cancellation, discarding process work when necessary. Cancellation never automatically plots the original.
- Plot/export receives `planId`, `planHash`, expected document revision and profile/pen hashes. Mismatch returns `409` and requires recomputation, never a silent plan substitution.

Saved and unsaved previews need identical semantics: await autosave or send an explicit content-hashed draft. The eventual plot binds exactly that content. Project switching does not redirect a calculation; late results cannot replace newer previews.

Cache keys cover geometry, masks/transforms/attributes, final scale, relevant calibration, pen fingerprint, policy/algorithm versions and motion model. Layout/zoom invalidates nothing. Preview, scoring, download and printing reference the same immutable plan, whose snapshot is included in job metadata. Legacy jobs retain their existing validation without being retrospectively labelled optimised.

Profile/file import/export must preserve `penSetup` and version boundaries. Unknown future policy versions are not interpreted as current defaults.

## Performance and stability

`benchmark.py` measures components, not a complete optimiser. One local run simplified 400,000 points at 0.002 mm tolerance in about 239 ms. For separated curves, spatial indexing reduced 10,000 possible pairs to 100 self-pairs. With 1,000 densely overlapping lines, it still produced 1,000,000 directed candidate pairs and took about 608 ms to query.

The small hatch demo rebuilds all coverage per deletion and already takes about two seconds for 61 lines. This intentionally simple reference is unsuitable for production.

Production strategy:

- Perform cheap exact reduction before expensive coverage operations. Split paths into bounded spatial pieces; do not let long diagonals create enormous bounding-box neighbourhoods.
- Use STRtree or equivalent for candidates. Rebuild the static tree deliberately after structural edits and filter against surviving paths. See [STRtree](https://shapely.readthedocs.io/en/2.1.2/strtree.html).
- Cache local coverage in overlapping tiles. Invalidate dependencies between deleted paths and cached coverage. Tiling cannot replace global final/detail validation.
- Process dense candidates in blocks with fixed work budgets, not an unbounded million-pair UI matrix. Handle known hatch generators separately.
- Run cancellable background processes while retaining the last complete drawing. Intermediate progress is not a finished plan.
- On memory/time limits, retain a validated conservative plan and report incomplete coverage optimisation plus the actual applied stages. Never silently omit geometry.
- Use stable source IDs/deterministic ordering so identical inputs/versions produce the same hash. Bound caches and release them after failures.

Provisional acceptance targets on a documented reference machine: UI response below 100 ms, cancellation acknowledgement below 500 ms, exact analysis of 100,000 points within a few seconds, and visible progress/bounded memory at 400,000 points. These are future acceptance targets, not achieved end-to-end measurements.

## Compact editor interaction

Add Pen & optimisation to the existing plot/preview area, not a main tab. Show a short document status for pen name, width and measurement state without displacing editing tools.

Use three compact docked subpages with fixed actions:

1. **Pen:** width, source, paper and Check width; no duplicate setup wizard.
2. **Optimisation:** Off, Exact shape and Balanced. Off is the migration default. Exact removes suitable exact redundancy; Balanced explicitly opts into measured-width processing. Protect details exempts special objects; explain excluded pressure/order groups.
3. **Compare:** original ink, optimised ink, differences or tool paths at a shared scale. Missing ink is red, additions green; outlines/legends also make the comparison usable without colour perception.

Summarise drawing distance, travel, contacts, coordinate points, retracing and estimated time. Mark uncertainty rather than promising percentage savings. No safe simplification found is valid. Explain retained geometry, for example: Parallel strokes retained because they contribute additional coverage.

Separate physical-width preview from selection controls. Ink scales with zoom while handles/hit targets keep their screen size. Render outlines in final paper coordinates even under non-uniform transforms. Large results use complete tiles/vectors and the corrected designer's rules against disappearing lines.

At 1024×768 and 1366×768, all three subpages must fit without clipped actions. Open lengthy diagnostics in a dedicated report rather than expanding normal settings indefinitely.

## Reviewable implementation stages

| Stage | Scope / separate commits | Acceptance before proceeding |
| --- | --- | --- |
| 0 – Reference | Plan, deterministic fixtures, demo and raw data | Reproducible counterexamples and documented model limits |
| 1 – Shared plan | Intermediate model, scene adapter, separate encoder, identity mode | Equivalent relevant motion for existing jobs; preserve pressure/speed/masks |
| 2 – Pen setup | Profile model/validation, import/export, conditions, compact UI/test card | Legacy profiles work; changes invalidate appropriate new plans only; later physical card validation |
| 3 – Preview/report | Physical width, original/result/difference, metrics | Correct zoom/scaling, unchanged sources, shared preview/plot plan ID |
| 4 – Exact optimisation | Collinearity, partial overlaps, unique segments, safe route candidates | No intentional coverage loss or loss of marked dots/attributes/order |
| 5 – Bounded simplification | Anchors, curve reduction, budgets and rollback | Numerical/rounding budgets and local/global checks pass |
| 6 – Width-aware removal | Whole covered paths/dots, indexes/caches, robust bounds | Preserve punctuation/small loops; no mutually deleting paths; load/cancellation tests |
| 7 – Routes/time | Measured dynamics, retracing versus lifting, start/parking | No point-count-based time promises; calibration against real samples |
| 8 – Fills/imports | Hatch generator, later partial paths, SVG/PDF/CLI adapters | Final-mm consistency, no double optimisation, deliberate tonal preservation |
| 9 – Release | Desktop/browser, DEB/Flatpak, physical comparisons, export docs | Quality/stability/timing criteria and independent rollback |

Stages 1–6 provide the first usable designer-page variant; 7–9 complete timing calibration and other generation paths. Generator-aware hatching and variable-pen models must not block the conservative initial version. There is no blanket eight-hour completion promise: reassess coverage indexing and attribute preservation on real examples after stage 4.

## Validation matrix and release criteria

| Group | Cases | Expected result |
| --- | --- | --- |
| Exact geometry | Reversal, different subdivisions, partial overlap, crossing/collinear lines | Remove redundancy without new connections |
| Visible details | Punctuation, i/j dots, short strokes, small rings, narrow holes, nearby parallels | Identical protected details; local/global loss limits |
| Fonts/imports | Source order, variable feed, Xournal pressure, masked portions, intentional repeats | Preserve attributes/order; exclude unsupported groups |
| Transforms | 0.1×/1×/10×, mirrors, rotation, non-uniform scaling, paper changes | Constant physical pen width; decisions based on final millimetres |
| Pen | Unknown/nominal/measured, invalid numbers, uncertain ranges, changed conditions | Explicit states; no invented precision |
| Numerics | Near-identical points, 0.001 mm rounding, collapsing segments, large coordinates | Recheck emitted G-code; no NaN/Inf; retain explicit dots |
| Pipeline | Scene/SVG/PDF/CLI; shared preview/score/plot plan | No divergent second optimisation |
| Concurrency | Project/revision/pen changes during work, cancellation, repetition | Discard stale results; explicit hash/snapshot conflicts |
| Load | 20k/100k/400k/1M points, 1k/10k/50k strokes, dense overlap | Bounded resources, reproducible fallback, responsive UI |
| Properties | Determinism, unchanged inputs, metadata, repeated optimisation | Same input/plan; compare every application to the original, avoiding progressive erosion |
| Physical | Fine liner, medium gel pen, broad pen; at least two papers | Record actual width, legibility, deposition and before/after duration |

Physical protocol: calibrate Z/paper first; plot equal-size/equal-speed original and optimised samples side by side, varying direction/position. Run each chosen case at least three times. Record real duration, contacts and scans/macro photographs separately from model reports. One attractive image does not establish a general quality bound.

Release only after automated checks preserve details, prevent unvalidated plotting and physical comparisons support the chosen tolerances. Until then Balanced stays an explicit, visibly model-based option. Later automatic recommendations require validated pen/paper conditions.

## Open decisions and intended approach

- **Ink deposition:** binary coverage ignores darkening from repeats. Protect intentional multiple passes initially; add an optional tonal/pass-count model later.
- **Unknown import semantics:** do not guess whether a dot is punctuation or noise. Retain unknown details conservatively; users may explicitly release groups.
- **Variable width:** start round/constant, then validate measured curves or directional elliptical footprints separately.
- **Partial coverage:** remove whole paths first. Splitting requires cost modelling, end-cap checks and limits against many tiny remnants.
- **Timing:** current and alternative estimates are diagnostics. Reliable automatic timing choices need measured dynamics and lookahead-aware models.
- **Scaling:** the demo supports domain rules, not scalability. Local caches, cancellation and dense worst cases need a separate stage.

References: [vpype optimisation commands](https://vpype.readthedocs.io/en/stable/reference.html), [Shapely 2.1.2 buffer](https://shapely.readthedocs.io/en/2.1.2/reference/shapely.buffer.html), [simplify](https://shapely.readthedocs.io/en/2.1.2/reference/shapely.simplify.html) and [STRtree](https://shapely.readthedocs.io/en/2.1.2/strtree.html). The architecture and thresholds are project-specific proposals; library documentation does not establish their physical validity.

## Prototype validation performed

All six demo cases and eight route candidates ran. Ten additional invariant checks passed, including mutual coverage, protected geometric redundancy, rotation/translation and circle-resolution stability. A second complete run reproduced geometry, quality and time-model values; measured computation times were excluded. Ruff passed for all three scripts. Firefox visually checked the HTML report's 18 SVG views at 1440 px without horizontal overflow. Full app suites were not repeated for this planning-only work. Physical validation remains for later implementation.
